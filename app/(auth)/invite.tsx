import { useState } from 'react';
import { Text, View } from 'react-native';

import { EmptyState, JobCardSkeleton } from '@/components/feedback';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Header, Screen } from '@/components/layout';
import { Button, Card, Input, StatusBadge, Switch } from '@/components/ui';
import { color } from '@/theme/semantic';
import { formatSignedPaise } from '@/utils/money';

/**
 * SCAFFOLD GALLERY — replaced by the real R1 invite screen in the next commit.
 * It renders every base component so the design system can be checked on a
 * real device before any screen depends on it.
 */

const ICONS: IconName[] = [
  'home',
  'jobs',
  'wallet',
  'user',
  'barcode',
  'serial',
  'photos',
  'geo',
  'bell',
  'globe',
  'gift',
  'card',
  'warn',
  'tv',
  'washer',
  'fridge',
  'ac',
  'micro',
  'purifier',
  'plus',
  'minus',
  'chevronLeft',
];

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: 'Roboto_700Bold',
        fontSize: 11,
        letterSpacing: 1.4,
        color: color.textSecondary,
        marginTop: 24,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

export default function ComponentGallery() {
  const [online, setOnline] = useState(true);
  const [pincode, setPincode] = useState('');

  return (
    <>
      <Header
        eyebrow="scaffold check"
        title="Design system"
        subtitle="Every base component, rendered on device. Replaced by the invite screen next."
        tone="chrome"
        showBack={false}
      />

      <Screen variant="chrome">
        <SectionLabel>BUTTONS</SectionLabel>
        <View style={{ gap: 12 }}>
          <Button label="Accept job" onPress={() => {}} />
          <Button label="Pass" variant="secondary" onPress={() => {}} />
          <Button label="Cancel this job" variant="destructive" onPress={() => {}} />
          <Button label="Continue" disabled disabledHint="Select at least one category" />
        </View>

        <SectionLabel>STATUS BADGES</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <StatusBadge status="upcoming" hoursToSlot={20} />
            <StatusBadge status="upcoming" hoursToSlot={3} />
            <StatusBadge status="inprogress" hoursToSlot={1} />
            <StatusBadge status="completed" hoursToSlot={-24} />
            <StatusBadge status="cancelled" hoursToSlot={-2} />
          </View>
        </Card>

        <SectionLabel>COMMITTED SLOT &amp; MONEY</SectionLabel>
        <Card>
          <View
            style={{
              backgroundColor: color.slotBg,
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 11, color: color.slotFg }}>
              COMMITTED SLOT
            </Text>
            <Text
              style={{
                fontFamily: 'Roboto_900Black',
                fontSize: 17,
                color: color.slotFg,
                marginTop: 2,
              }}
            >
              Today · 2:00–4:00 PM
            </Text>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: 'Roboto_500Medium', fontSize: 14, color: color.credit }}>
              {formatSignedPaise(46000)}
            </Text>
            <Text style={{ fontFamily: 'Roboto_500Medium', fontSize: 14, color: color.bonus }}>
              {formatSignedPaise(12000)}
            </Text>
            <Text style={{ fontFamily: 'Roboto_500Medium', fontSize: 14, color: color.debit }}>
              {formatSignedPaise(-15000)}
            </Text>
            <Text
              style={{ fontFamily: 'Roboto_900Black', fontSize: 14, color: color.textPrimary }}
            >
              {formatSignedPaise(175000)}
            </Text>
          </View>
        </Card>

        <SectionLabel>INPUT &amp; SWITCH</SectionLabel>
        <Card>
          <Input
            label="Pincode"
            value={pincode}
            onChangeText={(v) => setPincode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="400067"
            keyboardType="number-pad"
            maxLength={6}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
            }}
          >
            <Text
              style={{ fontFamily: 'Roboto_500Medium', fontSize: 14, color: color.textPrimary }}
            >
              {online ? "You're online" : "You're offline"}
            </Text>
            <Switch
              value={online}
              onValueChange={setOnline}
              activeColor={color.online}
              accessibilityLabel="Availability"
            />
          </View>
        </Card>

        <SectionLabel>ICONS (22)</SectionLabel>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            {ICONS.map((name) => (
              <Icon key={name} name={name} size={24} color={color.textSecondary} />
            ))}
          </View>
        </Card>

        <SectionLabel>LOADING</SectionLabel>
        <JobCardSkeleton />

        <SectionLabel>EMPTY</SectionLabel>
        <Card padded={false}>
          <EmptyState
            title="Pool is empty"
            body="You've taken every open job nearby."
            icon="jobs"
          />
        </Card>
      </Screen>
    </>
  );
}
