/**
 * Choosing what to attach: photos (several), a video, a photo or video
 * from the camera, a document. Limits come from the server (ConvoPage.limits)
 * and are checked here first, so somebody hears "too long" before a minute
 * of uploading rather than after it.
 *
 * On-device processing is what the system pickers offer: iOS converts to
 * H.264 and lets the person trim when one video is chosen; Android hands
 * the file over as it is. The server then re-encodes every video to its
 * Standard or HD size (apps/chat/media.py), so a phone that can't compress
 * still sends something every phone can play.
 */
import type { FilePart } from "@/api/client";
import type { ChatLimits } from "@/api/types";
import { native } from "@/ui/native";

export type Picked =
  | { kind: "photos"; files: (FilePart & { width?: number; height?: number })[] }
  | { kind: "video"; files: FilePart[]; duration: number; size: number | null }
  | { kind: "file"; files: FilePart[]; size: number | null };

export class TooBig extends Error {}

type Picker = typeof import("expo-image-picker");
const picker = () => native<Picker>(() => require("expo-image-picker"));

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

function checkVideo(asset: { duration?: number | null; fileSize?: number | null }, limits: ChatLimits) {
  const seconds = (asset.duration ?? 0) / 1000;
  if (seconds > limits.video_max_seconds + 0.5) {
    throw new TooBig(`Videos can be up to ${Math.round(limits.video_max_seconds / 60)} minutes. Trim it and try again.`);
  }
  if (asset.fileSize && asset.fileSize > limits.video_max_bytes) {
    throw new TooBig(`Videos can be up to ${mb(limits.video_max_bytes)}. Trim it or choose a shorter clip.`);
  }
}

function photoPart(asset: { uri: string; fileName?: string | null; mimeType?: string | null; width: number; height: number }, n: number) {
  return { uri: asset.uri, name: asset.fileName || `photo-${Date.now()}-${n}.jpg`, type: asset.mimeType || "image/jpeg", width: asset.width, height: asset.height };
}

/** Photos and videos from the library. One video, or up to `photo_batch` photos. */
export async function pickFromLibrary(limits: ChatLimits): Promise<Picked | null> {
  const P = picker();
  const permission = await P.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo access in Settings to send photos and videos.");
  const result = await P.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: limits.photo_batch,
    quality: 1,
    exif: false,
    videoMaxDuration: limits.video_max_seconds,
    // iOS: hand over H.264 rather than HEVC, which older Android phones can't play.
    preferredAssetRepresentationMode: P.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    videoQuality: P.UIImagePickerControllerQualityType.High,
  });
  if (result.canceled || !result.assets.length) return null;
  const videos = result.assets.filter(asset => asset.type === "video");
  if (videos.length) {
    if (videos.length > 1 || result.assets.length > 1) throw new TooBig("Send one video at a time, or only photos.");
    const video = videos[0];
    checkVideo(video, limits);
    return {
      kind: "video",
      files: [{ uri: video.uri, name: video.fileName || `video-${Date.now()}.mp4`, type: video.mimeType || "video/mp4" }],
      duration: (video.duration ?? 0) / 1000,
      size: video.fileSize ?? null,
    };
  }
  for (const asset of result.assets) {
    if (asset.fileSize && asset.fileSize > limits.photo_max_bytes) throw new TooBig(`Photos can be up to ${mb(limits.photo_max_bytes)}.`);
  }
  return { kind: "photos", files: result.assets.slice(0, limits.photo_batch).map(photoPart) };
}

/** One video, with the system's trimmer where the phone has one (iOS). */
export async function pickVideoToTrim(limits: ChatLimits): Promise<Picked | null> {
  const P = picker();
  const permission = await P.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo access in Settings to send videos.");
  const result = await P.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    allowsEditing: true,
    videoMaxDuration: limits.video_max_seconds,
    preferredAssetRepresentationMode: P.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    videoQuality: P.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets.length) return null;
  const video = result.assets[0];
  checkVideo(video, limits);
  return {
    kind: "video",
    files: [{ uri: video.uri, name: video.fileName || `video-${Date.now()}.mp4`, type: video.mimeType || "video/mp4" }],
    duration: (video.duration ?? 0) / 1000,
    size: video.fileSize ?? null,
  };
}

/** A photo or a video from the camera. */
export async function capture(limits: ChatLimits): Promise<Picked | null> {
  const P = picker();
  const permission = await P.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("Allow camera access in Settings to take photos and videos.");
  const result = await P.launchCameraAsync({
    mediaTypes: ["images", "videos"],
    quality: 0.9,
    exif: false,
    videoMaxDuration: limits.video_max_seconds,
    videoQuality: P.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];
  if (asset.type === "video") {
    checkVideo(asset, limits);
    return {
      kind: "video",
      files: [{ uri: asset.uri, name: asset.fileName || `video-${Date.now()}.mp4`, type: asset.mimeType || "video/mp4" }],
      duration: (asset.duration ?? 0) / 1000,
      size: asset.fileSize ?? null,
    };
  }
  return { kind: "photos", files: [photoPart(asset, 0)] };
}

/** A document from Files. The server checks its type again by its first bytes. */
export async function pickDocument(limits: ChatLimits): Promise<Picked | null> {
  const D = native<typeof import("expo-document-picker")>(() => require("expo-document-picker"));
  const result = await D.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const doc = result.assets[0];
  const ext = (doc.name.split(".").pop() || "").toLowerCase();
  if (!limits.file_types.includes(ext)) {
    throw new TooBig(`That type of file can't be sent. You can send ${limits.file_types.map(type => type.toUpperCase()).join(", ")}.`);
  }
  if (doc.size && doc.size > limits.file_max_bytes) throw new TooBig(`Files can be up to ${mb(limits.file_max_bytes)}.`);
  return { kind: "file", files: [{ uri: doc.uri, name: doc.name, type: doc.mimeType || "application/octet-stream" }], size: doc.size ?? null };
}
