import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Skeleton, showToast } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { INDIA_CENTRE, inIndia } from '@/features/base-location/lib/coords';
import { buildMapHtml } from '@/features/base-location/map/mapHtml';
import { parseMapMessage, type MapMessage } from '@/features/base-location/map/mapMessage';
import { originOf } from '@/features/base-location/map/origin';
import { useSaveBaseLocation } from '@/features/base-location/hooks/useSaveBaseLocation';
import { useMe } from '@/features/profile/hooks/useMe';
import { errorText } from '@/i18n/errorText';
import { API_BASE_URL } from '@/lib/api';
import { color } from '@/theme/semantic';

/** No `ready` from the page by then and the map is called failed. */
const READY_TIMEOUT_MS = 10_000;

/** Where the pin starts. `real` is false for the middle-of-India fallback. */
interface Start {
  lat: number;
  lng: number;
  zoom: number;
  real: boolean;
}

const FALLBACK_START: Start = { ...INDIA_CENTRE, real: false };

/**
 * The origin the page is "served" from, which gives OpenStreetMap a Referer —
 * its tile policy asks for one. The API's own origin: this app has no website
 * of its own to claim.
 */
const API_ORIGIN = originOf(API_BASE_URL);

/**
 * `https://*` alone refuses the page itself when a dev build's API is plain
 * http on a LAN address, so that one origin is allowed as well. Production is
 * https and gets exactly `https://*`.
 */
const ORIGIN_WHITELIST =
  API_ORIGIN && !API_ORIGIN.startsWith('https://')
    ? ['https://*', `${API_ORIGIN}/*`]
    : ['https://*'];

type Phase = 'loading' | 'ready' | 'failed';

export interface BaseMapScreenProps {
  onboarding?: boolean;
}

/**
 * Drop a pin on an OpenStreetMap map — for a technician who lives outside
 * their franchisee's area, or whose pincode is not accepted.
 *
 * Leaflet inside a WebView (the one native module this feature adds). The page
 * is built ONCE from the starting point: changing `source.html` reloads
 * Leaflet and every tile, so later moves come from the page by `postMessage`,
 * never from React. Every message is untrusted and goes through
 * `parseMapMessage`.
 *
 * This screen never asks for location. It starts at the saved base, else at a
 * last-known fix the phone already allows us, else at the middle of India —
 * only the explicit "Use my current location" button on the previous screen
 * prompts.
 */
export function BaseMapScreen({ onboarding = false }: BaseMapScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const save = useSaveBaseLocation();

  const [start, setStart] = useState<Start | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [tilesFailed, setTilesFailed] = useState(false);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  // The page announces its starting point as a first `moved`. With no real
  // start that is just the middle of India — not a choice, so it is skipped
  // and Save waits for the technician's own tap or drag.
  const firstMove = useRef(true);

  // Work out where to open, once. `me` may refetch under us; the first answer
  // wins (`prev ?? next`) so the page is never rebuilt when it does.
  useEffect(() => {
    if (start) return;
    const base = me.data?.baseLocation;
    if (base) {
      setStart((prev) => prev ?? { lat: base.latitude, lng: base.longitude, zoom: 16, real: true });
      return;
    }
    // Wait for `me` rather than guessing: an old base is the better start.
    if (!me.data && !me.isError) return;

    let cancelled = false;
    void (async () => {
      let next: Start = FALLBACK_START;
      try {
        // Reads the permission; never asks for it.
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.granted) {
          const last = await Location.getLastKnownPositionAsync();
          if (last && inIndia(last.coords.latitude, last.coords.longitude)) {
            next = {
              lat: last.coords.latitude,
              lng: last.coords.longitude,
              zoom: 15,
              real: true,
            };
          }
        }
      } catch {
        // Fall through to the country view.
      }
      if (!cancelled) setStart((prev) => prev ?? next);
    })();
    return () => {
      cancelled = true;
    };
  }, [start, me.data, me.isError]);

  // Colours come from the theme; the page has no hex of its own.
  const html = useMemo(
    () =>
      start
        ? buildMapHtml({
            lat: start.lat,
            lng: start.lng,
            zoom: start.zoom,
            pinColor: color.actionBg,
            ringColor: color.surfaceRaised,
          })
        : null,
    [start],
  );

  // A page that never says `ready` is a failed map, not a long wait.
  useEffect(() => {
    if (!html || phase !== 'loading') return;
    const timer = setTimeout(() => setPhase('failed'), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [html, phase, attempt]);

  const handle = useCallback(
    (message: MapMessage | null) => {
      if (!message) return;
      if (message.type === 'ready') {
        setPhase((p) => (p === 'failed' ? p : 'ready'));
      } else if (message.type === 'moved') {
        if (firstMove.current) {
          firstMove.current = false;
          if (!start?.real) return;
        }
        setPoint({ lat: message.lat, lng: message.lng });
      } else if (message.reason === 'leaflet') {
        setPhase('failed');
      } else {
        setTilesFailed(true);
      }
    },
    [start],
  );

  const retry = () => {
    firstMove.current = true;
    setPoint(null);
    setTilesFailed(false);
    setPhase('loading');
    setAttempt((a) => a + 1);
  };

  const saved = () => {
    showToast(t('baseLocation.saved'));
    if (onboarding) router.replace('/(app)/(tabs)');
    else router.back();
  };

  const outside = point != null && !inIndia(point.lat, point.lng);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('baseLocation.map.title')} paddingBottom={14} />

      {phase === 'failed' ? (
        <MapFailed onRetry={retry} onUseLocation={() => router.back()} />
      ) : (
        <View style={{ flex: 1 }}>
          {html ? (
            <WebView
              key={attempt}
              source={API_ORIGIN ? { html, baseUrl: API_ORIGIN } : { html }}
              originWhitelist={ORIGIN_WHITELIST}
              onMessage={(event: WebViewMessageEvent) =>
                handle(parseMapMessage(event.nativeEvent.data))
              }
              onShouldStartLoadWithRequest={(request) => {
                // The attribution link, or anything else, opens outside.
                if (
                  request.url === 'about:blank' ||
                  (API_ORIGIN && request.url.startsWith(API_ORIGIN))
                ) {
                  return true;
                }
                void Linking.openURL(request.url);
                return false;
              }}
              onError={() => setPhase('failed')}
              onHttpError={() => setPhase('failed')}
              // OpenStreetMap asks apps to identify themselves. A brand-neutral
              // identifier, never shown to a person (the product is white-label).
              applicationNameForUserAgent="FieldTechnicianApp"
              javaScriptEnabled
              domStorageEnabled={false}
              allowFileAccess={false}
              setSupportMultipleWindows={false}
              mixedContentMode="never"
              cacheEnabled
              style={{ flex: 1 }}
            />
          ) : null}

          {phase === 'loading' ? (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: color.surface,
                padding: 16,
                gap: 12,
              }}
            >
              <Skeleton width="100%" height={260} rounded={16} />
              <Text
                style={{
                  fontFamily: 'Roboto_500Medium',
                  fontSize: 13,
                  color: color.textSecondary,
                  textAlign: 'center',
                }}
              >
                {t('baseLocation.map.loading')}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {phase === 'ready' ? (
        <View
          style={{
            backgroundColor: color.surfaceRaised,
            borderTopWidth: 1,
            borderTopColor: color.border,
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: insets.bottom + 16,
            gap: 10,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              lineHeight: 19,
              color: color.textLabel,
            }}
          >
            {t('baseLocation.map.hint')}
          </Text>
          {point ? (
            <Text
              selectable
              style={{
                fontFamily: 'RobotoMono_400Regular',
                fontSize: 13,
                color: color.textPrimary,
              }}
            >
              {`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
            </Text>
          ) : null}
          {tilesFailed ? (
            <Text
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 12.5,
                lineHeight: 18,
                color: color.slotFg,
              }}
            >
              {t('baseLocation.map.tilesFailed')}
            </Text>
          ) : null}
          {save.error ? (
            <Text
              accessibilityRole="alert"
              style={{
                fontFamily: 'Roboto_500Medium',
                fontSize: 12.5,
                lineHeight: 18,
                color: color.textDanger,
              }}
            >
              {errorText(save.error, t('baseLocation.saveFailed'))}
            </Text>
          ) : null}
          <Button
            label={t('baseLocation.map.save')}
            loading={save.isPending}
            disabled={!point || outside}
            disabledHint={outside ? t('baseLocation.map.outside') : undefined}
            onPress={() => {
              if (!point) return;
              save.mutate(
                { latitude: point.lat, longitude: point.lng, source: 'map' },
                { onSuccess: saved },
              );
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The map could not load: say so, and offer the way back and the other options. */
function MapFailed({
  onRetry,
  onUseLocation,
}: {
  onRetry: () => void;
  onUseLocation: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: color.statusCancelled.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Icon name="warn" size={26} color={color.debit} />
      </View>
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textPrimary }}>
        {t('baseLocation.map.failedTitle')}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 13,
          lineHeight: 19,
          color: color.textSecondary,
          textAlign: 'center',
          marginTop: 6,
        }}
      >
        {t('baseLocation.map.failedBody')}
      </Text>
      <View style={{ marginTop: 20, alignSelf: 'stretch', gap: 10 }}>
        <Button label={t('common.tryAgain')} variant="secondary" onPress={onRetry} />
        <Button
          label={t('baseLocation.map.useLocation')}
          variant="outline"
          leadingIcon="navigation"
          onPress={onUseLocation}
        />
      </View>
    </View>
  );
}
