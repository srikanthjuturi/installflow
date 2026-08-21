import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { useProfileStore } from '@/store/profile.store';
import { color } from '@/theme/semantic';

export interface AvatarProps {
  /** Full name — initials are derived from it when there's no photo. */
  name: string;
  size?: number;
  /** Defaults to ~30% of size, matching the prototype's 74/22 and 44/13. */
  radius?: number;
  /**
   * Explicit photo. Omit for the signed-in technician and it reads the profile
   * store, so every avatar of "me" updates the moment the photo changes.
   */
  uri?: string | null;
  /** Camera badge — only on the editable avatar. */
  editable?: boolean;
  /**
   * Makes the camera badge its OWN tap target.
   *
   * Profile wraps the avatar in a press that opens the photo viewer, so the
   * badge needs to be separately pressable or there is no way left to reach
   * the change-photo sheet. The badge geometry is computed here, so the hit
   * area has to be built here too rather than guessed by the caller.
   */
  onBadgePress?: () => void;
  /** Ring colour for that badge; should match whatever the avatar sits on. */
  badgeRing?: string;
}

function initialsOf(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Photo-or-initials avatar.
 *
 * Reads the profile store when no `uri` is passed, so the Home header and the
 * Profile screen can never drift out of sync — set the photo once and it
 * appears everywhere the technician sees themselves.
 */
export function Avatar({
  name,
  size = 44,
  radius,
  uri,
  editable = false,
  badgeRing = color.chrome,
  onBadgePress,
}: AvatarProps) {
  const stored = useProfileStore((s) => s.avatarUri);
  const photo = uri === undefined ? stored : uri;
  const corner = radius ?? Math.round(size * 0.3);

  const badgeSize = Math.max(22, Math.round(size * 0.38));

  return (
    <View>
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={{ width: size, height: size, borderRadius: corner }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: corner,
            backgroundColor: color.actionBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_900Black',
              fontSize: Math.round(size * 0.38),
              color: color.actionFg,
            }}
          >
            {initialsOf(name)}
          </Text>
        </View>
      )}

      {editable ? (
        // Ringed in the surrounding colour so it reads as a cutout rather than
        // a sticker — same treatment as Home's unread dot.
        <BadgeHost onPress={onBadgePress}>
          <View
            style={{
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: color.surfaceRaised,
              borderWidth: 3,
              borderColor: badgeRing,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              name="camera"
              size={Math.round(badgeSize * 0.5)}
              color={color.textPrimary}
              strokeWidth={2}
            />
          </View>
        </BadgeHost>
      ) : null}
    </View>
  );
}

/**
 * Pins the badge to the avatar's bottom-right corner, pressable or not.
 *
 * A plain View when nobody wants the tap, so avatars that merely LOOK editable
 * do not swallow touches meant for whatever wraps them.
 */
function BadgeHost({ onPress, children }: { onPress?: () => void; children: ReactNode }) {
  const pin = { position: 'absolute', right: -4, bottom: -4 } as const;

  if (!onPress) return <View style={pin}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={pin}
      accessibilityRole="button"
      accessibilityLabel="Change profile picture"
    >
      {({ pressed }) => <View style={{ opacity: pressed ? 0.7 : 1 }}>{children}</View>}
    </Pressable>
  );
}
