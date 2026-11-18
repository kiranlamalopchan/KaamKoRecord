"""
What a chat attachment becomes before it is kept.

Every file is checked by what it is, not by what the phone says it is: a
photo has to open as an image, a video and a voice message have to probe
as one with ffprobe, a document has to start with the signature of its
type. What is kept is re-made here — a photo re-encoded (which drops its
GPS and other EXIF), a video and a voice message re-encoded by ffmpeg — so
nothing a sender crafted reaches a recipient byte for byte, except
documents, which are only ever offered as a download.

Limits are KaamKoRecord's own defaults and can be changed with
settings.CHAT_MEDIA (any of the keys in DEFAULTS).
"""

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile

MB = 1024 * 1024

DEFAULTS = {
    "photo_max_bytes": 25 * MB,
    "photo_batch": 10,
    "photo_standard_side": 1600,
    "photo_standard_quality": 75,
    "photo_hd_side": 2560,
    "photo_hd_quality": 88,
    "thumb_side": 320,
    "video_max_bytes": 100 * MB,
    "video_max_seconds": 5 * 60,
    "video_standard_short_side": 720,
    "video_hd_short_side": 1080,
    "video_standard_bitrate": "1500k",
    "video_hd_bitrate": "3000k",
    "video_fps": 30,
    "audio_max_seconds": 10 * 60,
    "audio_max_bytes": 10 * MB,
    "audio_bitrate": "32k",
    "file_max_bytes": 100 * MB,
    "transcode_timeout": 300,
}


def limit(name):
    return {**DEFAULTS, **getattr(settings, "CHAT_MEDIA", {})}[name]


def public_limits():
    """What the app shows before somebody picks something too big."""
    return {
        "photo_max_bytes": limit("photo_max_bytes"),
        "photo_batch": limit("photo_batch"),
        "video_max_bytes": limit("video_max_bytes"),
        "video_max_seconds": limit("video_max_seconds"),
        "audio_max_seconds": limit("audio_max_seconds"),
        "audio_max_bytes": limit("audio_max_bytes"),
        "file_max_bytes": limit("file_max_bytes"),
        "file_types": sorted(DOCUMENT_TYPES),
    }


@dataclass
class Processed:
    kind: str
    file: ContentFile
    content_type: str
    display_name: str = ""
    poster: ContentFile | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    quality: str = ""
    waveform: list = field(default_factory=list)

    @property
    def size(self):
        return self.file.size


def _megabytes(size):
    return f"{size // MB} MB"


def _size(upload):
    return int(getattr(upload, "size", 0) or 0)


# ---- photos -------------------------------------------------------------------

def process_photo(upload, quality="standard"):
    """A JPEG (or WebP where the picture has see-through parts) and its thumbnail."""
    from PIL import Image, ImageOps

    hd = quality == "hd"
    if _size(upload) > limit("photo_max_bytes"):
        raise ValidationError(f"Photos can be up to {_megabytes(limit('photo_max_bytes'))}.")
    side = limit("photo_hd_side" if hd else "photo_standard_side")
    jpeg_quality = limit("photo_hd_quality" if hd else "photo_standard_quality")
    try:
        upload.seek(0)
        image = Image.open(upload)
        if image.width * image.height > 60_000_000:
            raise ValidationError("That photo is too large to send.")
        image = ImageOps.exif_transpose(image)
        transparent = image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)
        image = image.convert("RGBA" if transparent else "RGB")
        # thumbnail() never enlarges, and keeps the aspect ratio.
        image.thumbnail((side, side), Image.Resampling.LANCZOS)
        thumb = image.copy()
        thumb.thumbnail((limit("thumb_side"), limit("thumb_side")), Image.Resampling.LANCZOS)
        fmt, ext, content_type = ("WEBP", "webp", "image/webp") if transparent else ("JPEG", "jpg", "image/jpeg")
        out, small = BytesIO(), BytesIO()
        # No exif= argument: the GPS, camera and every other tag stay behind.
        extra = {"optimize": True} if fmt == "JPEG" else {}
        image.save(out, format=fmt, quality=jpeg_quality, **extra)
        thumb.save(small, format=fmt, quality=70)
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError("Choose a valid photo and try again.") from exc
    return Processed(
        kind="photo", file=ContentFile(out.getvalue(), name=f"photo.{ext}"), content_type=content_type,
        poster=ContentFile(small.getvalue(), name=f"thumb.{ext}"),
        width=image.width, height=image.height, quality="hd" if hd else "standard",
    )


# ---- video and audio ------------------------------------------------------------

def _on_disk(upload):
    path = getattr(upload, "temporary_file_path", None)
    path = path() if callable(path) else None
    if path:
        return path, False
    ext = Path(getattr(upload, "name", "") or "").suffix[:8] or ".bin"
    made = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    upload.seek(0)
    for chunk in upload.chunks():
        made.write(chunk)
    made.close()
    upload.seek(0)
    return made.name, True


def _drop(path):
    try:
        os.unlink(path)
    except OSError:
        pass


def probe(path):
    """ffprobe's reading of a file, or None without ffprobe or for a file it can't read."""
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, timeout=30,
        )
        data = json.loads(out.stdout or b"{}")
    except Exception:
        return None
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = (data.get("format") or {}).get("duration") or (video or audio or {}).get("duration")
    info = {"duration": float(duration) if duration else None, "video": None, "audio": audio is not None}
    if video:
        width, height = int(video.get("width") or 0), int(video.get("height") or 0)
        rotation = 0
        for side in video.get("side_data_list") or []:
            if "rotation" in side:
                rotation = int(float(side["rotation"]))
        rotation = rotation or int(float((video.get("tags") or {}).get("rotate", 0) or 0))
        if rotation % 180:
            width, height = height, width
        info["video"] = {"width": width, "height": height, "codec": (video.get("codec_name") or "").lower()}
    return info


def _ffmpeg(args, timeout):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, timeout=timeout, check=True)


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def process_video(upload, quality="standard"):
    """
    H.264/AAC in an MP4, no bigger than 720p (Standard) or 1080p (HD) on
    its short side, at most 30 fps, with a poster frame. Never enlarged.
    Refused, never cut, when it is longer than allowed: the app trims
    before sending, so nothing is silently lost.
    """
    hd = quality == "hd"
    if _size(upload) > limit("video_max_bytes"):
        raise ValidationError(
            f"Videos can be up to {_megabytes(limit('video_max_bytes'))}. Trim it or choose Standard quality and try again."
        )
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise ValidationError("Videos can't be sent right now. Please try again later.")
    src, made = _on_disk(upload)
    out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    out.close()
    poster = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    poster.close()
    try:
        info = probe(src)
        if not info or not info["video"] or not info["video"]["width"]:
            raise ValidationError("That file isn't a video we can play. Choose another one.")
        seconds = info["duration"] or 0
        if seconds > limit("video_max_seconds") + 0.5:
            minutes = limit("video_max_seconds") // 60
            raise ValidationError(f"Videos can be up to {minutes} minutes. Trim it and try again.")
        cap = limit("video_hd_short_side" if hd else "video_standard_short_side")
        bitrate = limit("video_hd_bitrate" if hd else "video_standard_bitrate")
        scale = f"scale=w='if(gt(iw,ih),-2,min(iw,{cap}))':h='if(gt(iw,ih),min(ih,{cap}),-2)'"
        try:
            _ffmpeg([
                # -fpsmax lowers 60 fps to 30 and leaves 24 fps alone.
                "-i", src, "-vf", scale, "-fpsmax", str(limit("video_fps")),
                "-c:v", "libx264", "-preset", "veryfast", "-b:v", bitrate, "-maxrate", bitrate,
                "-bufsize", "2M", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k", "-ac", "2",
                "-movflags", "+faststart", "-map_metadata", "-1", out.name,
            ], limit("transcode_timeout"))
        except Exception as exc:
            raise ValidationError("We couldn't prepare that video. Try a shorter clip or Standard quality.") from exc
        result = probe(out.name)
        if not result or not result["video"]:
            raise ValidationError("We couldn't prepare that video. Try a shorter clip or Standard quality.")
        try:
            _ffmpeg(["-ss", "0.1", "-i", out.name, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", poster.name], 30)
            poster_bytes = _read(poster.name)
        except Exception:
            poster_bytes = b""
        data = _read(out.name)
        if len(data) > limit("video_max_bytes"):
            raise ValidationError("That video is still too big after compressing. Trim it or choose Standard quality.")
        return Processed(
            kind="video", file=ContentFile(data, name="video.mp4"), content_type="video/mp4",
            poster=ContentFile(poster_bytes, name="poster.jpg") if poster_bytes else None,
            duration=round(result["duration"] or seconds, 2),
            width=result["video"]["width"], height=result["video"]["height"], quality="hd" if hd else "standard",
        )
    finally:
        if made:
            _drop(src)
        _drop(out.name)
        _drop(poster.name)


def clean_waveform(raw):
    """Up to 64 whole numbers from 0 to 100; anything else is dropped."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    if not isinstance(raw, list):
        return []
    levels = []
    for value in raw[:64]:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return []
        levels.append(max(0, min(100, int(value))))
    return levels


def process_audio(upload, waveform=None):
    """A voice message as mono AAC (.m4a), which every iPhone and Android plays."""
    if _size(upload) > max(limit("audio_max_bytes") * 4, 40 * MB):
        raise ValidationError("That voice message is too long to send.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise ValidationError("Voice messages can't be sent right now. Please try again later.")
    src, made = _on_disk(upload)
    out = tempfile.NamedTemporaryFile(suffix=".m4a", delete=False)
    out.close()
    try:
        info = probe(src)
        if not info or not info["audio"]:
            raise ValidationError("That recording couldn't be read. Record it again.")
        seconds = info["duration"] or 0
        if seconds > limit("audio_max_seconds") + 0.5:
            raise ValidationError(f"Voice messages can be up to {limit('audio_max_seconds') // 60} minutes.")
        if seconds < 0.3:
            raise ValidationError("That voice message is too short. Hold to record a little longer.")
        try:
            _ffmpeg([
                "-i", src, "-vn", "-ac", "1", "-c:a", "aac", "-b:a", limit("audio_bitrate"),
                "-movflags", "+faststart", "-map_metadata", "-1", out.name,
            ], limit("transcode_timeout"))
        except Exception as exc:
            raise ValidationError("That recording couldn't be read. Record it again.") from exc
        data = _read(out.name)
        if len(data) > limit("audio_max_bytes"):
            raise ValidationError("That voice message is too long to send.")
        return Processed(
            kind="audio", file=ContentFile(data, name="voice.m4a"), content_type="audio/mp4",
            display_name="Voice message", duration=round(seconds, 2), waveform=clean_waveform(waveform),
        )
    finally:
        if made:
            _drop(src)
        _drop(out.name)


# ---- documents -----------------------------------------------------------------

ZIP = b"PK\x03\x04"
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
# extension -> (content type, accepted file signatures; None = plain text)
DOCUMENT_TYPES = {
    "pdf": ("application/pdf", (b"%PDF-",)),
    "doc": ("application/msword", (OLE,)),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", (ZIP,)),
    "xls": ("application/vnd.ms-excel", (OLE,)),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (ZIP,)),
    "ppt": ("application/vnd.ms-powerpoint", (OLE,)),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", (ZIP,)),
    "zip": ("application/zip", (ZIP, b"PK\x05\x06")),
    "txt": ("text/plain", None),
    "csv": ("text/csv", None),
}


def safe_filename(name):
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"/\\|?*').strip(". ")
    return name[:180] or "file"


def process_file(upload):
    """A document from the allowed list, its first bytes matching its type."""
    if _size(upload) > limit("file_max_bytes"):
        raise ValidationError(f"Files can be up to {_megabytes(limit('file_max_bytes'))}.")
    if _size(upload) == 0:
        raise ValidationError("That file is empty.")
    name = safe_filename(getattr(upload, "name", ""))
    ext = Path(name).suffix.lower().lstrip(".")
    if ext not in DOCUMENT_TYPES:
        allowed = ", ".join(sorted(DOCUMENT_TYPES)).upper()
        raise ValidationError(f"That type of file can't be sent. You can send {allowed}.")
    content_type, signatures = DOCUMENT_TYPES[ext]
    upload.seek(0)
    head = upload.read(4096)
    upload.seek(0)
    if signatures is None:
        if b"\x00" in head:
            raise ValidationError("That file doesn't look like a text file.")
        try:
            head.decode("utf-8")
        except UnicodeDecodeError as exc:
            # A cut in the middle of a multi-byte letter is fine; anything else is not text.
            if exc.start < len(head) - 4:
                raise ValidationError("That file doesn't look like a text file.") from exc
    elif not any(head.startswith(sig) for sig in signatures):
        raise ValidationError("That file doesn't match its type. Check the file and try again.")
    data = b"".join(upload.chunks())
    return Processed(
        kind="file", file=ContentFile(data, name=f"file.{ext}"), content_type=content_type, display_name=name,
    )
