import { Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';
import type { ProofKind } from '@/types/domain';

export interface CaptureOverlayProps {
  step: ProofKind;
  pincode: string;
}

/**
 * The framing guide drawn over the live camera.
 *
 * Each step gets a different target because each is a different photo: a wide
 * barcode strip, a tight serial label, a free frame for the unit, and a full
 * frame with the geo lock for the live shot. A single generic box would make
 * all four look interchangeable, which is exactly the mistake that produces
 * unreadable serial photos and a wasted return visit.
 */
export function CaptureOverlay({ step, pincode }: CaptureOverlayProps) {
  if (step === 'barcode') {
    return (
      <Frame width="86%" height={130}>
        <View
          style={{
            height: 2,
            backgroundColor: color.debit,
            width: '80%',
            alignSelf: 'center',
            opacity: 0.9,
          }}
        />
      </Frame>
    );
  }

  if (step === 'serial') {
    return (
      <Frame width="80%" height={96}>
        <Text
          style={{
            fontFamily: 'Roboto_700Bold',
            fontSize: 10,
            letterSpacing: 1.4,
            color: color.textInverse,
            opacity: 0.7,
            textAlign: 'center',
          }}
        >
          SERIAL NO.
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_900Black',
            fontSize: 17,
            color: color.textInverse,
            opacity: 0.45,
            textAlign: 'center',
            marginTop: 2,
          }}
        >
          VCN-•••••-••••
        </Text>
      </Frame>
    );
  }

  if (step === 'live') {
    return (
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 24 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: color.slotBg,
            borderRadius: radius.full,
            paddingHorizontal: 14,
            paddingVertical: 9,
          }}
        >
          <Icon name="geo" size={15} color={color.slotFg} />
          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 12.5, color: color.slotFg }}>
            Location locked · {pincode}
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

interface FrameProps {
  width: `${number}%`;
  height: number;
  children?: React.ReactNode;
}

function Frame({ width, height, children }: FrameProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width,
          height,
          borderRadius: radius.md,
          borderWidth: 2,
          borderColor: color.textInverse,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        {children}
      </View>
    </View>
  );
}
