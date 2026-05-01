import { createClient, Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { isScreenshotSeedEnabled } from './appMode';

// Get environment variables
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://demo.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'demo-anon-key';

if ((!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) && !isScreenshotSeedEnabled) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// Safely check if we're in a web environment with localStorage available
const isWebWithLocalStorage = () =>
  Platform.OS === 'web' && typeof localStorage !== 'undefined';

const getNativeStorage = () => SecureStore;

// Custom storage adapter for Expo SecureStore
const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      if (isWebWithLocalStorage()) {
        return localStorage.getItem(key);
      }
      return await getNativeStorage().getItemAsync(key);
    } catch (error) {
      console.error('Error getting item from secure store:', error);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      if (isWebWithLocalStorage()) {
        localStorage.setItem(key, value);
      } else {
        await getNativeStorage().setItemAsync(key, value);
      }
    } catch (error) {
      console.error('Error setting item in secure store:', error);
    }
  },
  removeItem: async (key: string) => {
    try {
      if (isWebWithLocalStorage()) {
        localStorage.removeItem(key);
      } else {
        await getNativeStorage().deleteItemAsync(key);
      }
    } catch (error) {
      console.error('Error removing item from secure store:', error);
    }
  },
};

const ACCESS_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const SESSION_REFRESH_BUFFER_SECONDS = 60;

let sessionRefreshPromise: Promise<Session | null> | null = null;

// Create Supabase client with custom storage
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Race a promise against a timeout; resolves to fallback on timeout */
const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

// Helper to get current session (validates and refreshes if needed)
export const getSession = async () => {
  try {
    const result = await withTimeout(
      supabase.auth.getSession(),
      8000,
      { data: { session: null }, error: null as any },
    );
    if (result.error) {
      console.error('❌ Error getting session:', result.error);
      return null;
    }
    return result.data.session;
  } catch (error) {
    console.error('❌ Exception getting session:', error);
    return null;
  }
};

const isSessionExpiringSoon = (session: Session | null): boolean => {
  if (!session?.expires_at) {
    return false;
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  return session.expires_at - nowInSeconds < SESSION_REFRESH_BUFFER_SECONDS;
};

export const refreshAuthSession = async (): Promise<Session | null> => {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = (async () => {
      try {
        const result = await withTimeout(
          supabase.auth.refreshSession(),
          10000,
          { data: { session: null, user: null }, error: null as any },
        );

        if (result.error || !result.data.session) {
          console.error('❌ Error refreshing session:', result.error);
          // DON'T sign out or clear tokens here — the session might still
          // be valid for direct Supabase calls and the stored token may
          // work on the next attempt (e.g. backend cold-start resolved).
          return null;
        }

        await storeSessionTokens(result.data.session);
        return result.data.session;
      } catch (error) {
        console.error('❌ Exception refreshing session:', error);
        // DON'T nuke the session — just return null so the caller can
        // decide what to do (e.g. try stored token fallback).
        return null;
      }
    })().finally(() => {
      sessionRefreshPromise = null;
    });
  }

  return sessionRefreshPromise;
};

export const getValidSession = async (): Promise<Session | null> => {
  const session = await getSession();

  if (!session) {
    return null;
  }

  if (isSessionExpiringSoon(session)) {
    const refreshedSession = await refreshAuthSession();
    if (refreshedSession) {
      return refreshedSession;
    }
    // Refresh failed — don't return the expired/stale session
    return null;
  }

  await storeSessionTokens(session);
  return session;
};

// Helper to get access token, refreshing if expired
export const getAccessToken = async (): Promise<string | null> => {
  const session = await getValidSession();

  if (session?.access_token) {
    return session.access_token;
  }

  return getStoredAccessToken();
};

export const storeSessionTokens = async (session: Session | null): Promise<void> => {
  try {
    if (!session?.access_token) return;
    if (isWebWithLocalStorage()) {
      localStorage.setItem(ACCESS_TOKEN_KEY, session.access_token);
      if (session.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
      }
    } else {
      await getNativeStorage().setItemAsync(ACCESS_TOKEN_KEY, session.access_token);
      if (session.refresh_token) {
        await getNativeStorage().setItemAsync(REFRESH_TOKEN_KEY, session.refresh_token);
      }
    }
  } catch (error) {
    console.error('Error persisting session tokens:', error);
  }
};

export const getStoredAccessToken = async (): Promise<string | null> => {
  try {
    if (isWebWithLocalStorage()) {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    }
    return await getNativeStorage().getItemAsync(ACCESS_TOKEN_KEY);
  } catch (error) {
    console.error('Error reading stored access token:', error);
    return null;
  }
};

export const clearStoredTokens = async (): Promise<void> => {
  try {
    if (isWebWithLocalStorage()) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } else {
      await getNativeStorage().deleteItemAsync(ACCESS_TOKEN_KEY);
      await getNativeStorage().deleteItemAsync(REFRESH_TOKEN_KEY);
    }
  } catch (error) {
    console.error('Error clearing stored tokens:', error);
  }
};
