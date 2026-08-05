import { useLocalSearchParams } from 'expo-router';

import { CropScreen } from '@/features/profile/screens/CropScreen';

/** Square crop for the profile photo. Ours, not the platform's — see CropScreen. */
export default function CropPhotoRoute() {
  const { uri, width, height } = useLocalSearchParams<{
    uri: string;
    width: string;
    height: string;
  }>();

  return <CropScreen uri={uri} width={Number(width)} height={Number(height)} />;
}
