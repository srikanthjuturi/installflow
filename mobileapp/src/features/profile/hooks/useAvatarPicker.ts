import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';

/**
 * Picks a profile photo, then hands off to OUR crop screen.
 *
 * `allowsEditing` is deliberately off. The platform cropper inherits the host
 * app's Android theme, which under Expo Go means dark icons on a dark toolbar
 * and no visible Done action — unfixable from config. Routing to CropScreen
 * instead gives one themed, predictable experience everywhere.
 */
export function useAvatarPicker() {
  const router = useRouter();
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
    if (!asset) return;

    router.replace({
      pathname: '/crop-photo',
      params: {
        uri: asset.uri,
        width: String(asset.width),
        height: String(asset.height),
      },
    });
  };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
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
