/**
 * Turn a source image plus a crop rectangle into an encoded image.
 *
 * `react-easy-crop` reports the crop as pixel coordinates on the *natural*
 * image; this draws that rectangle onto a fixed-size canvas so every saved
 * image is the same resolution regardless of the source photo. Output is WebP
 * when the browser encodes it (all our targets do) and JPEG otherwise — never
 * PNG, which would triple the size of a photograph for no gain.
 *
 * A Blob is the only output, because `POST /uploads` is the only destination:
 * nothing in this console persists an image inline any more.
 */

/** The crop rectangle react-easy-crop hands back, in natural-image pixels. */
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Side length of the exported square, in pixels. 512 is crisp on retina. */
export const DEFAULT_OUTPUT_SIZE = 512;
const OUTPUT_QUALITY = 0.9;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Data/blob URLs are same-origin, but this keeps the canvas untainted if a
    // remote URL is ever passed in.
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error("Could not load the selected image."))
    );
    image.src = src;
  });
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, OUTPUT_QUALITY));
}

export async function getCroppedBlob(
  src: string,
  crop: PixelCrop,
  { width = DEFAULT_OUTPUT_SIZE, height = DEFAULT_OUTPUT_SIZE } = {}
): Promise<Blob> {
  const image = await loadImage(src);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");

  // Draw only the cropped rectangle, scaled to fill the output.
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  // A browser that cannot encode WebP silently hands back a PNG from toBlob;
  // asking for JPEG as the fallback keeps photos small either way.
  const webp = await encode(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;

  const jpeg = await encode(canvas, "image/jpeg");
  if (jpeg) return jpeg;

  throw new Error("Could not process that image. Try a different one.");
}

