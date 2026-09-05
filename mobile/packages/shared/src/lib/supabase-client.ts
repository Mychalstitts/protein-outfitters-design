/**
 * Factory that creates a Supabase client. Each platform passes in its own
 * env values (Expo uses EXPO_PUBLIC_*, Next uses NEXT_PUBLIC_*) and its own
 * AsyncStorage adapter for auth persistence.
 *
 * When env is missing, returns a safe Proxy that mimics the Supabase builder
 * shape and resolves every `await` with `{ data: null, error }` instead of
 * throwing. This matches the mobile stub in app/apps/mobile/src/lib/supabase.ts
 * and keeps the project rule from docs/app-store-readiness.md:
 *   "Crash-free first launch. Supabase client is a safe Proxy that doesn't
 *    throw on missing env."
 *
 * The web app would otherwise hard-500 on any server route during the brief
 * window between Vercel deploy and env-var configuration, and on any preview
 * build that didn't pull production env.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Platform's persistent KV store. RN uses AsyncStorage, web uses localStorage */
  storage?: {
    getItem(key: string): Promise<string | null> | string | null;
    setItem(key: string, value: string): Promise<void> | void;
    removeItem(key: string): Promise<void> | void;
  };
  /** True for RN, false for web SSR */
  detectSessionInUrl?: boolean;
}

const STUB_ERROR_MESSAGE =
  'Supabase not configured. Set SUPABASE_URL / SUPABASE_ANON_KEY (or their EXPO_PUBLIC_* / NEXT_PUBLIC_* mirrors). See app/.env.example.';

/** True if both URL and key are populated. */
export function isSupabaseConfigured(cfg: SupabaseConfig): boolean {
  return Boolean(cfg.url && cfg.anonKey);
}

/**
 * Returns a chainable proxy whose every property access yields another
 * chainable proxy, whose every call yields another chainable proxy, and which
 * is itself awaitable — resolving to `{ data: null, error: <stub error> }`,
 * the same shape as a real Supabase failure. UI code that already handles
 * `error` gracefully (which most of ours does) keeps working.
 */
function makeStubClient(): SupabaseClient {
  const buildProxy = (): unknown => {
    // Callable target so the proxy is both indexable AND callable.
    // `function(){}` is the cheapest callable host object.
    const target = function () {} as unknown as object;
    return new Proxy(target, {
      get(_t, prop) {
        // Awaiting the proxy → resolve to a fake-failure response.
        if (prop === 'then') {
          return (
            onFulfilled?: (v: { data: null; error: Error }) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => {
            const response = { data: null, error: new Error(STUB_ERROR_MESSAGE) };
            return Promise.resolve(response).then(onFulfilled, onRejected);
          };
        }
        // Symbol.toPrimitive, util.inspect — return undefined so JS doesn't
        // try to coerce the proxy into a string and recurse.
        if (typeof prop === 'symbol') return undefined;
        // Any other property access → another chainable proxy.
        return buildProxy();
      },
      apply() {
        // Calling the proxy as a function (e.g., `supabase.from('x')`) →
        // another chainable proxy so `.select().eq().single()` keeps going.
        return buildProxy();
      },
    });
  };
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] Missing URL/anon key — returning safe stub client. ' +
      'Every network call resolves with { data: null, error }.',
  );
  return buildProxy() as SupabaseClient;
}

export function createSupabaseClient(cfg: SupabaseConfig): SupabaseClient {
  if (!isSupabaseConfigured(cfg)) {
    return makeStubClient();
  }
  return createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: cfg.storage as never,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: cfg.detectSessionInUrl ?? false,
    },
  });
}
