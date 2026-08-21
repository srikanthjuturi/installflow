import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons/Icon';
import { Button, Sheet } from '@/components/ui';
import { useAvatarPicker } from '@/features/profile/hooks/useAvatarPicker';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';

/**
 * Photo source picker.
 *
 * A sheet rather than a native action sheet so it matches the accept-slot
 * sheet — same grabber, same corners — and so the rows carry the app's own
 * type and icons, which platform action sheets style inconsistently.
 *
 * Removing the photo is NOT here. It sits on the photo viewer, next to the
 * picture it removes — and it has to reach the server, which this sheet never
 * did. See PhotoViewerScreen.
 */
export function AvatarOptionsSheet() {
  const router = useRouter();
  const { fromCamera, fromLibrary, busy } = useAvatarPicker();

  const dismiss = () => router.back();

  // No dismiss here — a successful pick replaces this route with the crop
  // screen, and dismissing on cancel would lose the sheet unnecessarily.
  const pick = (source: 'camera' | 'library') =>
    source === 'camera' ? fromCamera() : fromLibrary();

  return (
    <Sheet onDismiss={dismiss}>
      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary }}>
        Profile picture
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 14,
          lineHeight: 22,
          color: color.textLabel,
          marginTop: 8,
          marginBottom: 18,
        }}
      >
        You&apos;ll be able to crop it to a square before it&apos;s saved.
      </Text>

      <View
        style={{
          backgroundColor: color.surfaceSunkenAlt,
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <OptionRow
          icon="camera"
          label="Take a photo"
          onPress={() => pick('camera')}
          disabled={busy}
          first
        />
        <OptionRow
          icon="photos"
          label="Choose from gallery"
          onPress={() => pick('library')}
          disabled={busy}
        />
      </View>

      <Button label="Cancel" variant="ghost" onPress={dismiss} disabled={busy} />
    </Sheet>
  );
}

interface OptionRowProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  first?: boolean;
}

function OptionRow({ icon, label, onPress, disabled, first }: OptionRowProps) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button">
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            paddingVertical: 15,
            paddingHorizontal: 16,
            borderTopWidth: first ? 0 : 1,
            borderTopColor: palette.neutral[200],
            backgroundColor: pressed ? color.surfaceSunken : 'transparent',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Icon name={icon} size={21} color={color.actionBg} strokeWidth={1.7} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Roboto_500Medium',
              fontSize: 14.5,
              color: color.textPrimary,
            }}
          >
            {label}
          </Text>
          <Icon name="chevronRight" size={19} color={color.textMuted} />
        </View>
      )}
    </Pressable>
  );
}
