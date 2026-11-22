"""Images pasted in the chat: strict checks on the bytes, never on what the client claims."""

import base64
import binascii
import hashlib
import re
from dataclasses import dataclass

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_ID = re.compile(r"[0-9a-f]{64}")
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}


class ImageError(ValueError):
    """A refused image: `reason` is a stable code, the message is for the user."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class Image:
    id: str
    mime: str
    data: bytes
    name: str | None = None


def sniff(data: bytes) -> str | None:
    """The MIME type from the magic bytes (png, jpeg, gif, webp), else None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_images(items: list[dict]) -> list[Image]:
    """Validate the images of a message: count, base64, size, real type."""
    if len(items) > MAX_IMAGES:
        raise ImageError("too_many_images", f"At most {MAX_IMAGES} images per message.")
    images = []
    for item in items:
        try:
            data = base64.b64decode(item["data"], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ImageError("bad_image", "An image could not be decoded.") from exc
        if len(data) > MAX_IMAGE_BYTES:
            raise ImageError("image_too_large", "An image is larger than 5 MB.")
        mime = sniff(data)
        if mime is None:
            raise ImageError("bad_image", "Only PNG, JPEG, WebP and GIF images are accepted.")
        name = (item.get("name") or "").strip()[:120] or None
        images.append(Image(hashlib.sha256(data).hexdigest(), mime, data, name))
    return images
