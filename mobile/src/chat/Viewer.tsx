/**
 * Photos and videos full screen: swipe between them, pinch or double-tap
 * a photo to zoom and drag it about, play a video with the system's own
 * controls (pause, seek, sound, full screen). Save or Share hands the file
 * to the share sheet, where "Save Image"/"Save Video" put it on the phone.
 *
 * Attachments are private, so nothing is downloaded until somebody asks:
 * the file goes to the cache for the share sheet, never anywhere public.
 */
import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChatAttachment } from "@/api/types";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { tell } from "@/ui/confirm";
import { native, nativeOrNull } from "@/ui/native";
import { formatDuration } from "./send";

/** Fetch a private attachment into the cache and offer it to the share sheet. */
export async function saveOrShare(attachment: Pick<ChatAttachment, "download" | "url" | "name" | "kind" | "content_type" | "id">): Promise<void> {
  const { Directory, File, Paths } = native<typeof import("expo-file-system")>(() => require("expo-file-system"));
  const Sharing = native<typeof import("expo-sharing")>(() => require("expo-sharing"));
  const dir = new Directory(Paths.cache, "chat");
  if (!dir.exists) dir.create();
  const ext = attachment.kind === "photo" ? (attachment.content_type === "image/webp" ? "webp" : "jpg")
    : attachment.kind === "video" ? "mp4" : attachment.kind === "audio" ? "m4a" : "";
  const name = attachment.kind === "file" ? attachment.name : `${attachment.kind}-${attachment.id.slice(0, 8)}.${ext}`;
  const file = new File(dir, name);
  if (file.exists) file.delete();
  const saved = await File.downloadFileAsync(attachment.download || attachment.url, file);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(saved.uri, { mimeType: attachment.content_type });
  else tell("Saved", saved.uri);
}

function ZoomablePhoto({ uri, width, height, onZoom }: { uri: string; width: number; height: number; onZoom: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1), saved = useSharedValue(1);
  const x = useSharedValue(0), y = useSharedValue(0), startX = useSharedValue(0), startY = useSharedValue(0);
  const reset = () => {
    "worklet";
    scale.value = withTiming(1); saved.value = 1; x.value = withTiming(0); y.value = withTiming(0);
  };
  const pinch = Gesture.Pinch()
    .onUpdate(e => { scale.value = Math.max(1, Math.min(5, saved.value * e.scale)); })
    .onEnd(() => { saved.value = scale.value; if (scale.value <= 1.02) reset(); })
    .runOnJS(true)
    .onFinalize(() => onZoom(saved.value > 1.02));
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { startX.value = x.value; startY.value = y.value; })
    .onUpdate(e => {
      if (saved.value <= 1.02) return;
      const maxX = (width * (scale.value - 1)) / 2, maxY = (height * (scale.value - 1)) / 2;
      x.value = Math.max(-maxX, Math.min(maxX, startX.value + e.translationX));
      y.value = Math.max(-maxY, Math.min(maxY, startY.value + e.translationY));
    });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    if (saved.value > 1.02) reset();
    else { scale.value = withTiming(2.5); saved.value = 2.5; }
  }).runOnJS(true).onFinalize(() => onZoom(saved.value > 1.02));
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" accessibilityLabel="Photo" />
      </Animated.View>
    </GestureDetector>
  );
}

type ExpoVideo = typeof import("expo-video");
const Video: ExpoVideo | null = nativeOrNull<ExpoVideo>(() => require("expo-video"));

function FullVideo({ uri, width, height }: { uri: string; width: number; height: number }) {
  if (!Video) return <Text style={{ color: "#fff" }}>Video</Text>;
  return <VideoInner V={Video} uri={uri} width={width} height={height} />;
}

function VideoInner({ V, uri, width, height }: { V: ExpoVideo; uri: string; width: number; height: number }) {
  const player = V.useVideoPlayer(uri, p => { p.loop = false; });
  return <V.VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls />;
}

export function MediaViewer({ items, start, onClose }: { items: ChatAttachment[]; start: number; onClose: () => void }) {
  const tr = useT();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = items[index];

  const share = async () => {
    if (!current || busy) return;
    setBusy(true);
    try { await saveOrShare(current); } catch (error) { tell(tr("Couldn't save"), errorMessage(error)); } finally { setBusy(false); }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
        {/* White clock and battery on the black stage, in light mode too. */}
        <StatusBar style="light" />
        <FlatList
          data={items}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={item => item.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
              {item.kind === "video"
                ? (i === index ? <FullVideo uri={item.url} width={width} height={height - insets.top - insets.bottom - 120} /> : <Image source={{ uri: item.thumb || undefined }} style={{ width, height: height * 0.6 }} contentFit="contain" />)
                : <ZoomablePhoto uri={item.url} width={width} height={height} onZoom={setZoomed} />}
            </View>
          )}
        />
        <View style={[styles.bar, { top: insets.top + 6 }]}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={tr("Close")} style={styles.icon}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.count}>{items.length > 1 ? `${index + 1} / ${items.length}` : current?.kind === "video" ? formatDuration(current.duration) : ""}</Text>
          <Pressable onPress={() => { void share(); }} accessibilityRole="button" accessibilityLabel={tr("Save or share")} style={[styles.icon, busy && { opacity: 0.5 }]}>
            <Ionicons name="share-outline" size={25} color="#fff" />
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 8, right: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "rgba(0,0,0,0.35)" },
  count: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
