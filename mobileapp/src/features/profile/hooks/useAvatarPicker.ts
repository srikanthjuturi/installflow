import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking } from 'react-native';

import { toWorkingCopy } from '@/lib/images';

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
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  // Whole sentences per case. It used to splice "Camera" or "Photos" into one
  // template and lower-case it, which only works in English.
  const denied = (what: 'camera' | 'photos') => {
    Alert.alert(
      what === 'camera' ? t('common.cameraAccessNeeded') : t('profile.avatar.photosDeniedTitle'),
      what === 'camera'
        ? t('profile.avatar.cameraDeniedBody')
        : t('profile.avatar.photosDeniedBody'),
      [
        { text: t('common.notNow'), style: 'cancel' },
        { text: t('profile.avatar.openSettings'), onPress: () => Linking.openSettings() },
      ],
    );
  };

  /**
   * The crop screen never sees the original file.
   *
   * A full-resolution phone photo is more pixels than the 512px avatar can use
   * and enough to abort the process when the native cropper allocates a second
   * bitmap beside it — see `toWorkingCopy`. Shrinking here also means the crop
   * screen's rotate is cheap, and that its dimensions are known integers rather
   * than whatever the gallery provider felt like reporting.
   */
  const handle = async (result: ImagePicker.ImagePickerResult) => {
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;

    let source;
    try {
      source = await toWorkingCopy(asset.uri, asset.width, asset.height);
    } catch {
      Alert.alert(t('profile.photo.openFailed'), t('profile.photo.tryDifferent'));
      return;
    }

    router.replace({
      pathname: '/crop-photo',
      params: {
        uri: source.uri,
        width: String(source.width),
        height: String(source.height),
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
    if (!permission.granted) return denied('camera');

    setBusy(true);
    try {
      await handle(await ImagePicker.launchCameraAsync(options));
    } finally {
      setBusy(false);
    }
  };

  const fromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return denied('photos');

    setBusy(true);
    try {
      await handle(await ImagePicker.launchImageLibraryAsync(options));
    } finally {
      setBusy(false);
    }
  };

  return { fromCamera, fromLibrary, busy };
}
