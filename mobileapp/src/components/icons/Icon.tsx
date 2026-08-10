import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { color } from '@/theme/semantic';

/**
 * The 22 icons from the approved prototype, traced verbatim.
 *
 * All are 24×24 on a 0 0 24 24 viewBox, stroked (never filled) at 1.8 with
 * round caps and joins. Colour comes from the `color` prop so a single icon
 * works on light cards and dark camera chrome alike.
 *
 * Deliberately not @expo/vector-icons: these shapes are part of the approved
 * design and no icon font matches them.
 */

export type IconName =
  // navigation
  | 'home'
  | 'jobs'
  | 'wallet'
  | 'user'
  // proof capture
  | 'barcode'
  | 'serial'
  | 'photos'
  | 'geo'
  // settings & ledger
  | 'bell'
  | 'globe'
  | 'plus'
  | 'minus'
  | 'gift'
  | 'card'
  | 'warn'
  // product categories
  | 'tv'
  | 'washer'
  | 'fridge'
  | 'ac'
  | 'micro'
  | 'purifier'
  // product master — the rest of the curated catalogue an ops manager can pick
  // from. See `productIcons.ts` for the server-key mapping.
  | 'fan'
  | 'wind'
  | 'flame'
  | 'laptop'
  | 'smartphone'
  | 'monitor'
  | 'printer'
  | 'headphones'
  | 'speaker'
  | 'coffee'
  | 'utensils'
  | 'sofa'
  | 'lightbulb'
  | 'plug'
  | 'battery'
  | 'zap'
  | 'wrench'
  | 'package'
  // chrome
  | 'chevronLeft'
  | 'arrowRight'
  | 'link'
  | 'lock'
  | 'check'
  | 'close'
  | 'chevronRight'
  | 'clock'
  | 'calendar'
  | 'phone'
  | 'navigation'
  | 'play'
  | 'info'
  | 'edit'
  | 'sparkle'
  | 'camera'
  | 'cameraOff'
  | 'mapCheck'
  | 'rotate';

export interface IconProps {
  name: IconName;
  size?: number;
  /** Any colour string — pass a semantic token, not a hex literal. */
  color?: string;
  /** Overrides the per-icon default. */
  strokeWidth?: number;
}

const STROKE = {
  fill: 'none',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** The prototype draws a few icons at a different weight — matched exactly. */
const STROKE_OVERRIDE: Partial<Record<IconName, number>> = {
  link: 1.7,
  lock: 1.7,
  arrowRight: 2,
  chevronLeft: 2,
  chevronRight: 2,
  check: 3, // drawn small (13px) inside a badge, so it needs the weight
  close: 2.4,
  phone: 1.7,
  navigation: 1.7,
  play: 2,
  info: 1.7,
  edit: 1.7,
  sparkle: 1.6,
};

export function Icon({
  name,
  size = 24,
  color: stroke = color.textPrimary,
  strokeWidth,
}: IconProps) {
  const p = {
    ...STROKE,
    stroke,
    strokeWidth: strokeWidth ?? STROKE_OVERRIDE[name] ?? STROKE.strokeWidth,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {renderPaths(name, stroke, p)}
    </Svg>
  );
}

type StrokeProps = {
  fill: 'none';
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  stroke: string;
};

function renderPaths(name: IconName, stroke: string, p: StrokeProps) {
  switch (name) {
    case 'home':
      return <Path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1v-8z" {...p} />;

    case 'jobs':
      return (
        <>
          <Rect x={4} y={5} width={16} height={16} rx={2} {...p} />
          <Path d="M8 5V3.5A1.5 1.5 0 019.5 2h5A1.5 1.5 0 0116 3.5V5M8 12h8M8 16h5" {...p} />
        </>
      );

    case 'wallet':
      return (
        <>
          <Rect x={3} y={6} width={18} height={13} rx={2.5} {...p} />
          <Path d="M16 12h2" {...p} />
          <Circle cx={16.5} cy={12.5} r={0.6} fill={stroke} />
        </>
      );

    case 'user':
      return (
        <>
          <Circle cx={12} cy={8} r={3.4} {...p} />
          <Path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" {...p} />
        </>
      );

    case 'barcode':
      return <Path d="M4 6v12M7 6v12M10 6v9M13 6v12M16 6v9M20 6v12" {...p} />;

    case 'serial':
      return (
        <>
          <Rect x={3} y={6} width={18} height={12} rx={2} {...p} />
          <Path d="M7 10v4M10 10v4M13 10v4M16.5 10v4" {...p} />
        </>
      );

    case 'photos':
      return (
        <>
          <Rect x={3} y={7} width={18} height={13} rx={2.5} {...p} />
          <Circle cx={12} cy={13.5} r={3.4} {...p} />
          <Path d="M8 7l1.4-2.2h5.2L16 7" {...p} />
        </>
      );

    case 'geo':
      return (
        <>
          <Path d="M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z" {...p} />
          <Circle cx={12} cy={10} r={2.4} {...p} />
        </>
      );

    case 'bell':
      return (
        <>
          <Path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" {...p} />
          <Path d="M10 20a2 2 0 004 0" {...p} />
        </>
      );

    case 'globe':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" {...p} />
        </>
      );

    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...p} />;

    case 'minus':
      return <Path d="M5 12h14" {...p} />;

    case 'gift':
      return (
        <>
          <Rect x={4} y={9} width={16} height={11} rx={1.5} {...p} />
          <Path
            d="M4 13h16M12 9v11M12 9C10 9 8 8 8 6.5S9.5 4 12 6.5C14.5 4 16 5 16 6.5S14 9 12 9z"
            {...p}
          />
        </>
      );

    case 'card':
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} {...p} />
          <Path d="M3 9h18" {...p} />
        </>
      );

    case 'warn':
      return (
        <>
          <Path d="M12 3l9 16H3l9-16z" {...p} />
          <Path d="M12 9v4M12 16v.5" {...p} />
        </>
      );

    case 'tv':
      return (
        <>
          <Rect x={3} y={4} width={18} height={13} rx={2} {...p} />
          <Path d="M9 20h6M12 17v3" {...p} />
        </>
      );

    case 'washer':
      return (
        <>
          <Rect x={5} y={3} width={14} height={18} rx={2} {...p} />
          <Circle cx={12} cy={13} r={4.5} {...p} />
          <Path d="M8 6h.01M11 6h.01" {...p} />
        </>
      );

    case 'fridge':
      return (
        <>
          <Rect x={6} y={3} width={12} height={18} rx={2} {...p} />
          <Path d="M6 10h12M9 6v1M9 13v2" {...p} />
        </>
      );

    case 'ac':
      return (
        <>
          <Rect x={3} y={5} width={18} height={7} rx={2} {...p} />
          <Path
            d="M6 16c1 0 1.5-1 3-1M15 16c1 0 1.5-1 3-1M6 19c1 0 1.5-1 3-1M15 19c1 0 1.5-1 3-1"
            {...p}
          />
        </>
      );

    case 'micro':
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} {...p} />
          <Rect x={6} y={8} width={8} height={8} rx={1} {...p} />
          <Path d="M17 9v6" {...p} />
        </>
      );

    case 'purifier':
      return <Path d="M12 3s5 6 5 10a5 5 0 01-10 0c0-4 5-10 5-10z" {...p} />;

    /* Product-master catalogue. Traced in the same house style as the six
       approved category glyphs above — rects, circles and short paths — rather
       than copied from lucide, so a picked icon sits beside the approved ones
       without looking imported. adminWeb draws lucide's version of the same
       concept; the shapes differ there exactly as the six already do. */

    case 'fan':
      return (
        <>
          <Circle cx={12} cy={12} r={1.8} {...p} />
          <Path
            d="M12 10.2V4.6a3.6 3.6 0 013.6 3.6c0 1.4-1.2 2-3.6 2M13.8 12h5.6a3.6 3.6 0 01-3.6 3.6c-1.4 0-2-1.2-2-3.6M12 13.8v5.6a3.6 3.6 0 01-3.6-3.6c0-1.4 1.2-2 3.6-2M10.2 12H4.6a3.6 3.6 0 013.6-3.6c1.4 0 2 1.2 2 3.6"
            {...p}
          />
        </>
      );

    case 'wind':
      return (
        <Path
          d="M3 8h9a2.6 2.6 0 10-2.6-2.6M3 12h12a2.6 2.6 0 11-2.6 2.6M3 16h7"
          {...p}
        />
      );

    case 'flame':
      return (
        <>
          <Path d="M12 21a5.5 5.5 0 005.5-5.5C17.5 11 12 5 12 5s-5.5 6-5.5 10.5A5.5 5.5 0 0012 21z" {...p} />
          <Path d="M12 21a2.4 2.4 0 002.4-2.4c0-2-2.4-4.2-2.4-4.2s-2.4 2.2-2.4 4.2A2.4 2.4 0 0012 21z" {...p} />
        </>
      );

    case 'laptop':
      return (
        <>
          <Rect x={4} y={5} width={16} height={11} rx={2} {...p} />
          <Path d="M2 19.5h20" {...p} />
        </>
      );

    case 'smartphone':
      return (
        <>
          <Rect x={7} y={2} width={10} height={20} rx={2.5} {...p} />
          <Path d="M11 18.6h2" {...p} />
        </>
      );

    case 'monitor':
      return (
        <>
          <Rect x={2.5} y={4} width={19} height={12} rx={2} {...p} />
          <Path d="M12 16v4M7.5 20h9" {...p} />
        </>
      );

    case 'printer':
      return (
        <>
          <Path d="M7 8V3h10v5" {...p} />
          <Rect x={3.5} y={8} width={17} height={8} rx={2} {...p} />
          <Rect x={7} y={14} width={10} height={7} rx={1} {...p} />
        </>
      );

    case 'headphones':
      return (
        <>
          <Path d="M4 15.5V12a8 8 0 0116 0v3.5" {...p} />
          <Rect x={2} y={14} width={4.5} height={6.5} rx={2} {...p} />
          <Rect x={17.5} y={14} width={4.5} height={6.5} rx={2} {...p} />
        </>
      );

    case 'speaker':
      return (
        <>
          <Rect x={6} y={2} width={12} height={20} rx={2.5} {...p} />
          <Circle cx={12} cy={15} r={3.2} {...p} />
          <Circle cx={12} cy={6.5} r={0.8} fill={stroke} />
        </>
      );

    case 'coffee':
      return (
        <>
          <Path d="M4 9h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5V9z" {...p} />
          <Path d="M17 10.5h1.5a2.5 2.5 0 010 5H17" {...p} />
          <Path d="M7.5 3v2.5M11 3v2.5" {...p} />
        </>
      );

    case 'utensils':
      return (
        <Path
          d="M6.5 3v5.5a2.5 2.5 0 005 0V3M9 11v10M17.5 3c-2 2-2 6.5 0 8.5V21"
          {...p}
        />
      );

    case 'sofa':
      return (
        <>
          <Path d="M4.5 11.5V8a2 2 0 012-2h11a2 2 0 012 2v3.5" {...p} />
          <Rect x={2.5} y={11.5} width={19} height={6.5} rx={2.2} {...p} />
          <Path d="M6.5 18v2M17.5 18v2M8 11.5V9.5h8v2" {...p} />
        </>
      );

    case 'lightbulb':
      return (
        <>
          <Path d="M9 16.5a5.8 5.8 0 116 0V19H9v-2.5z" {...p} />
          <Path d="M10 22h4" {...p} />
        </>
      );

    case 'plug':
      return (
        <>
          <Path d="M9 2.5v5.5M15 2.5v5.5" {...p} />
          <Path d="M6 8h12v3a6 6 0 01-12 0V8z" {...p} />
          <Path d="M12 17v4.5" {...p} />
        </>
      );

    case 'battery':
      return (
        <>
          <Rect x={2} y={7} width={17} height={10} rx={2.5} {...p} />
          <Path d="M21.5 10.5v3" {...p} />
          <Path d="M6 11v2M9.5 11v2M13 11v2" {...p} />
        </>
      );

    case 'zap':
      return <Path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12l1-7.5z" {...p} />;

    case 'wrench':
      return (
        <Path
          d="M15.5 3a5.5 5.5 0 00-5.2 7.3L3.6 17a2.1 2.1 0 003 3l6.7-6.7A5.5 5.5 0 0021 8.5a5.5 5.5 0 00-.3-1.8l-3.1 3.1-2.4-2.4 3.1-3.1A5.5 5.5 0 0015.5 3z"
          {...p}
        />
      );

    case 'package':
      return (
        <>
          <Path d="M20.5 7.6v8.8a1.8 1.8 0 01-.9 1.5l-6.7 3.8a1.8 1.8 0 01-1.8 0l-6.7-3.8a1.8 1.8 0 01-.9-1.5V7.6a1.8 1.8 0 01.9-1.5l6.7-3.8a1.8 1.8 0 011.8 0l6.7 3.8a1.8 1.8 0 01.9 1.5z" {...p} />
          <Path d="M3.6 6.8L12 11.7l8.4-4.9M12 21.4V11.7" {...p} />
        </>
      );

    case 'chevronLeft':
      return <Path d="M15 5l-7 7 7 7" {...p} />;

    case 'arrowRight':
      return <Path d="M5 12h13M13 6l6 6-6 6" {...p} />;

    case 'link':
      return (
        <Path
          d="M9 15l6-6M8 9h1a4 4 0 010 8H8a4 4 0 01-4-4M16 15h-1a4 4 0 010-8h1a4 4 0 014 4"
          {...p}
        />
      );

    case 'lock':
      return (
        <>
          <Rect x={5} y={11} width={14} height={9} rx={2} {...p} />
          <Path d="M8 11V8a4 4 0 018 0v3" {...p} />
        </>
      );

    case 'check':
      return <Path d="M5 12l4 4 10-10" {...p} />;

    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" {...p} />;

    case 'chevronRight':
      return <Path d="M9 6l6 6-6 6" {...p} />;

    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 7.5V12l3 2" {...p} />
        </>
      );

    case 'calendar':
      return (
        <>
          <Rect x={4} y={5} width={16} height={15} rx={2} {...p} />
          <Path d="M4 9h16M8 3v4M16 3v4" {...p} />
        </>
      );

    case 'phone':
      return (
        <Path
          d="M5 4h3l1.5 4.5-2 1.5a11 11 0 005 5l1.5-2 4.5 1.5V19a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
          {...p}
        />
      );

    case 'navigation':
      return (
        <>
          <Path d="M3 8l7-3 4 2 7-3v11l-7 3-4-2-7 3V8z" {...p} />
          <Path d="M10 5v11M14 7v11" {...p} />
        </>
      );

    case 'play':
      return <Path d="M8 5v14l11-7L8 5z" {...p} />;

    case 'info':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 8v4M12 15v.5" {...p} />
        </>
      );

    // Circular arrow — rotate the image 90 degrees.
    case 'rotate':
      return (
        <>
          <Path d="M4 12a8 8 0 1 1 2.3 5.7" {...p} />
          <Path d="M4 6v5h5" {...p} />
        </>
      );

    case 'edit':
      return <Path d="M17 3l4 4-11 11-4 1 1-4L18 4" {...p} />;

    // Four-point star — the app's mark for "AI is working on this".
    case 'sparkle':
      return (
        <Path
          d="M12 3l1.9 4.6L18.5 9l-3.4 3 1 4.9L12 14.6 7.9 16.9l1-4.9L5.5 9l4.6-1.4L12 3z"
          {...p}
        />
      );

    case 'camera':
      return (
        <>
          <Rect x={3} y={7} width={18} height={13} rx={2.5} {...p} />
          <Circle cx={12} cy={13.5} r={3.5} {...p} />
        </>
      );

    // Map plus a tick — "the link went out to where they are".
    case 'mapCheck':
      return (
        <>
          <Path d="M3 8l7-3 4 2 7-3v11l-7 3-4-2-7 3V8z" {...p} strokeWidth={1.7} />
          <Path d="M9 12l2 2 4-4" {...p} strokeWidth={1.8} />
        </>
      );

    case 'cameraOff':
      return (
        <>
          <Rect x={3} y={6} width={18} height={14} rx={2.5} {...p} />
          <Path d="M8 6l1.4-2.2h5.2L16 6" {...p} />
          <Path d="M4 4l16 18" {...p} />
        </>
      );
  }
}

/**
 * Product category → icon, as mapped in the prototype's registration screen.
 *
 * @deprecated Keyed by category NAME, which the product master replaced with a
 * server-chosen `iconKey`. Use `productIcon()` from `./productIcons` instead.
 * Still here only until CoverageScreen reads the catalogue from the API.
 */
export const CATEGORY_ICONS: Record<string, IconName> = {
  Television: 'tv',
  'Washing Machine': 'washer',
  Refrigerator: 'fridge',
  'Air Conditioner': 'ac',
  Microwave: 'micro',
  'Water Purifier': 'purifier',
};
