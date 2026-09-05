import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, fontSize, spacing } from '@protein-outfitters/shared';
import { supabase } from '@/lib/supabase';

/**
 * The user clicked the magic link in their email. The app opened via the
 * "proteinoutfitters://auth/callback" deep link, with `access_token` and
 * `refresh_token` as query params (Supabase OTP flow).
 *
 * We hand them to supabase-js to establish the session, then route home.
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();

  useEffect(() => {
    (async () => {
      if (params.error) {
        // Common: link expired or already used
        router.replace('/account');
        return;
      }
      if (params.access_token && params.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (error) {
          router.replace('/account');
          return;
        }
      }
      router.replace('/');
    })();
  }, [params.access_token, params.refresh_token, params.error]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.proc} />
      <Text style={styles.text}>
        {params.error ? 'Sign-in link expired. Please try again.' : 'Signing you in…'}
      </Text>
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
