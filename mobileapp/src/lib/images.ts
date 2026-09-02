import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Getting a picked photo down to a size the crop screen can safely work on.
 *
 * A phone camera's photo is enormous and almost none of it survives: the avatar
 * that ships is 512×512. Carrying the full resolution as far as the crop is
 * what made the app vanish on Done. `expo-image-loader` hands the manipulator a
 * bitmap at SIZE_ORIGINAL, so a 50MP photo decodes to ~200MB of pixels, and
 * cropping THAT allocates a second bitmap nearly as large before the resize
 * shrinks anything. Bitmap pixels are a native allocation on Android 8+, so
 * exhausting them aborts the process — no JS error, no red box, nothing any
 * `catch` can reach. The app simply closes.
 *
 * Downscaling first means one large bitmap exists at a time instead of two, and
 * every step after it is small.
 */

/**
 * Longest edge the crop screen works on.
 *
 * Exactly four times the 512 output, which is also the crop screen's maximum
 * pinch — so even fully zoomed in the photo is never upscaled and nothing
 * visible is lost. One bitmap at this size is ~16MB.
 */
const WORKING_EDGE = 2048;

export interface ImageSource {
  uri: string;
  width: number;
  height: number;
}

/** What the picker reported, or null when it reported nothing usable. */
function reportedSize(width: unknown, height: unknown): { width: number; height: number } | null {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return { width: w, height: h };
}

/** Landscape shrinks by width, portrait by height; the other side follows the ratio. */
const fitTo = (width: number, height: number) =>
  width >= height ? { width: WORKING_EDGE } : { height: WORKING_EDGE };

/**
 * Resolves to a copy no larger than {@link WORKING_EDGE} on its longest edge,
 * with dimensions that are known integers — which is what makes the crop
 * arithmetic downstream trustworthy.
 *
 * Rejects rather than returning the original on failure: a caller that cannot
 * open the photo needs to say so, not hand an unopenable file to the cropper.
 */
export async function toWorkingCopy(
  uri: string,
  width: unknown,
  height: unknown,
): Promise<ImageSource> {
  const reported = reportedSize(width, height);

  // Already small enough. Re-encoding it would only cost detail.
  if (reported && Math.max(reported.width, reported.height) <= WORKING_EDGE) {
    return { uri, ...reported };
  }

  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  if (reported) context.resize(fitTo(reported.width, reported.height));

  const rendered = await context.renderAsync();

  // Some Android providers report no size at all. Once the bitmap is decoded
  // its size is a fact — and manipulating the ImageRef re-uses that bitmap
  // rather than decoding the file a second time.
  const shrunk =
    !reported && Math.max(rendered.width, rendered.height) > WORKING_EDGE
      ? await ImageManipulator.ImageManipulator.manipulate(rendered)
          .resize(fitTo(rendered.width, rendered.height))
          .renderAsync()
      : rendered;

  const saved = await shrunk.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.92,
  });

  return { uri: saved.uri, width: saved.width, height: saved.height };
}
