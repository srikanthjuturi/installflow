import {
  CameraView,
  scanFromURLAsync,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui';
import { parseUpiQr, type ScannedUpi } from '@/features/payout/lib/parseUpiQr';
import { color } from '@/theme/semantic';

export interface UpiScannerProps {
  visible: boolean;
  onClose: () => void;
  /** A payment QR was read. The caller fills the field — and must NOT tick
   *  the confirmation for them: a scan can read the wrong QR. */
  onScanned: (result: ScannedUpi) => void;
}

/**
 * Read a UPI ID off the QR the technician's bank or UPI app already gave them.
 *
 * Two ways in, because most people do not have the QR in front of them — they
 * have a screenshot, forwarded on WhatsApp. A live camera cannot read a still
 * image, so **From a screenshot** decodes one from the gallery
 * (`scanFromURLAsync`). The gallery ban in this app is on PROOF photos; this is
 * reading an address, and nothing picked here is uploaded anywhere.
 *
 * A code that is not a payment QR — a WiFi code, a parcel label — says so and
 * keeps scanning, rather than filling the field with nonsense or closing.
 *
 * A modal over the Payout account screen rather than a route of its own, so
 * the result lands straight in that screen's draft with no store or params to
 * carry it back through.
 */
export function UpiScanner({ visible, onClose, onScanned }: UpiScannerProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [notUpi, setNotUpi] = useState(false);
  const [busy, setBusy] = useState(false);

  // `onBarcodeScanned` fires on every frame the code stays in view. One read
  // is one decision — the ref stops a second frame re-entering it.
  const done = useRef(false);
  // The last payload refused, so a non-payment QR held in frame does not
  // re-run the parse thirty times a second.
  const refused = useRef<string | null>(null);

  useEffect(() => {
    if (visible) {
      done.current = false;
      refused.current = null;
      setNotUpi(false);
    }
  }, [visible]);

  const accept = useCallback(
    (data: string | null | undefined) => {
      if (done.current) return true;
      const result = parseUpiQr(data);
      if (!result) return false;
      done.current = true;
      onScanned(result);
      return true;
    },
    [onScanned],
  );

  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (done.current || data === refused.current) return;
      if (!accept(data)) {
        refused.current = data;
        setNotUpi(true);
      }
    },
    [accept],
  );

  const fromScreenshot = async () => {
    setBusy(true);
    try {
      // No permission request: Android 13+ and iOS 14+ hand over a picked file
      // through the system picker without one.
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      const found = await scanFromURLAsync(asset.uri, ['qr']);
      if (!found.some((r) => accept(r.data))) setNotUpi(true);
    } catch {
      setNotUpi(true);
    } finally {
      setBusy(false);
    }
  };

  const granted = permission?.granted ?? false;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="fullScreen"
    >
      <View style={{ flex: 1, backgroundColor: color.cameraBg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingTop: insets.top + 10,
            paddingHorizontal: 16,
            paddingBottom: 12,
          }}
        >
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            {({ pressed }) => (
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  backgroundColor: color.cameraTopControl,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                }}
              >
                <Icon name="close" size={20} color={color.textInverse} />
              </View>
            )}
          </Pressable>
          <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textInverse }}>
            Scan my UPI QR
          </Text>
        </View>

        <View style={{ flex: 1, overflow: 'hidden' }}>
          {granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={visible ? onBarcodeScanned : undefined}
            >
              {/* The square to aim at. A guide, not a crop — the whole frame
                  is decoded, so a code outside it still reads. */}
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 240,
                    height: 240,
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: color.cameraGuide,
                  }}
                />
              </View>
            </CameraView>
          ) : permission ? (
            <View
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
            >
              <Icon name="cameraOff" size={40} color={color.cameraHint} />
              <Text
                style={{
                  fontFamily: 'Roboto_700Bold',
                  fontSize: 17,
                  color: color.textInverse,
                  marginTop: 14,
                  marginBottom: 18,
                }}
              >
                Camera access needed
              </Text>
              <View style={{ alignSelf: 'stretch' }}>
                <Button label="Allow camera" onPress={requestPermission} />
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 12 }}>
          {notUpi ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 13.5,
                color: color.cameraHint,
                textAlign: 'center',
              }}
            >
              That&apos;s not a UPI payment QR. Try another.
            </Text>
          ) : null}
          <Button
            label="From a screenshot"
            variant="secondary"
            leadingIcon="photos"
            loading={busy}
            onPress={fromScreenshot}
          />
        </View>
      </View>
    </Modal>
  );
}
