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
  // chrome
  | 'chevronLeft'
  | 'arrowRight'
  | 'link'
  | 'lock';

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
  }
}

/** Product category → icon, as mapped in the prototype's registration screen. */
export const CATEGORY_ICONS: Record<string, IconName> = {
  Television: 'tv',
  'Washing Machine': 'washer',
  Refrigerator: 'fridge',
  'Air Conditioner': 'ac',
  Microwave: 'micro',
  'Water Purifier': 'purifier',
};
