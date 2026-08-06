/**
 * Turn a source image plus a crop rectangle into a square avatar data URL.
 *
 * `react-easy-crop` reports the crop as pixel coordinates on the *natural*
 * image; this draws that rectangle onto a fixed-size square canvas so every
 * saved avatar is the same resolution regardless of the source photo. Output
 * is WebP when the browser encodes it (all our targets do) and JPEG otherwise
 * — never PNG, which would triple the size of a photograph for no gain.
 */

/** The crop rectangle react-easy-crop hands back, in natural-image pixels. */
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Side length of the exported square, in pixels. 512 is crisp on retina. */
const OUTPUT_SIZE = 512;
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

export async function getCroppedImage(
  src: string,
  crop: PixelCrop
): Promise<string> {
  const image = await loadImage(src);

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");

  // Draw only the cropped rectangle, scaled to fill the square output.
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  );

  // A browser that cannot encode WebP silently returns a PNG data URL from
  // toDataURL; asking for JPEG as the fallback keeps photos small either way.
  const webp = canvas.toDataURL("image/webp", OUTPUT_QUALITY);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/jpeg", OUTPUT_QUALITY);
}
