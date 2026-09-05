import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ??
  '';
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined) ??
  '';

const configured = Boolean(url && anonKey);

/**
 * If env is missing, return a stub client that fails politely on any call
 * instead of throwing at construction. The app still renders — it just
 * shows bundled data and a "configure Supabase to enable accounts" message.
 *
 * This is the difference between "Apple reviewer sees a working map" and
 * "Apple reviewer sees a white screen, rejected."
 */
function buildClient(): SupabaseClient {
  if (configured) {
    return createClient(url, anonKey, {
      auth: {
        storage: AsyncStorage as never,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  // Stub — every call rejects with a typed error
  const stubError = new Error(
    'Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
  const handler: ProxyHandler<object> = {
    get() {
      return () => Promise.reject(stubError);
    },
  };
  return new Proxy({}, handler) as unknown as SupabaseClient;
}

export const supabase = buildClient();

export function isSupabaseConfigured(): boolean {
  return configured;
}
