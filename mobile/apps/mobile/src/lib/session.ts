/**
 * Neon session token for mobile.
 * Stored in SecureStore (not AsyncStorage) — opaque session id from
 * /api/auth/verify or /api/auth/apple, sent as Authorization: Bearer.
 */

import * as SecureStore from 'expo-secure-store';

const KEY = 'po_session';

export type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  zip?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

type Listener = (user: AuthUser | null) => void;

let memoryToken: string | null | undefined;
let memoryUser: AuthUser | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) {
    try {
      l(memoryUser);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getSessionToken(): Promise<string | null> {
  if (memoryToken !== undefined) return memoryToken;
  try {
    memoryToken = (await SecureStore.getItemAsync(KEY)) || null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export async function setSessionToken(token: string | null): Promise<void> {
  memoryToken = token;
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* SecureStore unavailable on web without HTTPS — memory still works */
  }
}

export function getCachedUser(): AuthUser | null {
  return memoryUser;
}

export function setCachedUser(user: AuthUser | null): void {
  memoryUser = user;
  notify();
}

export async function clearSession(): Promise<void> {
  memoryUser = null;
  await setSessionToken(null);
  notify();
}
