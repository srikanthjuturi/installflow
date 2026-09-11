import { useLocalSearchParams } from 'expo-router';

import { RedemptionScreen } from '@/features/redeem/screens/RedemptionScreen';

/** One redemption — its QR while unpaid, then the payer's proof and the confirm. */
export default function RedemptionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <RedemptionScreen id={id} />;
}
