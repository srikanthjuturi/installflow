import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";

import { color } from "@/theme/semantic";
import type { ProofKind } from "@/types/domain";

export interface CaptureOverlayProps {
  step: ProofKind;
  pincode: string;
  photoCount: number;
  /**
   * The real state of the location fix, for the live step.
   *
   * This badge used to read "Location locked" unconditionally while nothing
   * ever read the GPS — a claim the app could not support, and a worthless one
   * if a visit were ever disputed. It now says which of the three is true.
   */
  geo?: 'acquiring' | 'locked' | 'unavailable';
  /**
   * The postal code the DEVICE is in, reverse-geocoded from the live fix.
   *
   * Distinct from `pincode`, which is the JOB's. The badge printed the job's
   * beside the words "Location locked", which reads as a confirmation that the
   * technician is standing at the address — a claim nothing was making. This is
   * the phone's own answer, and the two are compared rather than conflated.
   */
  devicePincode?: string | null;
  /** `16.20341, 80.11235` — shown when there is no postal code to name. */
  coords?: string | null;
  accuracyM?: number | null;
}

/** Framing guides drawn over the live camera. Prototype insets everything 11%. */
const INSET = "11%";

export function CaptureOverlay({
  step,
  pincode,
  photoCount,
  geo = 'acquiring',
  devicePincode = null,
  coords = null,
  accuracyM = null,
}: CaptureOverlayProps) {
  return (
    <View style={{ flex: 1 }} pointerEvents="none">
      <CornerBrackets />

      {step === "barcode" ? <ScanLine /> : null}
      {step === "serial" ? <SerialFrame /> : null}
      {step === "photos" ? <ThirdsGrid count={photoCount} /> : null}
      {step === "live" ? (
        <GeoLock
          jobPincode={pincode}
          devicePincode={devicePincode}
          coords={coords}
          accuracyM={accuracyM}
          geo={geo}
        />
      ) : null}
    </View>
  );
}

/**
 * Four 34px corners rather than a full rectangle. A closed box reads as a crop
 * boundary — "only this will be captured" — whereas corners read as an aiming
 * guide, which is what they are.
 */
function CornerBrackets() {
  const arm = {
    position: "absolute" as const,
    width: 34,
    height: 34,
    borderColor: color.textInverse,
  };

  return (
    <View
      style={{
        position: "absolute",
        top: INSET,
        bottom: INSET,
        left: INSET,
        right: INSET,
      }}
    >
      <View
        style={{
          ...arm,
          top: 0,
          left: 0,
          borderTopWidth: 3,
          borderLeftWidth: 3,
          borderTopLeftRadius: 6,
        }}
      />
      <View
        style={{
          ...arm,
          top: 0,
          right: 0,
          borderTopWidth: 3,
          borderRightWidth: 3,
          borderTopRightRadius: 6,
        }}
      />
      <View
        style={{
          ...arm,
          bottom: 0,
          left: 0,
          borderBottomWidth: 3,
          borderLeftWidth: 3,
          borderBottomLeftRadius: 6,
        }}
      />
      <View
        style={{
          ...arm,
          bottom: 0,
          right: 0,
          borderBottomWidth: 3,
          borderRightWidth: 3,
          borderBottomRightRadius: 6,
        }}
      />
    </View>
  );
}

/** Amber sweep across the framing area — the barcode step's only motion. */
function ScanLine() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 2000 }), -1, true);
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    top: `${11 + progress.value * 78}%`,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: INSET,
          right: INSET,
          height: 2,
          backgroundColor: color.scanLine,
          shadowColor: color.scanLine,
          shadowOpacity: 0.9,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        },
        style,
      ]}
    />
  );
}

/** Dashed target for the serial sticker, with the expected format spelled out. */
function SerialFrame() {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: "66%",
          borderWidth: 2,
          borderStyle: "dashed",
          borderColor: color.cameraGuide,
          borderRadius: 8,
          paddingVertical: 14,
          paddingHorizontal: 16,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontFamily: "RobotoMono_400Regular",
            fontSize: 11,
            letterSpacing: 1.1,
            color: color.textOnChrome,
          }}
        >
          SERIAL NO.
        </Text>
        <Text
          style={{
            fontFamily: "RobotoMono_700Bold",
            fontSize: 19,
            letterSpacing: 2.3,
            color: color.textInverse,
            marginTop: 4,
          }}
        >
          RGT-•••••-••••
        </Text>
      </View>
    </View>
  );
}

/** Rule-of-thirds guide plus the running thumbnail strip. */
function ThirdsGrid({ count }: { count: number }) {
  return (
    <>
      <View
        style={{
          position: "absolute",
          top: INSET,
          bottom: INSET,
          left: INSET,
          right: INSET,
          flexDirection: "row",
          opacity: 0.18,
        }}
      >
        {[0, 1, 2].map((col) => (
          <View
            key={col}
            style={{
              flex: 1,
              borderRightWidth: col < 2 ? 1 : 0,
              borderRightColor: color.textInverse,
            }}
          >
            {[0, 1, 2].map((row) => (
              <View
                key={row}
                style={{
                  flex: 1,
                  borderBottomWidth: row < 2 ? 1 : 0,
                  borderBottomColor: color.textInverse,
                }}
              />
            ))}
          </View>
        ))}
      </View>

      <View
        style={{
          position: "absolute",
          bottom: 14,
          left: 14,
          flexDirection: "row",
          gap: 7,
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              borderWidth: 2,
              borderColor: color.textInverse,
              backgroundColor: color.chrome,
            }}
          />
        ))}
      </View>
    </>
  );
}

/**
 * Crosshair plus a lock badge near the top.
 *
 * Green because this confirms a check has passed — the device has a real fix,
 * which is recorded with the photo. Amber would read as a caution, which
 * inverts the meaning of the one artifact that evidences attendance.
 *
 * It states the ticket's pincode beside the lock, and does NOT claim the
 * coordinates were matched against it: nothing compares them yet. Saying
 * "locked · 400067" is true — we have a fix, and this is the job's area — where
 * "matched" would be the assertion this badge spent its first life making
 * falsely.
 */
function GeoLock({
  jobPincode,
  devicePincode,
  coords,
  accuracyM,
  geo,
}: {
  jobPincode: string;
  devicePincode: string | null;
  coords: string | null;
  accuracyM: number | null;
  geo: NonNullable<CaptureOverlayProps['geo']>;
}) {
  // The technician is somewhere the job is not. Not a refusal — pincode
  // boundaries are fuzzy and reverse geocoding is approximate — but the one
  // fact this badge exists to surface, so it is said plainly rather than
  // dressed as a confirmation.
  const elsewhere =
    geo === 'locked' && !!devicePincode && !!jobPincode && devicePincode !== jobPincode;

  const label =
    geo === 'acquiring'
      ? 'Finding your location…'
      : geo === 'unavailable'
        ? 'Location unavailable'
        : elsewhere
          ? `You are at ${devicePincode} · job is ${jobPincode}`
          : devicePincode
            ? `Location locked · ${devicePincode}` +
              (accuracyM ? ` (±${Math.round(accuracyM)}m)` : '')
            : coords
              ? `Location locked · ${coords}`
              : 'Location locked';
  return (
    <>
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 56, height: 56 }}>
          <View
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              borderWidth: 2,
              borderColor: color.textInverse,
              borderRadius: 28,
              opacity: 0.7,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: 27,
              top: -14,
              bottom: -14,
              width: 2,
              backgroundColor: color.shutterRing,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: 27,
              left: -14,
              right: -14,
              height: 2,
              backgroundColor: color.shutterRing,
            }}
          />
        </View>
      </View>

      <View
        style={{
          position: "absolute",
          top: "14%",
          left: 0,
          right: 0,
          alignItems: "center",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            backgroundColor: elsewhere ? color.statusCancelled.bg : color.geoLockBg,
            borderRadius: 999,
            paddingVertical: 7,
            paddingHorizontal: 13,
          }}
        >
          {/* Filled centre, unlike the outline geo glyph used elsewhere —
              it reads as "locked" rather than "a location". */}
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z"
              stroke={elsewhere ? color.debit : color.textInverse}
              strokeWidth={1.9}
              fill="none"
            />
            <Circle cx={12} cy={10} r={2.2} fill={elsewhere ? color.debit : color.textInverse} />
          </Svg>

          <Text
            style={{
              fontFamily: "Roboto_700Bold",
              fontSize: 12,
              color: elsewhere ? color.debit : color.textInverse,
            }}
          >
            {label}
          </Text>
        </View>
      </View>
    </>
  );
}
