import { LIMITS } from "./constants.js";

const MAX_SIDE = 1024;

async function load(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to an image element.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That file is not a picture Homi can read.");
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

// Shrinks a picture to a small JPEG data URL that is stored with the notice, so
// it works offline and syncs like any other part of the notice.
export async function shrinkImage(file: Blob): Promise<string> {
  const loaded = await load(file);
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(loaded.width, loaded.height));
    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(loaded.width * scale));
      const height = Math.max(1, Math.round(loaded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot shrink pictures.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(loaded.source, 0, 0, width, height);
      for (const quality of [0.8, 0.7, 0.6, 0.5]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (url.length <= LIMITS.image) return url;
      }
      scale *= 0.75;
    }
    throw new Error("That picture is too detailed to shrink enough.");
  } finally {
    loaded.release();
  }
}
