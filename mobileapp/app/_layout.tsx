import '../global.css';

import {
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_700Bold,
  Roboto_900Black,
  useFonts,
} from '@expo-google-fonts/roboto';
import { RobotoMono_400Regular, RobotoMono_700Bold } from '@expo-google-fonts/roboto-mono';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSession } from '@/store/session.store';
import { color } from '@/theme/semantic';

/**
 * The boot route, pinned.
 *
 * Expo Router picks a navigator's initial route from the first declared screen
 * when children are given explicitly. Declaring the photo modals first made the
 * app open the avatar picker on launch, ahead of the login screen. This states
 * the intent so route order cannot decide it silently again.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — safe to ignore */
});

/**
 * The pool, auth and onboarding are real; the rest is still mock. `retry: false`
 * stays because a field technician on a bad connection is better served by an
 * immediate error they can act on than by three silent retries.
 *
 * `refetchOnWindowFocus` stays OFF as the default and is turned on per query —
 * today only by `usePool`. Most of what this app reads does not change while
 * somebody is looking at it, and refetching all of it on every app switch would
 * spend a field technician's data for nothing.
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

/**
 * Teach TanStack Query what "focused" means on a phone.
 *
 * React Native has no window, so `refetchOnWindowFocus` is inert until
 * something drives `focusManager` — without this it is a prop that reads as
 * working and does nothing. `AppState` is that something: coming back from the
 * lock screen or the app switcher marks every query stale and refetches it.
 *
 * This is what makes "no refresh needed" true in the case that matters most.
 * A technician who pockets their phone for ten minutes and reopens it wants the
 * pool as it is NOW, not as it was, and not in twenty seconds' time when the
 * next poll lands.
 */
function useAppStateFocus() {
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      // `inactive` is the iOS half-state during an app switch or an incoming
      // call. Treated as still focused: it is not backgrounded, and flipping
      // focus off and on again would fire a refetch every time the app switcher
      // is opened.
      focusManager.setFocused(state !== 'background');
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const hydrated = useSession((s) => s.hydrated);

  useAppStateFocus();

  const [fontsLoaded, fontError] = useFonts({
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_700Bold,
    Roboto_900Black,
    // Fixed-width digits for pincode chips — a column of six-digit codes is
    // far easier to scan when the digits line up.
    RobotoMono_400Regular,
    RobotoMono_700Bold,
  });

  const ready = (fontsLoaded || fontError) && hydrated;

  useEffect(() => {
    // Hide the splash on font error too, otherwise a font CDN failure leaves
    // the user staring at a splash screen forever.
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  /**
   * The splash covers session rehydration as well as fonts.
   *
   * SecureStore is async, so on the first frame the token is null whatever the
   * truth is. Rendering the router before it resolves would send a signed-in
   * technician to the login screen and then snap them back — holding the splash
   * instead is why there is no loading screen in the boot path.
   *
   * Traced because a stall here is invisible: the app just sits on the splash
   * with nothing in the console. `session.store` has a 3s failsafe so this can
   * never hang forever, but the trace says WHICH half was slow.
   */
  if (!ready) {
    if (__DEV__) {
      console.log(
        `[boot] waiting — fonts=${fontsLoaded || !!fontError} session=${hydrated}`,
      );
    }
    return null;
  }
  if (__DEV__) console.log('[boot] ready — rendering router');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* Default to DARK status-bar content: most screens are light pages,
              and white-on-white hides the clock, wifi and battery entirely.
              Dark-chrome screens override this with style="light". */}
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.surface },
            }}
          >
            {/* ORDER IS LOAD-BEARING. The first declared screen becomes the
                navigator's initial route, so `index` has to come first — with
                the photo modals first the app opened the picker at launch,
                before anyone had signed in. `unstable_settings` above pins it
                too; both are here because either alone is easy to undo by
                accident. */}
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />

            {/* The photo modals live at the root, not under `(app)`, because a
                technician registering from an invite link takes their profile
                photo before they have a session. */}
            <Stack.Screen
              name="avatar-options"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                // `screenOptions.contentStyle` above paints an OPAQUE surface on
                // EVERY route. `transparentModal` only makes the native container
                // transparent — that background is still drawn on top of it, so
                // Profile vanished behind a flat slab and the sheet's scrim dimmed
                // surface colour instead of the screen. Transparent here is what
                // lets the scrim dim what is actually behind it.
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen
              name="crop-photo"
              options={{ presentation: 'fullScreenModal' }}
            />
            <Stack.Screen
              name="view-photo"
              options={{ presentation: 'fullScreenModal' }}
            />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
