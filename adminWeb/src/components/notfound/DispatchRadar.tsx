import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The `0` of 404 — a dispatch radar sweeping for an address that is not on the
 * map, lighting a blip it can never reach.
 *
 * The metaphor is the product's own: this console's whole job is putting a
 * technician at an address, and geography is a loaded master, so "that pincode
 * does not exist" is a failure the people using this screen already recognise.
 * A stock broken-robot illustration would say nothing about what went wrong.
 *
 * Drawn on a 0–100 viewBox and sized in `em` by the caller, so it tracks the
 * numerals' font size and stays on their baseline at every clamp step. Colour
 * is `currentColor` throughout — including the gradient stops — so the caller
 * sets one token class and light/dark follow with no second definition.
 */
export function DispatchRadar({ className }: { className?: string }) {
  // Two of these on one page would otherwise collide on a hard-coded id.
  const sweepId = `${useId()}-sweep`;

  return (
    <svg
      viewBox="0 0 100 100"
      // The ping rings scale past r=46 and must not be clipped to the box.
      className={cn("overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient
          id={sweepId}
          x1="50"
          y1="50"
          x2="97"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {/* Outward pings. Offset by half a period so one is always mid-flight. */}
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0"
        className="animate-radar-ping"
      />
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0"
        className="animate-radar-ping [animation-delay:1.7s]"
      />

      {/* Dial face. The heavy outer ring is what reads as a mono zero next to
          the two 4s — thinner and the glyph stops being a digit. */}
      <circle cx="50" cy="50" r="46" className="fill-brand-500/8" />
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="7.5"
        strokeOpacity="0.95"
      />
      <circle
        cx="50"
        cy="50"
        r="31"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.26"
      />
      <g
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.32"
        strokeLinecap="round"
      >
        <line x1="50" y1="11" x2="50" y2="19" />
        <line x1="50" y1="81" x2="50" y2="89" />
        <line x1="11" y1="50" x2="19" y2="50" />
        <line x1="81" y1="50" x2="89" y2="50" />
      </g>

      {/* The beam: a 70° wedge fading toward the hub, plus its leading edge. */}
      <g className="animate-radar-sweep">
        <path d="M50 50 L50 4 A46 46 0 0 1 96 50 Z" fill={`url(#${sweepId})`} />
        <line
          x1="50"
          y1="50"
          x2="95"
          y2="50"
          stroke="currentColor"
          strokeWidth="2"
          strokeOpacity="0.75"
          strokeLinecap="round"
        />
      </g>

      {/* The address it keeps finding and never resolving. Sits at ~-36°,
          inside the wedge as drawn, which is why the blip peaks at 0%. */}
      <g className="animate-radar-blip">
        <circle cx="72" cy="34" r="10" fill="currentColor" opacity="0.16" />
        <circle cx="72" cy="34" r="5" fill="currentColor" />
      </g>
      <circle cx="50" cy="50" r="3.5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}
