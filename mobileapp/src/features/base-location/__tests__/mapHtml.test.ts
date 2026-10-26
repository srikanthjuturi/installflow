import { INDIA_CENTRE } from '@/features/base-location/lib/coords';
import { buildMapHtml } from '@/features/base-location/map/mapHtml';
import { color } from '@/theme/semantic';

const PIN = color.actionBg;
const RING = color.surfaceRaised;
const input = { lat: 17.44, lng: 78.35, zoom: 16, pinColor: PIN, ringColor: RING };

describe('buildMapHtml', () => {
  const html = buildMapHtml(input);

  it('uses the single OpenStreetMap tile host, not the retired {s} subdomains', () => {
    expect(html).toContain('tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(html).not.toContain('{s}.');
  });

  it('carries the attribution OpenStreetMap requires, linked', () => {
    expect(html).toContain('openstreetmap.org/copyright');
    expect(html).toContain('OpenStreetMap</a> contributors');
  });

  it('loads Leaflet 1.9.4 css and js, both with integrity hashes', () => {
    expect(html.split('leaflet@1.9.4')).toHaveLength(3);
    expect(html.split('integrity="sha256-')).toHaveLength(3);
  });

  it('reports a Leaflet load failure back to the app', () => {
    expect(html).toContain("reason: 'leaflet'");
  });

  it('embeds the starting point and zoom', () => {
    expect(html).toContain('[17.44, 78.35]');
    expect(html).toContain('setView(start, 16)');
  });

  it.each([
    ['NaN', { lat: NaN, lng: 78.35 }],
    ['Infinity', { lat: 17.44, lng: Infinity }],
  ])('falls back to the middle of India for %s', (_label, bad) => {
    const fallback = buildMapHtml({ ...input, ...bad });
    expect(fallback).toContain(`[${INDIA_CENTRE.lat}, ${INDIA_CENTRE.lng}]`);
  });

  it('falls back to the country zoom for a non-finite zoom', () => {
    expect(buildMapHtml({ ...input, zoom: NaN })).toContain(`setView(start, ${INDIA_CENTRE.zoom})`);
  });

  it('takes its colours from the arguments and writes no other hex literal', () => {
    expect(html).toContain(PIN);
    expect(html).toContain(RING);
    const stripped = html.split(PIN).join('').split(RING).join('');
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3}\b/);
  });

  it('posts to the app through the WebView bridge', () => {
    expect(html).toContain('window.ReactNativeWebView.postMessage');
  });

  it('cannot be closed early by a colour argument', () => {
    const hostile = buildMapHtml({ ...input, pinColor: '</script><script>alert(1)</script>' });
    expect(hostile).not.toContain('</script><script>alert(1)');
  });
});
