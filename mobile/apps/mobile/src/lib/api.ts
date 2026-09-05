/**
 * Thin fetch client for the canonical Protein Outfitters Vercel API (Neon).
 * Attaches Authorization: Bearer when a SecureStore session exists.
 */

import Constants from 'expo-constants';
import { getSessionToken } from './session';

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
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeaders(
  extra?: HeadersInit,
  opts?: { auth?: boolean },
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (extra) {
    const h = new Headers(extra);
    h.forEach((v: string, k: string) => {
      headers[k] = v;
    });
  }
  if (opts?.auth !== false) {
    const token = await getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseError(res: Response, path: string): Promise<ApiError> {
  let body: unknown;
  let message = `API ${res.status} for ${path}`;
  try {
    body = await res.json();
    if (body && typeof body === 'object' && 'error' in body) {
      message = String((body as { error: unknown }).error);
    }
  } catch {
    /* ignore */
  }
  return new ApiError(message, res.status, body);
}

export async function apiGet<T>(
  path: string,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const { auth, ...rest } = init ?? {};
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...rest,
    method: 'GET',
    headers: await authHeaders(rest.headers, { auth }),
  });
  if (!res.ok) throw await parseError(res, path);
  return (await res.json()) as T;
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const { auth, ...rest } = init ?? {};
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...rest,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders(rest.headers, { auth })),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return (await res.json()) as T;
}

export async function apiPatch<T>(
  path: string,
  body?: unknown,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const { auth, ...rest } = init ?? {};
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...rest,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders(rest.headers, { auth })),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return (await res.json()) as T;
}
