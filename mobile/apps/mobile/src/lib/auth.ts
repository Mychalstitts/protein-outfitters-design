/**
 * Neon auth helpers for Expo (magic link + Apple → SecureStore session).
 */

import * as Linking from 'expo-linking';
import { apiGet, apiPost, ApiError } from './api';
import {
  type AuthUser,
  clearSession,
  getSessionToken,
  setCachedUser,
  setSessionToken,
  subscribeAuth,
  getCachedUser,
} from './session';

export type { AuthUser };
export { subscribeAuth, getCachedUser, getSessionToken };

export async function requestMagicLink(email: string): Promise<{
  emailSent: boolean;
  devLink?: string | null;
}> {
  const next = Linking.createURL('/auth/callback');
  const data = await apiPost<{
    ok?: boolean;
    emailSent?: boolean;
    devLink?: string | null;
  }>(
    '/api/auth/request-link',
    { email: email.trim().toLowerCase(), next, client: 'mobile' },
    { auth: false },
  );
  return {
    emailSent: Boolean(data.emailSent),
    devLink: data.devLink ?? null,
  };
}

export async function exchangeAuthToken(token: string): Promise<AuthUser> {
  const data = await apiGet<{
    sessionToken?: string;
    user?: AuthUser;
    error?: string;
  }>(`/api/auth/verify?token=${encodeURIComponent(token)}&format=json`, {
    auth: false,
  });
  if (!data.sessionToken || !data.user) {
    throw new ApiError(data.error || 'Verify failed', 400, data);
  }
  await setSessionToken(data.sessionToken);
  setCachedUser(data.user);
  return data.user;
}

export async function establishSession(
  sessionToken: string,
): Promise<AuthUser | null> {
  await setSessionToken(sessionToken);
  return refreshCurrentUser();
}

export async function signInWithAppleToken(opts: {
  identityToken: string;
  email?: string | null;
  fullName?: { givenName?: string | null; familyName?: string | null } | null;
}): Promise<AuthUser> {
  const data = await apiPost<{
    sessionToken?: string;
    user?: AuthUser;
    error?: string;
  }>(
    '/api/auth/apple',
    {
      identityToken: opts.identityToken,
      email: opts.email ?? undefined,
      fullName: opts.fullName ?? undefined,
      audience: 'com.proteinoutfitters.app',
    },
    { auth: false },
  );
  if (!data.sessionToken || !data.user) {
    throw new ApiError(data.error || 'Apple sign-in failed', 400, data);
  }
  await setSessionToken(data.sessionToken);
  setCachedUser(data.user);
  return data.user;
}

export async function refreshCurrentUser(): Promise<AuthUser | null> {
  const token = await getSessionToken();
  if (!token) {
    setCachedUser(null);
    return null;
  }
  try {
    const data = await apiGet<{ user: AuthUser | null }>('/api/auth/me');
    const user = data.user ?? null;
    if (!user) {
      await clearSession();
      return null;
    }
    setCachedUser(user);
    return user;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      await clearSession();
      return null;
    }
    // Network blip — keep cached user if we have a token
    return getCachedUser();
  }
}

export async function signOut(): Promise<void> {
  try {
    await apiPost('/api/auth/logout', {});
  } catch {
    /* still clear local */
  }
  await clearSession();
}

export async function deleteAccount(): Promise<void> {
  await apiPost('/api/account-delete', { confirm: 'delete my account' });
  await clearSession();
}

export async function claimProcessor(opts: {
  claim_slug?: string;
  claim_id?: string;
}): Promise<{ processor: unknown; claimed: boolean }> {
  if (!opts.claim_slug && !opts.claim_id) {
    throw new Error('claim_slug or claim_id required');
  }
  return apiPost('/api/processors', {
    claim_slug: opts.claim_slug,
    claim_id: opts.claim_id,
  });
}
