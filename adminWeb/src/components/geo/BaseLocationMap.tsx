import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
// The stylesheet rides THIS chunk: imported anywhere else it would load with
// the app, and the whole point of the lazy boundary is that nobody who never
// opens a base-location dialog pays for Leaflet. It contains hex colours — a
// vendor file, never copied from.
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  lat: number;
  lng: number;
}

/** India, framed — the map before there is a point to show. */
const INDIA_CENTRE: [number, number] = [22.5, 79.0];
const INDIA_ZOOM = 5;
const POINT_ZOOM = 15;

/** Tiles that fail this many times mean the host is unreachable, not flaky. */
const TILE_FAILURE_LIMIT = 4;

/**
 * The marker. A `divIcon` with STATIC Tailwind classes — never
 * `L.Icon.Default`, whose PNGs resolve against the stylesheet's URL and 404
 * once Vite hashes the assets. `className` replaces Leaflet's own white
 * `leaflet-div-icon` box so only the dot shows.
 */
const PIN = L.divIcon({
  className: "border-0 bg-transparent",
  html: '<span class="block size-4 rounded-full border-2 border-white bg-brand-500 shadow"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * The OpenStreetMap pin (Task 13 §5.5): click anywhere or drag the dot, and
 * `onPick` reports the point. It owns geometry and interaction only — what the
 * point MEANS (a base, a mode, a source) is the dialog's.
 *
 * OSM tile policy: visible attribution (the control is never hidden), the
 * browser's default Referer, no bulk fetching. If maps ever become routine here
 * move to a keyed provider — the URL below is the one line to change. Do not
 * invert the tiles for the dark theme: it inverts the attribution's contrast
 * too.
 *
 * Default export, so the dialog can `lazy()` it (as `IndiaMap` is).
 */
export default function BaseLocationMap({
  value,
  recentre,
  onPick,
  onTilesFailed,
}: {
  /** The pin, or null before there is one. */
  value: MapPoint | null;
  /**
   * Bump to move the VIEW to `value` — for a point set from outside (Use
   * centre, typed coordinates). Clicking or dragging does not bump it: the
   * reader is already looking where they put the pin.
   */
  recentre: number;
  onPick: (point: MapPoint) => void;
  /** Called once, after enough tiles have failed to load. */
  onTilesFailed?: () => void;
}) {
  const failures = useRef(0);
  const reported = useRef(false);

  const handlers = useMemo(
    () => ({
      tileerror: () => {
        failures.current += 1;
        if (failures.current >= TILE_FAILURE_LIMIT && !reported.current) {
          reported.current = true;
          onTilesFailed?.();
        }
      },
    }),
    [onTilesFailed]
  );

  return (
    <MapContainer
      className="h-80 w-full rounded-md"
      center={value ? [value.lat, value.lng] : INDIA_CENTRE}
      zoom={value ? POINT_ZOOM : INDIA_ZOOM}
      scrollWheelZoom
    >
      {/* No `{s}`: OSM retired the a/b/c subdomains. */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        eventHandlers={handlers}
      />
      <ClickToPick onPick={onPick} />
      <Recentre value={value} token={recentre} />
      {value ? (
        <Marker
          position={[value.lat, value.lng]}
          icon={PIN}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const at = (e.target as L.Marker).getLatLng();
              onPick({ lat: at.lat, lng: at.lng });
            },
          }}
        />
      ) : null}
    </MapContainer>
  );
}

function ClickToPick({ onPick }: { onPick: (point: MapPoint) => void }) {
  useMapEvents({
    click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

/** Moves the view when `token` changes — and only then. */
function Recentre({ value, token }: { value: MapPoint | null; token: number }) {
  const map = useMap();
  const last = useRef(token);
  useEffect(() => {
    if (token === last.current) return;
    last.current = token;
    if (value) map.setView([value.lat, value.lng], Math.max(map.getZoom(), POINT_ZOOM));
  }, [token, value, map]);
  return null;
}
