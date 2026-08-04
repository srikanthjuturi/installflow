import { useLocalSearchParams } from 'expo-router';

import { CaptureScreen } from '@/features/proof/screens/CaptureScreen';

/** Screens 9-12 — barcode, serial, product photos, geo-tagged live photo. */
export default function CaptureRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <CaptureScreen jobId={id} />;
}
