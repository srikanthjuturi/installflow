import { ApiError, authedRequest } from '@/lib/api';
import type { BaseLocation } from '@/types/domain';

/**
 * The technician's own base — where travel allowance is measured from.
 *
 *   saveMyBaseLocation → PUT /technicians/me/base-location
 *
 * The base itself rides on `GET /technicians/me` (`baseLocation`), so there is
 * no read here: Home and Profile already read `me`.
 *
 * Exactly one of two bodies. The phone sends only `pincode`, `gps` or `map`,
 * never `manual` — that is a coordinate a manager types in the console. There
 * is no DELETE: a base is moved, never removed.
 */
export type BaseLocationBody =
  | { pincode: string }
  | { latitude: number; longitude: number; source: 'gps' | 'map' };

/**
 * A refusal the screen words itself, so it can tell WHICH option refused.
 * Switched on the envelope's `code`, the `PayoutCodeError` precedent.
 */
export type BaseLocationRefusal =
  | 'PINCODE_OUTSIDE_FRANCHISEE'
  | 'PINCODE_HAS_NO_LOCATION'
  | 'BASE_OUTSIDE_INDIA';

const REFUSALS: readonly BaseLocationRefusal[] = [
  'PINCODE_OUTSIDE_FRANCHISEE',
  'PINCODE_HAS_NO_LOCATION',
  'BASE_OUTSIDE_INDIA',
];

export class BaseLocationError extends Error {
  constructor(
    readonly code: BaseLocationRefusal,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BaseLocationError';
  }
}

export async function saveMyBaseLocation(body: BaseLocationBody): Promise<BaseLocation> {
  try {
    return await authedRequest<BaseLocation>('/technicians/me/base-location', {
      method: 'PUT',
      body,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const refusal = REFUSALS.find((c) => c === error.code);
      if (refusal) throw new BaseLocationError(refusal, error.message, error.status);
    }
    throw error;
  }
}
