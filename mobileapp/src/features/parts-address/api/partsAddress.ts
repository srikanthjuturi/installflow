import { ApiError, authedRequest } from '@/lib/api';
import type { PartsAddressBody } from '@/features/parts-address/lib/schema';

/**
 * Where a spare part is sent.
 *
 *   getPartsAddress    → GET    /technicians/me/parts-address   (null = none saved)
 *   savePartsAddress   → PUT    /technicians/me/parts-address
 *   removePartsAddress → DELETE /technicians/me/parts-address
 *
 * With none saved a request goes to the technician's base pincode area. The
 * server copies the address onto each request when it is raised, so editing it
 * later never redirects a part already on its way.
 */
export interface PartsAddress {
  line: string;
  city: string;
  pincode: string;
  landmark: string | null;
  contactPhone: string | null;
  setAt: string;
}

export async function getPartsAddress(): Promise<PartsAddress | null> {
  const data = await authedRequest<PartsAddress | null>('/technicians/me/parts-address');
  return data ?? null;
}

export function savePartsAddress(body: PartsAddressBody): Promise<PartsAddress> {
  return authedRequest<PartsAddress>('/technicians/me/parts-address', { method: 'PUT', body });
}

export async function removePartsAddress(): Promise<void> {
  await authedRequest<unknown>('/technicians/me/parts-address', { method: 'DELETE' });
}

/** True for the 422 the pincode field words itself. */
export function isUnknownPincode(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNKNOWN_PINCODE';
}
