import { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { color } from '@/theme/semantic';
import { radius } from '@/theme/spacing';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
}

export function Skeleton({ width = '100%', height = 16, rounded = radius.sm }: SkeletonProps) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.9, { duration: 800 }), -1, true);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: rounded, backgroundColor: color.surfaceSunken },
        style,
      ]}
    />
  );
}

/** Placeholder shaped like a job card — used by the pool and My jobs lists. */
export function JobCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: color.surfaceRaised,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.border,
        padding: 16,
        marginBottom: 12,
        gap: 10,
      }}
    >
      <Skeleton width={90} height={20} rounded={radius.full} />
      <Skeleton width="70%" height={16} />
      <Skeleton width="45%" height={13} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Skeleton width={110} height={13} />
        <Skeleton width={60} height={13} />
      </View>
    </View>
  );
}
