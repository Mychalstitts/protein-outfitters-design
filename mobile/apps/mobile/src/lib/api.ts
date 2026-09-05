/**
 * Thin fetch client for the canonical Protein Outfitters Vercel API
 * (Neon-backed). Read-only public endpoints for now — no auth headers.
 */

import Constants from 'expo-constants';

const DEFAULT_BASE = 'https://www.proteinoutfitters.com';

export function getApiBaseUrl(): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined);
  return (fromEnv || DEFAULT_BASE).replace(/\/$/, '');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(`API ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}
