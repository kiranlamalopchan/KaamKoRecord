/**
 * Sending a message, with whatever is attached.
 *
 * Every send carries a client id made once, when the message is written,
 * and kept through every retry — the server answers a repeat with the
 * message the first try made, so a send whose answer was lost on a bad
 * connection never appears twice.
 *
 * Photos, a voice message and small files go in one request (with upload
 * progress). A video or a file over PIECED_AT goes in resumable pieces to
 * `uploads/` first: after a dropped connection the retry asks how much
 * arrived and carries on from there instead of starting again.
 */
import { api, formWith, type FilePart } from "@/api/client";
import { sizeOf } from "@/api/chunked";
import type { ConvoMessage } from "@/api/types";

export type OutgoingKind = "text" | "photos" | "video" | "audio" | "file";

export type Outgoing = {
  key: number;
  clientId: string;
  conversationId: string;
  body: string;
  kind: OutgoingKind;
  files: (FilePart & { width?: number; height?: number })[];
  quality: "standard" | "hd";
  replyTo?: number;
  waveform?: number[];
  duration?: number;
  /** Set once a pieced upload has started, so a retry resumes the same one. */
  uploadId?: string;
  state: "pending" | "sending" | "failed";
  progress: number;
  error?: unknown;
  createdAt: string;
};

export const PIECED_AT = 8 * 1024 * 1024;
const PIECE = 4 * 1024 * 1024;

type Legacy = typeof import("expo-file-system/legacy");
const fs = (): Legacy | null => {
  try { return require("expo-file-system/legacy") as Legacy; } catch { return null; }
};

function newUploadId(): string {
  let id = "";
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

/** Send `part` in pieces to uploads/, resuming from what the server already has. */
export async function uploadResumable(part: FilePart, size: number, uploadId: string, onProgress: (fraction: number) => void): Promise<void> {
  const FS = fs();
  if (!FS) throw new Error("This build can't send a file that large.");
  let have = 0;
  try {
    have = (await api<{ bytes: number }>("uploads/", { query: { upload_id: uploadId } })).bytes;
  } catch {
    have = 0;
  }
  // Only whole pieces are trusted; anything else starts again.
  if (have % PIECE !== 0 || have > size) have = 0;
  const total = Math.max(1, Math.ceil(size / PIECE));
  for (let index = Math.floor(have / PIECE); index < total; index++) {
    const position = index * PIECE;
    const data = await FS.readAsStringAsync(part.uri, { encoding: FS.EncodingType.Base64, position, length: Math.min(PIECE, size - position) });
    await api("uploads/", { method: "POST", body: { upload_id: uploadId, index, total, offset: position, data } });
    onProgress((index + 1) / total);
  }
}

/** Longest side sent for each quality; the server makes the final copy at 1600/2560. */
const PHOTO_SIDE = { standard: 1600, hd: 2560 };

/**
 * A photo made no bigger than its quality needs, on the phone, before it
 * goes: ten full-size photos would be most of a 100 MB request and a lot of
 * somebody's data. Only JPEG/HEIC photos with known dimensions larger than
 * needed are touched — never enlarged, and PNG/WebP (which may be see-
 * through) go as they are. One at a time, so a budget phone holds one
 * decoded photo in memory, not ten.
 */
export async function shrinkPhoto(file: FilePart & { width?: number; height?: number }, quality: "standard" | "hd"): Promise<FilePart> {
  const side = PHOTO_SIDE[quality];
  const longest = Math.max(file.width || 0, file.height || 0);
  if (!longest || longest <= side || /png|webp/i.test(file.type)) return file;
  try {
    const { ImageManipulator, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
    const context = ImageManipulator.manipulate(file.uri);
    context.resize((file.width || 0) >= (file.height || 0) ? { width: side } : { height: side });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality === "hd" ? 0.9 : 0.82 });
    return { uri: saved.uri, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg" };
  } catch {
    return file; // The server resizes anyway; this is only a saving.
  }
}

/** The form for photos (several under one name) and the other fields. */
export function photoForm(files: FilePart[], fields: Record<string, string | number | undefined>): FormData {
  const form = formWith(fields);
  for (const file of files) form.append("photos", file as unknown as Blob);
  return form;
}

/**
 * Send one outgoing message. `onProgress` is 0→1 over the upload; the
 * returned message is the server's. `onUploadId` lets the caller keep a
 * pieced upload's id for a retry.
 */
export async function sendOutgoing(o: Outgoing, onProgress: (fraction: number) => void, onUploadId: (id: string) => void): Promise<ConvoMessage> {
  const path = `messages/c/${o.conversationId}/`;
  const base = { body: o.body, client_id: o.clientId, reply_to: o.replyTo, quality: o.quality };
  if (o.kind === "text") {
    const sent = await api<ConvoMessage>(path, { method: "POST", body: base });
    onProgress(1);
    return sent;
  }
  if (o.kind === "photos") {
    const files: FilePart[] = [];
    for (const file of o.files) files.push(await shrinkPhoto(file, o.quality));
    return api<ConvoMessage>(path, { method: "POST", form: photoForm(files, base), onProgress });
  }
  const file = o.files[0];
  if (o.kind === "audio") {
    return api<ConvoMessage>(path, { method: "POST", form: formWith({ ...base, audio: file, waveform: JSON.stringify(o.waveform ?? []) }), onProgress });
  }
  const size = await sizeOf(file);
  if (size !== null && size > PIECED_AT) {
    const uploadId = o.uploadId || newUploadId();
    onUploadId(uploadId);
    // The pieces are most of the work; the last tenth is the server preparing it.
    await uploadResumable(file, size, uploadId, fraction => onProgress(fraction * 0.9));
    const sent = await api<ConvoMessage>(path, {
      method: "POST",
      body: { ...base, upload_id: uploadId, upload_kind: o.kind, upload_name: file.name },
    });
    onProgress(1);
    return sent;
  }
  return api<ConvoMessage>(path, { method: "POST", form: formWith({ ...base, [o.kind]: file }), onProgress });
}

/** How an attachment-only message reads in a preview. */
export function attachmentLabel(kind: string | null | undefined, count = 1): string {
  if (kind === "photo") return count > 1 ? `${count} photos` : "Photo";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Voice message";
  if (kind === "file") return "File";
  return "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
