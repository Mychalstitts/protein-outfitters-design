/**
 * Runtime feature flags. Expo inlines EXPO_PUBLIC_* at bundle time.
 */

/** Sign in with Apple — off until the App ID capability is enabled. */
export const SIWA_ENABLED = process.env.EXPO_PUBLIC_SIWA_ENABLED === 'true';
