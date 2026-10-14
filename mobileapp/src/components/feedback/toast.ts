import { Alert, Platform, ToastAndroid } from 'react-native';

/**
 * A short "that worked" message that needs no answer.
 *
 * Android's own toast — core React Native, no new native module — because it
 * outlives the screen that raised it: a pass confirms and goes back to the
 * pool in the same moment, and the message has to land on the pool, not
 * vanish with the offer.
 *
 * iOS has no toast. This app ships through Google Play only, so a plain alert
 * is the fallback rather than something worth building a component for — it
 * is never silently dropped.
 *
 * Pass a translated string: this shows exactly what it is given.
 */
export function showToast(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(message);
}
