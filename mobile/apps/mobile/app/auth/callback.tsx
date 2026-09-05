import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, fontSize, spacing } from '@protein-outfitters/shared';
import { establishSession, exchangeAuthToken } from '@/lib/auth';

/**
 * Deep-link landing after magic-link verify.
 *
 * Neon flow (preferred):
 *   - Browser hits /api/auth/verify?token=…&next=proteinoutfitters://auth/callback
 *   - API 302s to proteinoutfitters://auth/callback?session=<sessionId>
 *   - We SecureStore the session and confirm via /api/auth/me
 *
 * Also accepts:
 *   - ?token=<auth_token> → exchange via GET /api/auth/verify?format=json
 *   - Legacy Supabase ?access_token=&refresh_token= (ignored; send user to account)
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<{
    session?: string;
    token?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();
  const [message, setMessage] = useState('Signing you in…');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (params.error) {
        if (alive) setMessage('Sign-in link expired. Please try again.');
        router.replace('/account');
        return;
      }

      try {
        if (params.session) {
          await establishSession(String(params.session));
          router.replace('/');
          return;
        }
        if (params.token) {
          await exchangeAuthToken(String(params.token));
          router.replace('/');
          return;
        }
        // Legacy Supabase deep link — Neon is the auth backend now.
        if (params.access_token) {
          if (alive) {
            setMessage('Please request a new sign-in link from the Account screen.');
          }
          router.replace('/account');
          return;
        }
        router.replace('/account');
      } catch {
        if (alive) setMessage('Sign-in failed. Please try again.');
        router.replace('/account');
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    params.session,
    params.token,
    params.access_token,
    params.refresh_token,
    params.error,
  ]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.proc} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: { color: colors.textDim, fontSize: fontSize.base },
});
