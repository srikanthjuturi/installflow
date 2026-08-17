import { authedRequest } from '@/lib/api';

/**
 * Sending an image to the server: the FILE goes to blob storage, the record
 * keeps the URL.
 *
 * A local `file://` uri is meaningless to the server — it names a path inside
 * this app's sandbox — and base64 in a JSON body would put tens of kilobytes
 * into a column that rides along in every list response naming that person. So
 * a picked or captured photo is never sent as either; it is uploaded here and
 * what gets stored is the URL that comes back.
 */

/** Folder on the server. Mirrors `Kind` in app/features/uploads/router.py. */
export type UploadKind = 'product' | 'profile';

/** React Native's multipart file part — not a web `File`, which RN has no way
 *  to build from a uri. fetch reads the path itself. */
interface FilePart {
  uri: string;
  name: string;
  type: string;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

function partFor(uri: string, kind: UploadKind): FilePart {
  const extension = uri.split('.').pop()?.toLowerCase() ?? '';
  // The crop screen saves JPEG, so that is the honest default when a uri has
  // no extension — an unrecognised content type is refused by the server.
  const type = MIME[extension] ?? 'image/jpeg';
  return { uri, name: `${kind}.${extension || 'jpg'}`, type };
}

/**
 * Uploads a local image file and resolves to its stored URL.
 *
 * Requires a signed-in session: `POST /uploads` takes any principal but no
 * anonymous caller, which is why a self-registering technician's photo can
 * only be sent AFTER their account exists.
 */
export async function uploadImage(uri: string, kind: UploadKind = 'profile'): Promise<string> {
  const form = new FormData();
  // The cast is the documented RN escape hatch: FormData's web typing wants a
  // Blob, and RN's runtime wants this object.
  form.append('file', partFor(uri, kind) as unknown as Blob);

  const { url } = await authedRequest<{ url: string }>(`/uploads?kind=${kind}`, {
    method: 'POST',
    body: form,
  });
  return url;
}
