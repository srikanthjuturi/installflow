import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeoState } from "@/types/geo";
import { INDIA_EXTENT, INDIA_PATHS, INDIA_VIEWBOX } from "./indiaPaths";

/**
 * India, drawn from real boundaries. What a colour MEANS is the caller's: it
 * supplies a mark per state (see `StateMark`).
 *
 * The whole country stays in frame at every level — picking a state highlights
 * it where it sits rather than zooming to it. A zoom looked impressive and read
 * badly: it threw away the one thing a map is for, which is showing you WHERE
 * something is, and it left the cursor hovering a neighbour after the animation
 * settled.
 *
 * The outlines are in `indiaPaths.ts`, generated from a licensed source; that
 * file explains which source and why. Two things about them matter here:
 *
 *  * a state can own **more than one outline**. Our master merged Dadra and
 *    Nagar Haveli with Daman and Diu into a single state, and the geography
 *    still has them as separate landmasses either side of Gujarat.
 *  * outlines are matched to our states **by name**, so a renamed state would
 *    stop being drawable. It is never dropped silently — `unplaced` below puts
 *    it on screen with the reason.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/^the/, "");

/** Our merged state, against the two landmasses the map still draws apart. */
const MULTI: Record<string, string[]> = {
  dadraandnagarhavelianddamananddiu: [
    "Dadra and Nagar Haveli",
    "Daman and Diu",
  ],
};

const BY_NORM = new Map(Object.keys(INDIA_PATHS).map((k) => [norm(k), k]));

/** id of the drop-shadow filter. Fixed because there is one map on the page. */
const LIFT = "india-map-lift";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** One press of + or −. */
const STEP = 1.6;
/** Past this many pixels a gesture is a pan, not a click on the state under it. */
const DRAG_SLOP = 4;

const [MAP_W, MAP_H] = [
  INDIA_EXTENT[2] - INDIA_EXTENT[0],
  INDIA_EXTENT[3] - INDIA_EXTENT[1],
];

/**
 * Keep the drawing covering the frame.
 *
 * At scale `s` the content is `size * s` across, so it can slide by half the
 * overflow before an edge pulls into view. At 1× that limit is zero, which is
 * what stops a stale offset leaving the country off-centre with nothing on
 * screen to explain why.
 */
function clampPan(value: number, scale: number, size: number): number {
  const max = (size * (scale - 1)) / 2;
  return Math.min(max, Math.max(-max, value));
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Claim a pointer so a fast gesture cannot escape the element.
 *
 * Only ever called once a pan or pinch is definitely happening. A captured
 * pointer retargets its follow-up `click` to the capturing element, so
 * capturing on plain pointerdown silently breaks click-to-select — which it
 * did, twice.
 *
 * Both calls can throw `InvalidPointerId` when the pointer is already gone.
 * Losing capture is survivable; letting it abort the gesture is not.
 */
function capturePointer(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* the gesture still tracks through the pointers map */
  }
}

function releasePointer(el: Element, id: number): void {
  try {
    el.releasePointerCapture(id);
  } catch {
    /* never captured, or already released */
  }
}

interface Pt {
  x: number;
  y: number;
}

const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A client point in the SVG's own coordinates.
 *
 * The drawing is `w-full h-auto`, so its box matches the viewBox aspect exactly
 * and there is no letterboxing to correct for.
 */
function toUserSpace(p: Pt, rect: DOMRect): Pt {
  return {
    x: (p.x - rect.left) * (MAP_W / rect.width),
    y: (p.y - rect.top) * (MAP_H / rect.height),
  };
}

/** Undo the current zoom/pan: which point of the map is under this coordinate. */
function toMapPoint(p: Pt, scale: number, pan: Pt): Pt {
  return {
    x: (p.x - (MAP_W / 2) * (1 - scale) - pan.x) / scale,
    y: (p.y - (MAP_H / 2) * (1 - scale) - pan.y) / scale,
  };
}

/**
 * The pan that keeps `anchor` sitting under `at` at the given scale.
 *
 * This is what makes a pinch feel right: the bit of the map between your
 * fingers stays between your fingers. Zooming about the centre instead makes
 * the target slide away as you pinch.
 */
function panForAnchor(anchor: Pt, at: Pt, scale: number): Pt {
  return {
    x: clampPan(
      at.x - anchor.x * scale - (MAP_W / 2) * (1 - scale),
      scale,
      MAP_W
    ),
    y: clampPan(
      at.y - anchor.y * scale - (MAP_H / 2) * (1 - scale),
      scale,
      MAP_H
    ),
  };
}

/** Every outline belonging to one of our states. Usually one; sometimes two. */
function outlineKeys(stateName: string): string[] {
  const key = norm(stateName);
  const multi = MULTI[key];
  if (multi) return multi.filter((k) => k in INDIA_PATHS);
  const single = BY_NORM.get(key);
  return single ? [single] : [];
}

/**
 * How one state should be drawn. The MAP owns geometry and interaction; what a
 * colour means is the page's business, so it arrives through here.
 *
 * Geography colours by region (identity). Territory colours by coverage
 * (status). Neither meaning belongs inside a component that knows about
 * outlines and pinch gestures.
 */
export interface StateMark {
  /** A whole Tailwind fill class, e.g. `fill-chart-1`. Never interpolated —
   *  a class Tailwind did not see in the source is never generated. */
  fill: string;
  /** Full opacity, or dimmed back as context. */
  active: boolean;
  /** Dotted outline and a drop shadow: this is one of the chosen set. */
  marked: boolean;
  /** Clickable and focusable. A state outside the caller's territory is drawn
   *  but inert — the country still looks like the country. */
  interactive: boolean;
  /** One line for the readout, the tooltip and the accessible name. */
  detail: string;
}

interface Props {
  states: GeoState[];
  /** Called for every state, every render. Keep it cheap. */
  markFor: (state: GeoState) => StateMark;
  /** Shown top-left — usually the selected thing, or the country. */
  heading: string;
  /** Shown top-right when nothing is selected or hovered. */
  placeholder: string;
  /** Rendered above the map. Colour is never the only encoding, so this is
   *  required rather than optional. */
  legend: React.ReactNode;
  selectedStateId?: string;
  onSelectState: (state: GeoState) => void;
}

export function IndiaMap({
  states,
  markFor,
  heading,
  placeholder,
  legend,
  selectedStateId,
  onSelectState,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // State, not a ref, because the render reads it — for the cursor and to drop
  // the transition mid-drag. Refs must not be read during render.
  const [dragging, setDragging] = useState(false);

  // All of these are only ever touched inside event handlers, so refs are
  // right: they change on every pointermove and none of it belongs in a render.
  const gesture = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  /** Every finger currently down, so a second one can start a pinch. */
  const pointers = useRef(new Map<number, Pt>());
  /** The pinch in progress: the gap and zoom it began at, and the point of the
   *  map that was between the fingers and has to stay there. */
  const pinch = useRef<{ gap: number; zoom: number; anchor: Pt } | null>(null);
  const moved = useRef(false);

  const applyZoom = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(clamped);
    // Re-clamp the offset against the NEW scale — zooming out with the map
    // dragged to a corner would otherwise leave it hanging off the frame.
    setPan((p) => ({
      x: clampPan(p.x, clamped, MAP_W),
      y: clampPan(p.y, clamped, MAP_H),
    }));
  };

  const resetView = () => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  };

  /** One finger up. Lifting from a pinch must not leave the other finger
   *  dragging from a stale origin, so any surviving pointer starts fresh. */
  const endPointer = (id: number) => {
    pointers.current.delete(id);
    if (pointers.current.size < 2) pinch.current = null;
    gesture.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  /** Scale about the middle of the country, then slide by the pan. */
  const transform = `translate(${(MAP_W / 2) * (1 - zoom) + pan.x}px, ${(MAP_H / 2) * (1 - zoom) + pan.y}px) scale(${zoom})`;
  const canPan = zoom > MIN_ZOOM;

  const { drawn, unplaced } = useMemo(() => {
    const drawn: { state: GeoState; keys: string[] }[] = [];
    const unplaced: GeoState[] = [];
    for (const state of states) {
      const keys = outlineKeys(state.name);
      if (keys.length) drawn.push({ state, keys });
      else unplaced.push(state);
    }
    return { drawn, unplaced };
  }, [states]);

  // The header reports what is SELECTED, falling back to what is hovered.
  // Hover used to win outright, which printed a neighbour's counts beside the
  // chosen state's name as though they were one fact.
  const selectedState = drawn.find((d) => d.state.id === selectedStateId)?.state;
  const hoveredState = drawn.find((d) => d.state.id === hovered)?.state;
  const readout = selectedState ?? hoveredState;

  return (
    <section
      className="rounded-lg border border-line bg-surface"
      aria-labelledby="map-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 id="map-heading" className="text-[15px] font-semibold text-ink">
          {heading}
        </h2>
        <p
          className="min-h-4 text-[12px] text-ink-2"
          aria-live="polite"
          aria-atomic="true"
        >
          {readout ? (
            markFor(readout).detail
          ) : (
            <span className="text-ink-3">{placeholder}</span>
          )}
        </p>
      </header>

      {/* Above the map, not below it: a key you read to understand the thing,
          or a filter you act with, both belong before it. Required, not
          optional — colour is never the only encoding. */}
      <div className="border-b border-line px-3 py-2.5">{legend}</div>

      <div className="relative px-3 pt-3 pb-2">
        <svg
          viewBox={INDIA_VIEWBOX}
          className={cn(
            // Rounded so a zoomed map does not present square corners inside a
            // rounded card. An <svg> already clips to its own viewport, so this
            // is only about the corners.
            "h-auto w-full rounded-md",
            // `touch-pan-y` at 1x, not `auto`: auto lets the browser claim a
            // two-finger pinch as a PAGE zoom, so the map never sees it and
            // pinching does nothing. pan-y hands us the pinch while leaving one
            // finger free to scroll the page — which matters, because a map
            // that eats every touch is a scroll trap on a phone.
            canPan ? "touch-none" : "touch-pan-y",
            canPan && !dragging && "cursor-grab",
            // During a drag the states' own cursor-pointer has to be overridden
            // or the pointer flickers between grab and hand as you cross them.
            dragging && "cursor-grabbing [&_*]:cursor-grabbing"
          )}
          role="group"
          aria-label="Map of India. Each state is a button."
          onPointerDown={(e) => {
            // Cleared BEFORE any guard below, and that ordering is the whole
            // point: with the reset inside the pan guard, one pan followed by a
            // zoom back to 1x left this stuck true, and every click on every
            // state was silently swallowed from then on.
            moved.current = false;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (pointers.current.size === 2) {
              // A pinch starts at ANY zoom, including 1x — that is how you zoom
              // in on a touchscreen, where there is no cursor for the buttons.
              const [a, b] = [...pointers.current.values()];
              const rect = e.currentTarget.getBoundingClientRect();
              const mid = toUserSpace(
                { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                rect
              );
              gesture.current = null; // a second finger ends any one-finger pan
              pinch.current = {
                gap: distance(a, b),
                zoom,
                anchor: toMapPoint(mid, zoom, pan),
              };
              // A pinch is never a click, so it can capture straight away.
              capturePointer(e.currentTarget, e.pointerId);
              setDragging(true);
            } else if (pointers.current.size === 1 && canPan) {
              // ARM a pan — do not start one, and above all do not capture yet.
              // A press that never moves is a click on a state, and a captured
              // pointer retargets the click to the <svg>, which is exactly why
              // states could not be selected while zoomed in. Capture is taken
              // in pointermove, once the pointer has actually travelled.
              gesture.current = {
                x: e.clientX,
                y: e.clientY,
                panX: pan.x,
                panY: pan.y,
              };
            }
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const rect = e.currentTarget.getBoundingClientRect();

            const p = pinch.current;
            if (p && pointers.current.size >= 2) {
              const [a, b] = [...pointers.current.values()];
              const gap = distance(a, b);
              if (gap <= 0) return;
              const next = clampZoom((p.zoom * gap) / p.gap);
              const mid = toUserSpace(
                { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                rect
              );
              moved.current = true;
              setZoom(next);
              setPan(panForAnchor(p.anchor, mid, next));
              return;
            }

            const g = gesture.current;
            if (!g) return;
            const dx = e.clientX - g.x;
            const dy = e.clientY - g.y;

            if (!moved.current) {
              // Still inside the slop: this may yet turn out to be a click, so
              // nothing has happened and nothing is captured.
              if (Math.abs(dx) <= DRAG_SLOP && Math.abs(dy) <= DRAG_SLOP)
                return;
              // Past it — now it is a drag. Claim the pointer so a fast throw
              // cannot escape the element mid-pan.
              moved.current = true;
              capturePointer(e.currentTarget, e.pointerId);
              setDragging(true);
            }

            // Screen pixels are not user units. Convert through the rendered
            // width or the map lags the pointer badly in a narrow column.
            const k = MAP_W / rect.width;
            setPan({
              x: clampPan(g.panX + dx * k, zoom, MAP_W),
              y: clampPan(g.panY + dy * k, zoom, MAP_H),
            });
          }}
          onPointerUp={(e) => {
            endPointer(e.pointerId);
            releasePointer(e.currentTarget, e.pointerId);
          }}
          onPointerCancel={(e) => endPointer(e.pointerId)}
        >
          <defs>
            {/* Lifts the chosen states off the faded country behind them. Only
                ever applied to the handful that are marked — a drop shadow on
                all 36 would cost far more than it says. */}
            <filter id={LIFT} x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow
                dx="0"
                dy="1.5"
                stdDeviation="2.5"
                floodOpacity="0.35"
              />
            </filter>
          </defs>
          <g
            style={{
              transform,
              transformBox: "view-box",
              transformOrigin: "0 0",
              // No easing while a finger or pointer is down, or the map lags
              // behind the drag by the length of the transition.
              transition: dragging
                ? "none"
                : "transform 240ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
            className="motion-reduce:transition-none"
          >
            {drawn.map(({ state, keys }) => {
              const mark = markFor(state);
              const { active: isActive, marked } = mark;
              return (
                <g
                  key={state.id}
                  onClick={() => {
                    // A drag that happens to end over a state is not a click on
                    // it — without this, panning always reselects something.
                    if (moved.current) return;
                    if (!mark.interactive) return;
                    onSelectState(state);
                  }}
                  onMouseEnter={() => setHovered(state.id)}
                  onMouseLeave={() =>
                    setHovered((h) => (h === state.id ? null : h))
                  }
                  onFocus={() => setHovered(state.id)}
                  onBlur={() => setHovered((h) => (h === state.id ? null : h))}
                  onKeyDown={(e) => {
                    if (!mark.interactive) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectState(state);
                    }
                  }}
                  role={mark.interactive ? "button" : "img"}
                  // An inert state leaves the tab order entirely. Tabbing onto
                  // something that cannot be actioned is worse than skipping it.
                  tabIndex={mark.interactive ? 0 : -1}
                  aria-pressed={mark.interactive ? state.id === selectedStateId : undefined}
                  aria-label={`${state.name}. ${mark.detail}`}
                  className={cn(
                    "group outline-none",
                    mark.interactive ? "cursor-pointer" : "cursor-default"
                  )}
                  filter={marked ? `url(#${LIFT})` : undefined}
                >
                  <title>{`${state.name} — ${mark.detail}`}</title>
                  {keys.map((k) => (
                    <path
                      key={k}
                      d={INDIA_PATHS[k]}
                      className={cn(
                        mark.fill,
                        "transition-[fill-opacity,stroke] duration-200 motion-reduce:transition-none",
                        marked ? "stroke-ink" : "stroke-surface",
                        mark.interactive && "group-hover:[fill-opacity:0.78]",
                        "group-focus-visible:stroke-ink group-focus-visible:stroke-[3]"
                      )}
                      // Attributes, not utilities: Tailwind has no fill-opacity or
                      // stroke-dasharray scale, so classes here would be inert.
                      // The dash was "3 2.5" at 1.6 wide and read as a solid dark
                      // edge at render size — the dots have to be big enough to
                      // see as dots.
                      fillOpacity={isActive ? 1 : 0.12}
                      strokeWidth={marked ? 2.2 : 0.8}
                      strokeDasharray={marked ? "6 4" : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom, at the corner where a map keeps it. Buttons and drag only:
            wheel-zoom would swallow the page scroll, and on the stacked layout
            the map is something you scroll PAST. */}
        <div className="absolute end-5 top-5 flex flex-col overflow-hidden rounded-md border border-line bg-surface shadow-card">
          <ZoomButton
            label="Zoom in"
            onClick={() => applyZoom(zoom * STEP)}
            disabled={zoom >= MAX_ZOOM}
          >
            <Plus className="size-4" aria-hidden />
          </ZoomButton>
          <ZoomButton
            label="Zoom out"
            onClick={() => applyZoom(zoom / STEP)}
            disabled={zoom <= MIN_ZOOM}
            className="border-t border-line"
          >
            <Minus className="size-4" aria-hidden />
          </ZoomButton>
          <ZoomButton
            label="Reset zoom"
            onClick={resetView}
            disabled={zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0}
            className="border-t border-line"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </ZoomButton>
        </div>

        {canPan && (
          <p className="pointer-events-none absolute start-5 top-5 rounded bg-surface/90 px-1.5 py-0.5 text-[11px] font-medium text-ink-2 tabular-nums">
            {zoom.toFixed(1)}× · drag to move
          </p>
        )}
      </div>

      {unplaced.length > 0 && (
        <p className="flex items-start gap-2 border-t border-line px-4 py-2.5 text-[12px] text-warn">
          <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">
              No outline for {unplaced.map((s) => s.name).join(", ")}.
            </span>{" "}
            <span className="text-ink-2">
              Outlines are matched by name — a renamed state needs an alias in{" "}
              <code className="text-[11px]">IndiaMap.tsx</code>. Its counts are
              still right everywhere else on this page.
            </span>
          </span>
        </p>
      )}
    </section>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center text-ink-2 transition-colors",
        "hover:bg-surface-2 hover:text-ink",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:cursor-default disabled:text-ink-3/50 disabled:hover:bg-transparent disabled:hover:text-ink-3/50",
        className
      )}
    >
      {children}
    </button>
  );
}
