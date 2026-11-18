/**
 * Voice messages: recording them and playing them back.
 *
 * Recording: hold the microphone to record; slide up to lock it (hands
 * free, with pause and resume); slide left to cancel. Letting go — or
 * Stop when locked — shows the recording to play back before it is sent.
 * Nothing records without the person holding the button or having locked
 * it, and the microphone is let go when recording ends or the screen goes.
 *
 * expo-audio is loaded lazily: a build without it shows no microphone,
 * and voice messages received there can still be downloaded.
 */
import React, { useEffect, useRef, useState } from "react";
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { FilePart } from "@/api/client";
import { useT } from "@/i18n";
import { tap } from "@/ui/haptics";
import { nativeOrNull } from "@/ui/native";
import { sp, useTheme } from "@/ui/theme";
import { formatDuration } from "./send";

type AudioModule = typeof import("expo-audio");
export const Audio: AudioModule | null = nativeOrNull<AudioModule>(() => require("expo-audio"));
export const canRecord = () => Audio !== null;

export type Recording = { file: FilePart; duration: number; waveform: number[] };

/** Loudness in dBFS (-160…0) as 0–100. */
const level = (db: number | undefined) => (db === undefined ? 0 : Math.round(Math.max(0, Math.min(1, (db + 55) / 55)) * 100));

/** Many samples down to `n` bars, by taking the loudest of each slice. */
export function bars(samples: number[], n = 48): number[] {
  if (!samples.length) return [];
  if (samples.length <= n) return samples.slice();
  const out: number[] = [];
  const step = samples.length / n;
  for (let i = 0; i < n; i++) {
    const slice = samples.slice(Math.floor(i * step), Math.floor((i + 1) * step));
    out.push(Math.max(...slice, 0));
  }
  return out;
}

export function Waveform({ levels, progress = 0, color, faded, height = 28 }: { levels: number[]; progress?: number; color: string; faded: string; height?: number }) {
  const shown = levels.length ? bars(levels, 40) : Array.from({ length: 40 }, () => 18);
  return (
    <View style={[styles.wave, { height }]} accessible={false}>
      {shown.map((value, i) => (
        <View key={i} style={{ flex: 1, marginHorizontal: 0.75, borderRadius: 2, height: Math.max(3, (value / 100) * height), backgroundColor: i / shown.length <= progress ? color : faded }} />
      ))}
    </View>
  );
}

type Phase = "idle" | "holding" | "locked" | "paused" | "review";

/**
 * The microphone button, which grows into the recording panel. `onSend`
 * gets the finished recording; `onActive` tells the composer to step aside.
 */
export function VoiceRecorder({ maxSeconds, onSend, onActive, onError, disabled }: {
  maxSeconds: number; disabled?: boolean;
  onSend: (recording: Recording) => void; onActive: (active: boolean) => void; onError: (message: string) => void;
}) {
  if (!Audio) return null;
  return <Recorder maxSeconds={maxSeconds} onSend={onSend} onActive={onActive} onError={onError} disabled={disabled} A={Audio} />;
}

function Recorder({ A, maxSeconds, onSend, onActive, onError, disabled }: {
  A: AudioModule; maxSeconds: number; disabled?: boolean;
  onSend: (recording: Recording) => void; onActive: (active: boolean) => void; onError: (message: string) => void;
}) {
  const t = useTheme(), tr = useT();
  const recorder = A.useAudioRecorder({
    ...A.RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
    bitRate: 32000,
    sampleRate: 22050,
    isMeteringEnabled: true,
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [hint, setHint] = useState(false);
  const [review, setReview] = useState<Recording | null>(null);
  const start = useRef({ x: 0, y: 0, at: 0 });
  const phaseRef = useRef<Phase>("idle");
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const setP = (next: Phase) => { phaseRef.current = next; setPhase(next); onActive(next !== "idle"); };

  const stopTicker = () => { if (ticker.current) clearInterval(ticker.current); ticker.current = null; };
  const startTicker = () => {
    stopTicker();
    ticker.current = setInterval(() => {
      const status = recorder.getStatus();
      setSeconds(status.durationMillis / 1000);
      setLevels(was => [...was.slice(-599), level(status.metering)]);
      if (status.durationMillis / 1000 >= maxSeconds) void finish();
    }, 100);
  };

  const release = async () => {
    stopTicker();
    try { if (recorder.getStatus().isRecording) await recorder.stop(); } catch { /* already stopped */ }
    try { await A.setAudioModeAsync({ allowsRecording: false }); } catch { /* nothing to undo */ }
  };

  // The microphone is never left on behind a closed screen.
  useEffect(() => () => { void release(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    if (disabled) return;
    try {
      const permission = await A.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError(tr("Allow microphone access in Settings to record voice messages."));
        return;
      }
      await A.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // Let go before the recorder was ready: nothing is recorded.
      if (phaseRef.current !== "holding") { await release(); return; }
      recorder.record();
      tap("medium");
      setLevels([]);
      setSeconds(0);
      startTicker();
    } catch {
      setP("idle");
      onError(tr("The microphone couldn't start. Try again."));
    }
  };

  const finish = async () => {
    stopTicker();
    const duration = recorder.getStatus().durationMillis / 1000;
    try { await recorder.stop(); } catch { /* already stopped */ }
    try { await A.setAudioModeAsync({ allowsRecording: false }); } catch { /* nothing to undo */ }
    const uri = recorder.uri;
    if (!uri || duration < 0.6) {
      setP("idle");
      setHint(true);
      return;
    }
    setReview({ file: { uri, name: `voice-${Date.now()}.m4a`, type: "audio/mp4" }, duration, waveform: bars(levels, 64) });
    setP("review");
  };

  const cancel = async () => {
    await release();
    setReview(null);
    setLevels([]);
    setP("idle");
  };

  const grant = (e: GestureResponderEvent) => {
    start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now() };
    setHint(false);
    setP("holding");
    void begin();
  };
  const move = (e: GestureResponderEvent) => {
    if (phaseRef.current !== "holding") return;
    const dx = e.nativeEvent.pageX - start.current.x, dy = e.nativeEvent.pageY - start.current.y;
    if (dy < -70) { tap("light"); setP("locked"); }
    else if (dx < -90) { void cancel(); }
  };
  const letGo = () => {
    if (phaseRef.current !== "holding") return;
    if (Date.now() - start.current.at < 350) { void cancel(); setHint(true); return; }
    void finish();
  };

  const pause = () => { try { recorder.pause(); stopTicker(); setP("paused"); } catch { /* keep going */ } };
  const resume = () => { try { recorder.record(); startTicker(); setP("locked"); } catch { /* stay paused */ } };

  if (phase === "review" && review) {
    return (
      <View style={[styles.panel, { backgroundColor: t.surface, borderColor: t.line }]}>
        <Pressable onPress={() => { void cancel(); }} accessibilityRole="button" accessibilityLabel={tr("Delete recording")} style={styles.round}>
          <Ionicons name="trash-outline" size={21} color={t.danger} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <VoicePlayer uri={review.file.uri} duration={review.duration} waveform={review.waveform} mine={false} compact />
        </View>
        <Pressable onPress={() => { onSend(review); setReview(null); setP("idle"); }} accessibilityRole="button" accessibilityLabel={tr("Send voice message")} testID="voice-send"
          style={[styles.round, { backgroundColor: t.brand }]}>
          <Ionicons name="arrow-up" size={22} color={t.brandInk} />
        </Pressable>
      </View>
    );
  }

  if (phase === "locked" || phase === "paused") {
    return (
      <View style={[styles.panel, { backgroundColor: t.surface, borderColor: t.line }]}>
        <Pressable onPress={() => { void cancel(); }} accessibilityRole="button" accessibilityLabel={tr("Cancel recording")} style={styles.round}>
          <Ionicons name="trash-outline" size={21} color={t.danger} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Waveform levels={levels.slice(-80)} progress={1} color={t.danger} faded={t.line} height={24} />
          <Text style={{ color: t.text2, fontSize: 12 }} accessibilityLiveRegion="polite">{phase === "paused" ? tr("Paused") : tr("Recording")} · {formatDuration(seconds)}</Text>
        </View>
        <Pressable onPress={phase === "paused" ? resume : pause} accessibilityRole="button" accessibilityLabel={phase === "paused" ? tr("Resume recording") : tr("Pause recording")} style={styles.round}>
          <Ionicons name={phase === "paused" ? "mic" : "pause"} size={21} color={t.text} />
        </Pressable>
        <Pressable onPress={() => { void finish(); }} accessibilityRole="button" accessibilityLabel={tr("Stop and review")} style={[styles.round, { backgroundColor: t.brand }]}>
          <Ionicons name="stop" size={18} color={t.brandInk} />
        </Pressable>
      </View>
    );
  }

  const holding = phase === "holding";
  return (
    <View style={holding ? [styles.panel, { backgroundColor: t.surface, borderColor: t.line }] : undefined}>
      {holding ? (
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: t.danger, fontWeight: "700", fontSize: 13 }} accessibilityLiveRegion="polite">● {formatDuration(seconds)}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{tr("Slide up to lock · slide left to cancel")}</Text>
        </View>
      ) : null}
      {hint && !holding ? <Text style={[styles.hint, { color: t.muted, backgroundColor: t.surface }]}>{tr("Hold to record")}</Text> : null}
      <View
        onStartShouldSetResponder={() => !disabled}
        onResponderGrant={grant}
        onResponderMove={move}
        onResponderRelease={letGo}
        onResponderTerminate={() => { if (phaseRef.current === "holding") void finish(); }}
        accessible
        accessibilityRole="button"
        accessibilityLabel={tr("Record voice message")}
        accessibilityHint={tr("Hold to record. Slide up to lock.")}
        accessibilityActions={[{ name: "activate", label: tr("Record hands-free") }]}
        onAccessibilityAction={() => { setP("holding"); void begin().then(() => setP("locked")); }}
        testID="voice-record"
        style={[styles.mic, { backgroundColor: holding ? t.danger : "transparent", transform: [{ scale: holding ? 1.15 : 1 }] }]}
      >
        <Ionicons name="mic-outline" size={23} color={holding ? "#fff" : t.text2} />
      </View>
    </View>
  );
}

/** Play, pause, seek by tapping the waveform, and 1×/1.5×/2×. */
export function VoicePlayer({ uri, duration, waveform, mine, compact, onHold }: { uri: string; duration: number | null; waveform: number[]; mine: boolean; compact?: boolean; onHold?: () => void }) {
  if (!Audio) return <Text style={{ fontSize: 13, opacity: 0.8 }}>Voice message · {formatDuration(duration)}</Text>;
  return <Player A={Audio} uri={uri} duration={duration} waveform={waveform} mine={mine} compact={compact} onHold={onHold} />;
}

const RATES = [1, 1.5, 2];

function Player({ A, uri, duration, waveform, mine, compact, onHold }: { A: AudioModule; uri: string; duration: number | null; waveform: number[]; mine: boolean; compact?: boolean; onHold?: () => void }) {
  const t = useTheme(), tr = useT();
  const player = A.useAudioPlayer(uri, { updateInterval: 200 });
  const status = A.useAudioPlayerStatus(player);
  const [rate, setRate] = useState(1);
  const [width, setWidth] = useState(1);
  const total = status.duration || duration || 0;
  const progress = total ? Math.min(1, status.currentTime / total) : 0;
  const ink = mine ? t.brandInk : t.text;

  useEffect(() => {
    if (status.didJustFinish) { player.pause(); void player.seekTo(0); }
  }, [status.didJustFinish, player]);

  const toggle = () => {
    if (status.playing) player.pause();
    else {
      void A.setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      player.play();
    }
  };
  const nextRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    player.setPlaybackRate(next);
  };

  return (
    <View style={[styles.player, compact && { minWidth: 0 }]}>
      <Pressable onPress={toggle} onLongPress={onHold} delayLongPress={280} accessibilityRole="button" accessibilityLabel={status.playing ? tr("Pause voice message") : tr("Play voice message")} style={[styles.play, { backgroundColor: mine ? "rgba(255,255,255,0.22)" : t.surface2 }]}>
        <Ionicons name={status.playing ? "pause" : "play"} size={18} color={ink} />
      </Pressable>
      <Pressable style={{ flex: 1 }} onLongPress={onHold} delayLongPress={280} onLayout={e => setWidth(e.nativeEvent.layout.width || 1)}
        onPress={e => { if (total) void player.seekTo((e.nativeEvent.locationX / width) * total); }}
        accessibilityRole="adjustable" accessibilityLabel={tr("Voice message position")}
        accessibilityValue={{ text: `${formatDuration(status.currentTime)} / ${formatDuration(total)}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={e => { void player.seekTo(Math.max(0, Math.min(total, status.currentTime + (e.nativeEvent.actionName === "increment" ? 5 : -5)))); }}>
        <Waveform levels={waveform} progress={progress} color={ink} faded={mine ? "rgba(255,255,255,0.35)" : t.line} />
      </Pressable>
      <Text style={{ color: ink, fontSize: 12, minWidth: 34, fontVariant: ["tabular-nums"] }}>{formatDuration(status.playing || status.currentTime ? status.currentTime : total)}</Text>
      <Pressable onPress={nextRate} onLongPress={onHold} delayLongPress={280} accessibilityRole="button" accessibilityLabel={tr("Playback speed {rate}", { rate: `${rate}×` })} style={[styles.rate, { borderColor: mine ? "rgba(255,255,255,0.4)" : t.line }]}>
        <Text style={{ color: ink, fontSize: 11, fontWeight: "700" }}>{rate}×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wave: { flexDirection: "row", alignItems: "center", flex: 1 },
  panel: { flex: 1, minHeight: 52, flexDirection: "row", alignItems: "center", gap: sp[2], borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  mic: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  hint: { position: "absolute", bottom: 50, right: 0, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, overflow: "hidden", width: 120, textAlign: "center" },
  player: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 220 },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rate: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 34, alignItems: "center" },
});
