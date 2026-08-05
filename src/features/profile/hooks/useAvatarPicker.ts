import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';

import { useProfileStore } from '@/store/profile.store';

/**
 * Picks a profile photo from the camera or the library, cropped square.
 *
 * `allowsEditing` hands off to the platform's own crop UI rather than shipping
 * a custom cropper. That keeps the app inside Expo Go, and the native croppers
 * are the ones these users already know from every other app on the phone.
 * The 1:1 aspect is forced because the avatar is a square tile — letting a
 * portrait through would just centre-crop it invisibly later.
 */
export function useAvatarPicker() {
  const setAvatar = useProfileStore((s) => s.setAvatar);
  const [busy, setBusy] = useState(false);

  const denied = (what: string) => {
    Alert.alert(
      `${what} access needed`,
      `Enable ${what.toLowerCase()} access in Settings to set a profile picture.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ],
    );
  };

  const handle = (result: ImagePicker.ImagePickerResult) => {
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) setAvatar(asset.uri);
  };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  };

  const fromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return denied('Camera');

    setBusy(true);
    try {
      handle(await ImagePicker.launchCameraAsync(options));
    } finally {
      setBusy(false);
    }
  };

  const fromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return denied('Photos');

    setBusy(true);
    try {
      handle(await ImagePicker.launchImageLibraryAsync(options));
    } finally {
      setBusy(false);
    }
  };

  return { fromCamera, fromLibrary, busy };
}
