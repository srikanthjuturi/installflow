import {
  baseShortLabel,
  baseSummary,
  needsBaseLocation,
} from '@/features/base-location/lib/baseSummary';
import type { BaseLocation } from '@/types/domain';

const base = (over: Partial<BaseLocation> = {}): BaseLocation => ({
  latitude: 17.49,
  longitude: 78.35,
  pincode: null,
  source: 'gps',
  setAt: '2026-10-15T05:30:00Z',
  setBySelf: true,
  ...over,
});

describe('needsBaseLocation', () => {
  it('is true only for an explicit null', () => {
    expect(needsBaseLocation({ baseLocation: null })).toBe(true);
  });

  it('is false for undefined: an API that predates the field is unknown, not "not set"', () => {
    expect(needsBaseLocation({})).toBe(false);
  });

  it('is false once a base exists', () => {
    expect(needsBaseLocation({ baseLocation: base() })).toBe(false);
  });

  it('is false with no technician at all', () => {
    expect(needsBaseLocation(null)).toBe(false);
    expect(needsBaseLocation(undefined)).toBe(false);
  });
});

describe('baseSummary', () => {
  it('names the pincode for a pincode base', () => {
    expect(baseSummary(base({ source: 'pincode', pincode: '500049' }))).toEqual({
      key: 'baseLocation.current.pincode',
      params: { pincode: '500049' },
    });
  });

  it('words gps and map', () => {
    expect(baseSummary(base({ source: 'gps' })).key).toBe('baseLocation.current.gps');
    expect(baseSummary(base({ source: 'map' })).key).toBe('baseLocation.current.map');
  });

  it('says set by your manager for a manual source', () => {
    expect(baseSummary(base({ source: 'manual', setBySelf: false })).key).toBe(
      'baseLocation.current.byManager',
    );
  });

  it('says set by your manager whenever setBySelf is false, whatever the source', () => {
    expect(baseSummary(base({ source: 'map', setBySelf: false })).key).toBe(
      'baseLocation.current.byManager',
    );
  });

  it('falls back to plain Set for a source this build does not know', () => {
    expect(baseSummary(base({ source: 'satellite' })).key).toBe('baseLocation.current.set');
  });

  it('falls back to plain Set for a pincode base that carries no pincode', () => {
    expect(baseSummary(base({ source: 'pincode', pincode: null })).key).toBe(
      'baseLocation.current.set',
    );
  });
});

describe('baseShortLabel', () => {
  it('is the pincode digits for a pincode base', () => {
    expect(baseShortLabel(base({ source: 'pincode', pincode: '500049' }))).toBe('500049');
  });

  it('is a short word otherwise', () => {
    expect(baseShortLabel(base({ source: 'gps' }))).toBe('Your location');
    expect(baseShortLabel(base({ source: 'map' }))).toBe('Map pin');
    expect(baseShortLabel(base({ source: 'manual', setBySelf: false }))).toBe('By manager');
    expect(baseShortLabel(base({ source: 'satellite' }))).toBe('Set');
  });
});
