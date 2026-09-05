import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { Link, router } from 'expo-router';
import { colors, spacing, fontSize, radius } from '@protein-outfitters/shared';
import { supabase } from '@/lib/supabase';

export default function AccountScreen() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email } : null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(
        session?.user
          ? { id: session.user.id, email: session.user.email }
          : null,
      );
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.proc} />
      </View>
    );
  }

  if (!user) return <SignInView />;
  return <SignedInView user={user} />;
}

// ============================================================================
// Sign-in view
// ============================================================================

function SignInView() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const sendMagicLink = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setSending(true);
    try {
      const redirect = Linking.createURL('/auth/callback');
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirect },
      });
      if (error) throw error;
      setSentTo(trimmed);
    } catch (e: unknown) {
      Alert.alert(
        'Could not send link',
        e instanceof Error ? e.message : 'Try again in a moment.',
      );
    } finally {
      setSending(false);
    }
  };

  const signInWithApple = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identity token from Apple.');
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Try again.');
    }
  };

  if (sentTo) {
    return (
      <View style={styles.root}>
        <View style={styles.section}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.body}>
            We sent a sign-in link to <Text style={{ color: colors.text, fontWeight: '600' }}>{sentTo}</Text>.
            Tap the link from your phone to finish signing in.
          </Text>
          <Pressable style={styles.btn} onPress={() => setSentTo(null)}>
            <Text style={styles.btnText}>Use a different email</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.section}>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.body}>
          Sign in to track requests, save favorites, and get notified when a
          processor responds.
        </Text>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.textMute}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
        />
        <Pressable
          style={[styles.btnPrimary, sending && { opacity: 0.6 }]}
          onPress={sendMagicLink}
          disabled={sending}
        >
          <Text style={styles.btnPrimaryText}>
            {sending ? 'Sending…' : 'Email me a sign-in link'}
          </Text>
        </Pressable>

        {Platform.OS === 'ios' ? (
          <>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
              }
              buttonStyle={
                AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              }
              cornerRadius={radius.lg}
              style={{ width: '100%', height: 48 }}
              onPress={signInWithApple}
            />
          </>
        ) : null}
      </View>

      <View style={styles.legalRow}>
        <Link href="/legal/privacy" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.legalLink}>Privacy</Text>
          </Pressable>
        </Link>
        <Text style={styles.legalSep}>·</Text>
        <Link href="/legal/terms" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.legalLink}>Terms</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

// ============================================================================
// Signed-in view
// ============================================================================

function SignedInView({ user }: { user: { id: string; email?: string } }) {
  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account, profile, and all submitted requests. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('delete_my_account');
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            await supabase.auth.signOut();
            router.replace('/');
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.section}>
        <Text style={styles.title}>Signed in</Text>
        <Text style={styles.body}>{user.email ?? user.id}</Text>
      </View>

      <Pressable style={styles.btn} onPress={signOut}>
        <Text style={styles.btnText}>Sign out</Text>
      </Pressable>

      <Pressable style={[styles.btn, styles.btnDanger]} onPress={deleteAccount}>
        <Text style={[styles.btnText, { color: '#fff' }]}>Delete my account</Text>
      </Pressable>

      <Text style={styles.fineprint}>
        Deleting your account permanently removes your profile and any submitted
        requests. Required by App Store policy and our privacy commitment.
      </Text>

      <View style={styles.legalRow}>
        <Link href="/legal/privacy" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Pressable>
        </Link>
        <Text style={styles.legalSep}>·</Text>
        <Link href="/legal/terms" asChild>
          <Pressable hitSlop={8}>
            <Text style={styles.legalLink}>Terms of Service</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0, padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg0 },
  section: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  body: { color: colors.textDim, fontSize: fontSize.base, marginTop: spacing.xs, lineHeight: 20 },
  label: { color: colors.textMute, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: {
    marginTop: spacing.xs,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.lg,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.base,
  },
  btn: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  btnDanger: { backgroundColor: colors.warn, borderColor: colors.warn },
  btnText: { color: colors.text, fontSize: fontSize.base, fontWeight: '600' },
  btnPrimary: {
    marginTop: spacing.sm,
    backgroundColor: colors.proc,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: fontSize.base, fontWeight: '700' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.bg4 },
  dividerText: { color: colors.textMute, fontSize: fontSize.sm },
  fineprint: { color: colors.textMute, fontSize: fontSize.sm, lineHeight: 18 },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  legalLink: { color: colors.procLight, fontSize: fontSize.sm, fontWeight: '600' },
  legalSep: { color: colors.textMute, fontSize: fontSize.sm },
});
