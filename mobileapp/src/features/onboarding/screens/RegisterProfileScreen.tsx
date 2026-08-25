import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { KeyboardFlow, ScreenStatusBar } from '@/components/layout';
import { Avatar, Button, Input, StepDots } from '@/components/ui';
import {
  REGISTRATION_STEP_COUNT,
  stepNumber,
  useRegistration,
} from '@/store/registration.store';
import { useProfileStore } from '@/store/profile.store';
import { color } from '@/theme/semantic';

const MIN_NAME = 2;

/** "+919876543210" → "+91 98765 43210". */
function prettyPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/**
 * R1b — the technician's own name and photo.
 *
 * A new screen, and the only one in the flow that is not from the approved
 * prototype. It exists because a manager can now invite with nothing but a
 * phone number, so somebody has to supply the name — and putting inputs on R1
 * would have turned an approved read-only confirmation into a form.
 *
 * Both facts here are customer-facing: the name and photo are what a customer
 * sees when this technician turns up at their door.
 */
export function RegisterProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const draft = useRegistration((s) => s.draft);
  const setProfile = useRegistration((s) => s.setProfile);
  // The crop screen writes here, so the photo survives the round trip through
  // two modals without this screen having to thread it.
  const avatarUri = useProfileStore((s) => s.avatarUri);

  const [name, setName] = useState(draft?.fullName ?? '');

  // Reachable only mid-registration. Any other way in means the draft was
  // cleared underneath us — send them back to the start rather than crash.
  if (!draft) {
    router.replace('/(auth)/login');
    return null;
  }

  const trimmed = name.trim();
  const ready = trimmed.length >= MIN_NAME;

  return (
    <View style={{ flex: 1, backgroundColor: color.surfaceRaised }}>
      <ScreenStatusBar style="dark" />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingTop: insets.top + 6,
          paddingHorizontal: 12,
          paddingBottom: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          {({ pressed }) => (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? color.surfaceSunken : 'transparent',
              }}
            >
              <Icon name="chevronLeft" size={24} color={color.textPrimary} />
            </View>
          )}
        </Pressable>

        <View style={{ marginLeft: 'auto', marginRight: 8 }}>
          <StepDots
            total={REGISTRATION_STEP_COUNT}
            current={stepNumber('profile')}
          />
        </View>
      </View>

      <KeyboardFlow
        footer={
          <View
            style={{
              paddingTop: 12,
              paddingHorizontal: 22,
              paddingBottom: 16,
              borderTopWidth: 1,
              borderTopColor: color.surface,
            }}
          >
            {/* Blocked, the hint IS the label — one control, always saying what
                it needs. Same pattern as the coverage screen. */}
            <Button
              label={ready ? 'Continue' : 'Enter your full name'}
              onPress={() => {
                setProfile(trimmed, avatarUri);
                router.push('/coverage');
              }}
              disabled={!ready}
            />
          </View>
        }
      >
        <View style={{ paddingTop: 6, paddingHorizontal: 22, paddingBottom: 20 }}>
          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: 24,
              lineHeight: 28,
              letterSpacing: -0.5,
              color: color.textPrimary,
            }}
          >
            Tell us who you are
          </Text>
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13.5,
              lineHeight: 20,
              color: color.textSecondary,
              marginTop: 8,
            }}
          >
            Your name and photo are what the customer sees when you arrive for a job.
          </Text>

          <View style={{ alignItems: 'center', marginTop: 26 }}>
            <Pressable
              onPress={() => router.push('/avatar-options')}
              accessibilityRole="button"
              accessibilityLabel="Add a profile photo"
            >
              <Avatar
                name={trimmed || '?'}
                uri={avatarUri}
                size={92}
                editable
                badgeRing={color.surfaceRaised}
              />
            </Pressable>
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12,
                lineHeight: 17,
                color: color.textFootnote,
                textAlign: 'center',
                marginTop: 10,
              }}
            >
              Tap to add a clear face photo. You can change it later.
            </Text>
          </View>

          <View style={{ marginTop: 26 }}>
            <Input
              label="Full name"
              value={name}
              onChangeText={setName}
              placeholder="As it appears on your ID"
            />
          </View>

          <View style={{ marginTop: 16 }}>
            {/* From the invite and not editable — the account is created
                against the number the manager invited, so letting them change
                it here would just fail server-side. */}
            <Input
              label="Mobile"
              value={prettyPhone(draft.invite.phone)}
              onChangeText={() => {}}
              editable={false}
            />
            <Text
              style={{
                fontFamily: 'Roboto_400Regular',
                fontSize: 12,
                lineHeight: 17,
                color: color.textFootnote,
                marginTop: 6,
              }}
            >
              From your invite. Contact your ASM to change it.
            </Text>
          </View>
        </View>
      </KeyboardFlow>
    </View>
  );
}
