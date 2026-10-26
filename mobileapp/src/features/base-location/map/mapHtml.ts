import { INDIA_CENTRE } from '@/features/base-location/lib/coords';

/**
 * The page the map screen loads into its WebView: Leaflet over OpenStreetMap
 * tiles and one draggable pin. Self-contained — no marker images to fetch.
 *
 * - **OpenStreetMap tile usage policy** (operations.osmfoundation.org/policies/tiles):
 *   attribution visible and linked; an identifying User-Agent and a Referer
 *   (both set by the screen's WebView); no pre-fetching; caching honoured. The
 *   handful of map opens per technician per year this app makes is well inside
 *   it. If that ever changes, switch `TILE_URL` to a keyed provider — one line.
 * - **The attribution is never translated or hidden.** It is a legal notice
 *   naming a brand, so it is a constant here, not a key in `en.json`.
 * - **Colours arrive as arguments** from `color` — no hex literal belongs in
 *   `src/` outside `src/theme`, even inside an HTML string.
 * - **Numbers are serialised, never concatenated** from anything a person
 *   typed, and a non-finite one falls back to the middle of India.
 */

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Leaflet 1.9.4's published Subresource Integrity hashes. */
const LEAFLET_CSS = {
  href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
const LEAFLET_JS = {
  src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface MapHtmlInput {
  lat: number;
  lng: number;
  zoom: number;
  /** The pin's fill. */
  pinColor: string;
  /** The ring round it. */
  ringColor: string;
}

/** A JS literal safe inside a `<script>`: JSON, with `</script` and `<!--` defused so it cannot close or confuse the tag. */
const literal = (value: unknown) => JSON.stringify(value).replace(/<(\/script|!--)/gi, '\\u003c$1');

const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

export function buildMapHtml({ lat, lng, zoom, pinColor, ringColor }: MapHtmlInput): string {
  // A broken pair is never half-trusted: both fall back together.
  const valid = Number.isFinite(lat) && Number.isFinite(lng);
  const startLat = valid ? lat : INDIA_CENTRE.lat;
  const startLng = valid ? lng : INDIA_CENTRE.lng;
  const startZoom = Math.min(19, Math.max(1, Math.round(finite(zoom, INDIA_CENTRE.zoom))));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET_CSS.href}" integrity="${LEAFLET_CSS.integrity}" crossorigin="">
<style>
html, body, #map { height: 100%; margin: 0; padding: 0; }
.pin { box-sizing: content-box; width: 20px; height: 20px; border-radius: 50%; }
</style>
<script>
function post(message) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
}
</script>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS.src}" integrity="${LEAFLET_JS.integrity}" crossorigin="" onerror="post({ type: 'failed', reason: 'leaflet' })"></script>
<script>
(function () {
  if (typeof L === 'undefined') return;
  var start = [${literal(startLat)}, ${literal(startLng)}];
  var map = L.map('map', { zoomControl: true, attributionControl: true }).setView(start, ${literal(startZoom)});
  var tileErrors = 0;
  var tileFailureSent = false;
  L.tileLayer(${literal(TILE_URL)}, {
    maxZoom: 19,
    attribution: ${literal(ATTRIBUTION)}
  }).on('tileerror', function () {
    tileErrors += 1;
    if (tileErrors >= 4 && !tileFailureSent) {
      tileFailureSent = true;
      post({ type: 'failed', reason: 'tiles' });
    }
  }).addTo(map);

  var icon = L.divIcon({
    className: '',
    html: '<div class="pin" style="background:' + ${literal(pinColor)} + ';border:3px solid ' + ${literal(ringColor)} + '"></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  var marker = L.marker(start, { draggable: true, icon: icon }).addTo(map);

  function moved(latlng) {
    post({ type: 'moved', lat: latlng.lat, lng: latlng.lng });
  }
  map.on('click', function (event) {
    marker.setLatLng(event.latlng);
    moved(event.latlng);
  });
  marker.on('dragend', function () {
    moved(marker.getLatLng());
  });

  post({ type: 'ready' });
  moved(marker.getLatLng());
})();
</script>
</body>
</html>`;
}
