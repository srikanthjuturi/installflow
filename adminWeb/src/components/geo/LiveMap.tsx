import { useEffect, useRef, type ReactNode } from "react";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
// The stylesheet rides THIS chunk, exactly as BaseLocationMap's does: imported
// anywhere else it would load with the app. It contains hex colours - a vendor
// file, never copied from.
import "leaflet/dist/leaflet.css";

export interface LivePin {
  id: string;
  lat: number;
  lng: number;
  /** A phone that is not reporting: drawn grey, never as current. */
  stale: boolean;
  /** Tooltip lines. */
  label: string[];
  /** Click popup: the technician's details. Absent = tooltip only. */
  popup?: ReactNode;
  /** Metres; draws a circle when known. */
  accuracyM?: number | null;
}

export interface CustomerPin {
  lat: number;
  lng: number;
}

const INDIA_CENTRE: [number, number] = [22.5, 79.0];
const INDIA_ZOOM = 5;
const MAX_FIT_ZOOM = 15;
/** How close a picked technician is zoomed to. */
const SELECT_ZOOM = 17;

/* `divIcon`s with STATIC Tailwind classes - never `L.Icon.Default`, whose PNGs
   404 once Vite hashes the assets (see BaseLocationMap). */
const FRESH = L.divIcon({
  className: "border-0 bg-transparent",
  html: '<span class="block size-4 rounded-full border-2 border-white bg-brand-500 shadow"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});
const STALE = L.divIcon({
  className: "border-0 bg-transparent",
  html: '<span class="block size-4 rounded-full border-2 border-white bg-ink-3 opacity-60 shadow"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});
const SELECTED = L.divIcon({
  className: "border-0 bg-transparent",
  html: '<span class="block size-6 rounded-full border-[3px] border-white bg-brand-500 shadow-lg ring-4 ring-brand-500/30"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});
const CUSTOMER = L.divIcon({
  className: "border-0 bg-transparent",
  html: '<span class="block size-4 rounded-sm border-2 border-white bg-danger shadow"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * Frames every pin once, and again only when the SET of pins changes - not on
 * every 20 s refresh, which would snatch the map back from someone who has
 * panned away to look at something.
 */
function FitTo({
  points,
  signature,
}: {
  points: Array<[number, number]>;
  signature: string;
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], MAX_FIT_ZOOM);
      return;
    }
    map.fitBounds(L.latLngBounds(points), {
      padding: [32, 32],
      maxZoom: MAX_FIT_ZOOM,
    });
    // `signature` is the dependency on purpose; `points` is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, map]);
  return null;
}

/** Re-measures when the box changes size (full screen on/off). */
function KeepSized() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Zooms to the picked technician and opens their popup. */
function FlyToSelected({
  pins,
  selectedId,
  markers,
}: {
  pins: LivePin[];
  selectedId?: string | null;
  markers: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  const pinsRef = useRef(pins);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);
  useEffect(() => {
    if (!selectedId) return;
    const pin = pinsRef.current.find((p) => p.id === selectedId);
    if (!pin) return;
    map.invalidateSize();
    map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), SELECT_ZOOM), {
      duration: 0.8,
    });
    const open = () => markers.current.get(selectedId)?.openPopup();
    map.once("moveend", open);
    return () => {
      map.off("moveend", open);
    };
  }, [selectedId, map, markers]);
  return null;
}

/**
 * The live map: the latest point of each technician, and optionally the
 * customer. Latest point only - there is no trail, and none is drawn.
 *
 * OSM tile policy as in BaseLocationMap: attribution always visible. Default
 * export so callers can `lazy()` it.
 */
export default function LiveMap({
  pins,
  customer,
  className = "h-72 w-full rounded-md",
  onSelect,
  selectedId,
}: {
  pins: LivePin[];
  customer?: CustomerPin | null;
  className?: string;
  onSelect?: (id: string) => void;
  /** The technician to zoom to and highlight. */
  selectedId?: string | null;
}) {
  const markers = useRef(new Map<string, L.Marker>());
  const all: Array<[number, number]> = pins.map((p) => [p.lat, p.lng]);
  if (customer) all.push([customer.lat, customer.lng]);
  const signature = `${pins.map((p) => p.id).join(",")}|${customer ? "c" : ""}`;

  return (
    <MapContainer
      className={className}
      center={all[0] ?? INDIA_CENTRE}
      zoom={all.length ? MAX_FIT_ZOOM : INDIA_ZOOM}
      scrollWheelZoom
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitTo points={all} signature={signature} />
      <KeepSized />
      <FlyToSelected pins={pins} selectedId={selectedId} markers={markers} />
      {pins.map((p) => (
        <span key={p.id}>
          {p.accuracyM && p.accuracyM > 0 ? (
            <Circle
              center={[p.lat, p.lng]}
              radius={p.accuracyM}
              interactive={false}
              // Leaflet path options take CSS colour strings; `currentColor`
              // keeps this free of a hex literal.
              pathOptions={{
                color: "currentColor",
                weight: 1,
                opacity: p.stale ? 0.3 : 0.6,
                fillOpacity: p.stale ? 0.04 : 0.1,
              }}
            />
          ) : null}
          <Marker
            position={[p.lat, p.lng]}
            icon={p.id === selectedId ? SELECTED : p.stale ? STALE : FRESH}
            zIndexOffset={p.id === selectedId ? 1000 : 0}
            ref={(m) => {
              if (m) markers.current.set(p.id, m);
              else markers.current.delete(p.id);
            }}
            eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
          >
            {/* Hover: the quick read. Click: the full card (when given). */}
            <Tooltip direction="top" offset={[0, -8]}>
              {p.label.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </Tooltip>
            {p.popup ? <Popup offset={[0, -6]}>{p.popup}</Popup> : null}
          </Marker>
        </span>
      ))}
      {customer ? (
        <Marker position={[customer.lat, customer.lng]} icon={CUSTOMER}>
          <Tooltip direction="top" offset={[0, -8]}>
            Customer
          </Tooltip>
        </Marker>
      ) : null}
    </MapContainer>
  );
}
