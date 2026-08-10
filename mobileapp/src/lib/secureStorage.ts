import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand persistence backed by the Keychain (iOS) / Keystore (Android).
 *
 * A session token in plain storage is readable by anything with filesystem
 * access on a rooted device, and this token accepts jobs and moves money.
 *
 * SecureStore has no web implementation and `npm run web` exists as a
 * development surface, so the web branch falls back to `localStorage` — which
 * is NOT secure and is fine only because nobody signs into the web build with a
 * real technician account.
 *
 * SecureStore warns above 2048 bytes per value on Android; the session payload
 * is a few hundred.
 */
export const secureStorage: StateStorage = {
  getItem: async (name) => {
    if (Platform.OS === 'web') {
      return globalThis.localStorage?.getItem(name) ?? null;
    }
    try {
      return await SecureStore.getItemAsync(name);
    } catch {
      // A corrupt or unreadable entry must read as "signed out", never crash
      // the boot sequence — the splash is held until this resolves.
      return null;
    }
  },
  setItem: async (name, value) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(name, value);
      return;
    }
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(name);
      return;
    }
    await SecureStore.deleteItemAsync(name);
  },
};
