import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

import { ErrorState, Skeleton, showToast } from '@/components/feedback';
import {
  KeyboardFlow,
  ScreenStatusBar,
  TitleBar,
  useKeyboardVisible,
} from '@/components/layout';
import { Button, Input, StepDots, Text } from '@/components/ui';
import { BaseLocationError } from '@/features/base-location/api/baseLocation';
import { useSaveBaseLocation } from '@/features/base-location/hooks/useSaveBaseLocation';
import { baseSetOnLabel, baseSummaryText } from '@/features/base-location/lib/baseSummary';
import { inIndia, round5 } from '@/features/base-location/lib/coords';
import { cleanPincode, isPincode } from '@/features/base-location/lib/pincode';
import { useMe } from '@/features/profile/hooks/useMe';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { errorText } from '@/i18n/errorText';
import { REGISTRATION_STEP_COUNT, stepNumber } from '@/store/registration.store';
import { color } from '@/theme/semantic';
import type { BaseLocation } from '@/types/domain';

/** Long enough for a cold GPS outdoors, short enough not to feel hung. */
const GPS_TIMEOUT_MS = 15_000;

/** Below this a fix is good enough to say nothing; above it, a warning. */
const ROUGH_FIX_M = 200;

/** Resolves to null rather than hanging forever — `CaptureScreen`'s own bound. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

const CARD = {
  backgroundColor: color.surfaceRaised,
  borderWidth: 1,
  borderColor: color.border,
  borderRadius: 16,
  padding: 18,
} as const;

const BODY = {
  fontFamily: 'Roboto_400Regular',
  fontSize: 13,
  lineHeight: 19,
  color: color.textLabel,
} as const;

type Option = 'pincode' | 'gps';

/** Where the phone is, as far as the bounded fix could tell. */
interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

type GpsState =
  | { status: 'idle' }
  | { status: 'finding' }
  | { status: 'found'; fix: Fix }
  | { status: 'denied' }
  | { status: 'failed' };

export interface BaseLocationScreenProps {
  /** The last onboarding step: step dots, no back chevron, a way to skip. */
  onboarding?: boolean;
}

/**
 * Profile → Base location, the Home card, and the last onboarding step.
 *
 * Travel allowance is measured from here to the customer, so this is where a
 * technician says where they start their day from — three ways: the pincode
 * they live in (its centre), where the phone is right now, or a pin dropped on
 * a map (the next screen). A base needs no approval; it applies to jobs
 * accepted from now on, which the screen says.
 *
 * Net-new copy — not in the prototype. See `RequirementDocs/franchisee/14`.
 */
export function BaseLocationScreen({ onboarding = false }: BaseLocationScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const save = useSaveBaseLocation();
  const navInset = useButtonNavInset();
  const keyboardUp = useKeyboardVisible();
  const bottomRoom = 40 + (keyboardUp ? 0 : navInset);

  const [pincode, setPincode] = useState('');
  const [gps, setGps] = useState<GpsState>({ status: 'idle' });
  // Which option's button was pressed, so a refusal lands under THAT option.
  const [pressed, setPressed] = useState<Option | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const home = () => router.replace('/(app)/(tabs)');
  const saved = () => {
    showToast(t('baseLocation.saved'));
    if (onboarding) home();
    else router.back();
  };

  const savePincode = () => {
    setPressed('pincode');
    save.mutate({ pincode }, { onSuccess: saved });
  };

  const saveGps = (fix: Fix) => {
    setPressed('gps');
    save.mutate(
      { latitude: round5(fix.latitude), longitude: round5(fix.longitude), source: 'gps' },
      { onSuccess: saved },
    );
  };

  const findMe = async () => {
    save.reset();
    setPressed(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!alive.current) return;
      if (!permission.granted) {
        setGps({ status: 'denied' });
        return;
      }
      setGps({ status: 'finding' });

      // A last-known fix first: indoors, `getCurrentPositionAsync` can sit for
      // a long time, and a position from the same street is better than none.
      // It is replaced below if a fresh one arrives.
      const last = await Location.getLastKnownPositionAsync();
      if (!alive.current) return;
      if (last) {
        setGps({
          status: 'found',
          fix: {
            latitude: last.coords.latitude,
            longitude: last.coords.longitude,
            accuracy: last.coords.accuracy ?? null,
          },
        });
      }

      // Bounded, or the line spins for ever indoors.
      const now = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        GPS_TIMEOUT_MS,
      );
      if (!alive.current) return;
      if (now) {
        setGps({
          status: 'found',
          fix: {
            latitude: now.coords.latitude,
            longitude: now.coords.longitude,
            accuracy: now.coords.accuracy ?? null,
          },
        });
      } else if (!last) {
        setGps({ status: 'failed' });
      }
    } catch {
      if (!alive.current) return;
      setGps((g) => (g.status === 'found' ? g : { status: 'failed' }));
    }
  };

  const openMap = () =>
    router.push(onboarding ? '/base-location/map?onboarding=1' : '/base-location/map');

  const base = me.data?.baseLocation;
  const pincodeError =
    save.error && pressed === 'pincode'
      ? save.error instanceof BaseLocationError &&
        save.error.code === 'PINCODE_OUTSIDE_FRANCHISEE'
        ? // Its own sentence, not the generic coverage one: that says nothing about pins.
          t('baseLocation.pincode.outside')
        : errorText(save.error, t('baseLocation.saveFailed'))
      : undefined;
  const gpsError =
    save.error && pressed === 'gps'
      ? errorText(save.error, t('baseLocation.saveFailed'))
      : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar
        title={t('baseLocation.title')}
        showBack={!onboarding}
        paddingBottom={14}
        right={
          onboarding ? (
            <View style={{ paddingRight: 8 }}>
              <StepDots total={REGISTRATION_STEP_COUNT} current={stepNumber('base')} />
            </View>
          ) : undefined
        }
      />

      {!me.data ? (
        me.isError ? (
          <ErrorState onRetry={() => me.refetch()} />
        ) : (
          <View style={{ padding: 16, gap: 12 }}>
            <Skeleton width="100%" height={110} rounded={16} />
            <Skeleton width="100%" height={150} rounded={16} />
          </View>
        )
      ) : (
        <KeyboardFlow>
          <View style={{ padding: 16, paddingBottom: bottomRoom, gap: 14 }}>
            {onboarding ? (
              <View style={{ paddingHorizontal: 4 }}>
                <Text
                  style={{
                    fontFamily: 'Roboto_900Black',
                    fontSize: 22,
                    letterSpacing: -0.4,
                    color: color.textPrimary,
                  }}
                >
                  {t('baseLocation.onboarding.title')}
                </Text>
                <Text style={[BODY, { marginTop: 8 }]}>{t('baseLocation.onboarding.body')}</Text>
              </View>
            ) : (
              <Text style={[BODY, { paddingHorizontal: 4 }]}>{t('baseLocation.intro')}</Text>
            )}

            {/* `undefined` is an API that predates the field — nothing to show.
                `null` is "none yet", which is only worth a card outside onboarding. */}
            {base ? (
              <CurrentBase base={base} />
            ) : base === null && !onboarding ? (
              <View style={[CARD, { backgroundColor: color.slotBg, borderColor: color.slotBg }]}>
                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.slotFg,
                  }}
                >
                  {t('baseLocation.current.none')}
                </Text>
              </View>
            ) : null}

            {/* 1 — the pincode they live in. */}
            <View style={CARD}>
              <Input
                label={t('baseLocation.pincode.title')}
                value={pincode}
                onChangeText={(text) => {
                  setPincode(cleanPincode(text));
                  if (pressed === 'pincode') save.reset();
                }}
                placeholder={t('baseLocation.pincode.placeholder')}
                keyboardType="number-pad"
                maxLength={6}
                editable={!save.isPending}
                error={pincodeError}
              />
              <Text style={[BODY, { marginTop: 10, marginBottom: 14 }]}>
                {t('baseLocation.pincode.body')}
              </Text>
              <Button
                label={t('baseLocation.pincode.use', { pincode })}
                loading={save.isPending && pressed === 'pincode'}
                disabled={!isPincode(pincode) || save.isPending}
                disabledHint={isPincode(pincode) ? undefined : t('baseLocation.pincode.typeSix')}
                onPress={savePincode}
              />
            </View>

            {/* 2 — where the phone is right now. */}
            <View style={CARD}>
              <Text style={[BODY, { marginBottom: 14 }]}>{t('baseLocation.gps.body')}</Text>
              <Button
                label={t('baseLocation.gps.title')}
                variant="outline"
                leadingIcon="navigation"
                loading={gps.status === 'finding' && !save.isPending}
                disabled={save.isPending}
                onPress={findMe}
              />
              <GpsResult
                gps={gps}
                saving={save.isPending && pressed === 'gps'}
                error={gpsError}
                onSave={saveGps}
              />
            </View>

            {/* 3 — a pin on the map, on its own screen. */}
            <View style={CARD}>
              <Text style={[BODY, { marginBottom: 14 }]}>{t('baseLocation.map.body')}</Text>
              <Button
                label={t('baseLocation.map.title')}
                variant="outline"
                leadingIcon="geo"
                disabled={save.isPending}
                onPress={openMap}
              />
            </View>

            {onboarding ? (
              <Button
                label={t('baseLocation.onboarding.skip')}
                variant="ghost"
                onPress={home}
                disabled={save.isPending}
              />
            ) : null}
          </View>
        </KeyboardFlow>
      )}
    </View>
  );
}

function CurrentBase({ base }: { base: BaseLocation }) {
  const { t } = useTranslation();
  return (
    <View style={CARD}>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 11.5,
          letterSpacing: 0.4,
          color: color.textMuted,
        }}
      >
        {t('baseLocation.current.label')}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_700Bold',
          fontSize: 16,
          color: color.textPrimary,
          marginTop: 6,
        }}
      >
        {baseSummaryText(base)}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 12.5,
          color: color.textSecondary,
          marginTop: 2,
        }}
      >
        {baseSetOnLabel(base)}
      </Text>
      <Text style={[BODY, { marginTop: 12 }]}>{t('baseLocation.changeNote')}</Text>
    </View>
  );
}

/** Whatever follows the "Use my current location" button. */
function GpsResult({
  gps,
  saving,
  error,
  onSave,
}: {
  gps: GpsState;
  saving: boolean;
  error: string | undefined;
  onSave: (fix: Fix) => void;
}) {
  const { t } = useTranslation();

  const line = (text: string, tone: 'plain' | 'warn' | 'danger' = 'plain') => (
    <Text
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={{
        fontFamily: 'Roboto_500Medium',
        fontSize: 12.5,
        lineHeight: 18,
        marginTop: 12,
        color:
          tone === 'danger'
            ? color.textDanger
            : tone === 'warn'
              ? color.slotFg
              : color.textLabel,
      }}
    >
      {text}
    </Text>
  );

  if (gps.status === 'finding') return line(t('baseLocation.gps.finding'));
  if (gps.status === 'failed') return line(t('baseLocation.gps.failed'), 'danger');
  if (gps.status === 'denied') {
    return (
      <View>
        {line(t('baseLocation.gps.denied'), 'danger')}
        <Pressable
          onPress={() => void Linking.openSettings()}
          accessibilityRole="link"
          style={{ alignSelf: 'flex-start', marginTop: 8 }}
        >
          <Text
            style={{ fontFamily: 'Roboto_500Medium', fontSize: 12.5, color: color.textLink }}
          >
            {t('baseLocation.gps.openSettings')}
          </Text>
        </Pressable>
      </View>
    );
  }
  if (gps.status !== 'found') return null;

  const { fix } = gps;
  const outside = !inIndia(fix.latitude, fix.longitude);
  const accuracy =
    fix.accuracy != null ? t('units.accuracy', { value: Math.round(fix.accuracy) }) : '—';

  return (
    <View>
      {line(t('baseLocation.gps.found', { accuracy }))}
      {fix.accuracy != null && fix.accuracy > ROUGH_FIX_M
        ? line(t('baseLocation.gps.rough'), 'warn')
        : null}
      {outside ? line(t('errors.code.BASE_OUTSIDE_INDIA'), 'danger') : null}
      {error ? line(error, 'danger') : null}
      <View style={{ marginTop: 14 }}>
        <Button
          label={t('baseLocation.gps.save')}
          loading={saving}
          disabled={outside}
          onPress={() => onSave(fix)}
        />
      </View>
    </View>
  );
}
