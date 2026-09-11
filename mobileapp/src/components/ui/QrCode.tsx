import QRCode from 'qrcode';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { color } from '@/theme/semantic';

export interface QrCodeProps {
  /** The finished string to encode — for a payment, the server's `upiUri`. */
  value: string;
  /** Rendered width and height, in points, including the quiet zone. */
  size?: number;
  accessibilityLabel?: string;
}

/** Modules of white around the code. Scanners need at least two. */
const QUIET_ZONE = 2;

/**
 * A QR code, drawn on the device from a string it never parses.
 *
 * Encoded locally rather than fetched as an image, for two reasons that both
 * matter on a payment screen: a QR-image service would see a technician's UPI
 * ID next to an amount, and an image that fails to load offline shows a payer
 * a blank box with no way to pay. `qrcode.create` is pure JS and draws through
 * `react-native-svg`, which is already here — nothing native, so Expo Go runs it.
 *
 * One `<Path>` for every dark module rather than one `<Rect>` each: a UPI link
 * is ~35×35 modules, and a thousand SVG nodes is a visible stall on the phones
 * these technicians carry.
 *
 * Always dark-on-white (`qrInk` / `qrPlate`) whatever surrounds it — see the
 * note on those roles.
 */
export function QrCode({ value, size = 200, accessibilityLabel }: QrCodeProps) {
  const drawn = useMemo(() => {
    // Error-correction M: the level UPI apps' own codes use — survives a
    // scuffed screen or glare without making the code needlessly dense.
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = modules.size;
    let d = '';
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (modules.get(x, y)) {
          d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { d, extent: n + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${drawn.extent} ${drawn.extent}`}>
        <Rect x={0} y={0} width={drawn.extent} height={drawn.extent} fill={color.qrPlate} />
        <Path d={drawn.d} fill={color.qrInk} />
      </Svg>
    </View>
  );
}
