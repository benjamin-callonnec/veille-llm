export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Longer sides are scaled down to this before sending: the model does not use more. */
export const MAX_SIDE = 1568;

export interface Picked {
  accepted: File[];
  /** A quiet message about what was refused, or null. */
  notice: string | null;
}

/** The images among some files (or clipboard items) that can still be attached. */
export function pickImages(files: File[], already: number): Picked {
  const images = files.filter((f) => f.type.startsWith("image/"));
  const accepted: File[] = [];
  let notice: string | null = null;
  for (const file of images) {
    if (!IMAGE_TYPES.includes(file.type)) notice = "Only PNG, JPEG, WebP and GIF images.";
    else if (file.size > MAX_IMAGE_BYTES) notice = "Images must be under 5 MB.";
    else if (already + accepted.length >= MAX_IMAGES) notice = `At most ${MAX_IMAGES} images.`;
    else accepted.push(file);
  }
  return { accepted, notice };
}

/** Image files of a paste or drop, from `files` and, as a fallback, from `items`. */
export function imagesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files];
  if (files.length === 0) {
    for (const item of data.items ?? []) {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  return files.filter((f) => f.type.startsWith("image/"));
}

export interface ImagePayload {
  name: string;
  mime: string;
  data: string;
}

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** A large still image is scaled down in the browser (never uploaded anywhere); else unchanged. */
export async function downscale(file: File): Promise<Blob> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
    if (ratio >= 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function toPayload(file: File): Promise<ImagePayload> {
  const blob = await downscale(file);
  return { name: file.name, mime: blob.type || file.type, data: await readBase64(blob) };
}
