import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View className="flex-1 items-center justify-center bg-neutral-150 px-5">
        <Text className="font-black text-[20px] text-neutral-900">Screen not found</Text>
        <Text className="mt-2 text-center text-[14px] text-neutral-500">
          That link doesn&apos;t point anywhere in the app.
        </Text>
        <Link href="/" className="mt-6 text-[14px] font-medium text-primary-500">
          Go to start
        </Link>
      </View>
    </>
  );
}
