/**
 * Image uploads — `POST /uploads`, backed by Azure Blob Storage.
 *
 * One endpoint for every kind of image; `kind` only picks the folder. The
 * server names the blob by UUID and refuses anything that is not an image.
 *
 * **What comes back depends on the kind.** `product` and `profile` land in a
 * public container and return an immutable URL to persist on the record.
 * `attachment` is PRIVATE — a force-closure's evidence carries a customer's
 * name and signature — so it returns an opaque blob NAME, and the file is read
 * back later through a short-lived signed link. Both arrive in the same field;
 * the caller knows which it asked for.
 */

import { apiUpload } from "./http";

/** Folder on the server. Mirrors `Kind` in app/features/uploads/router.py. */
export type UploadKind = "product" | "profile" | "attachment";

/** Mirrors MAX_UPLOAD_BYTES in app/integrations/blob.py. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Stores one image and resolves to what the record should keep — a public URL
 * for `product` and `profile`, an opaque blob name for `attachment`. Throws an
 * `ApiError`.
 */
export async function uploadImage(
  file: Blob,
  kind: UploadKind = "product"
): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Images must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`
    );
  }

  const form = new FormData();
  // The filename is cosmetic — the server renames to a UUID — but a part with
  // no filename is not treated as a file upload at all.
  form.append("file", file, `${kind}.${EXTENSIONS[file.type] ?? "img"}`);

  const { url } = await apiUpload<{ url: string }>(
    `/uploads?kind=${kind}`,
    form
  );
  return url;
}
