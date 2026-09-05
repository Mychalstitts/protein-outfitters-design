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
import { Link, router } from 'expo-router';
import { colors, spacing, fontSize, radius } from '@protein-outfitters/shared';
import {
  type AuthUser,
  deleteAccount,
  refreshCurrentUser,
  requestMagicLink,
  signInWithAppleToken,
  signOut,
  subscribeAuth,
} from '@/lib/auth';

export default function AccountScreen() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await refreshCurrentUser();
      if (alive) {
        setUser(u);
        setLoading(false);
      }
    })();
    const unsub = subscribeAuth((u) => setUser(u));
    return () => {
      alive = false;
      unsub();
    };
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
  const [devLink, setDevLink] = useState<string | null>(null);

  const sendMagicLink = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setSending(true);
    try {
      const result = await requestMagicLink(trimmed);
      setSentTo(trimmed);
      setDevLink(result.devLink ?? null);
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
      await signInWithAppleToken({
        identityToken: credential.identityToken,
        email: credential.email,
        fullName: credential.fullName
          ? {
              givenName: credential.fullName.givenName,
              familyName: credential.fullName.familyName,
            }
          : null,
      });
      router.replace('/');
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
            We sent a sign-in link to{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>{sentTo}</Text>.
            Open it on this phone — it returns you to the app signed in.
          </Text>
          {devLink ? (
            <Text style={[styles.body, { marginTop: spacing.md, fontSize: fontSize.sm }]}>
              Dev link (no Resend key): open this URL on the device or paste the
              token into the app callback flow.
            </Text>
          ) : null}
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
          Sign in to claim a listing, track activity, and manage your account.
          Same account as proteinoutfitters.com.
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

function SignedInView({ user }: { user: AuthUser }) {
  const onSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account profile. Tax records are retained anonymously per IRS rules. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              router.replace('/');
            } catch (e: unknown) {
              Alert.alert(
                'Error',
                e instanceof Error ? e.message : 'Could not delete account.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.section}>
        <Text style={styles.title}>Signed in</Text>
        <Text style={styles.body}>{user.email ?? user.name ?? user.id}</Text>
        {user.role ? (
          <Text style={[styles.body, { marginTop: spacing.xs }]}>
            Role: {user.role}
          </Text>
        ) : null}
      </View>

      <Pressable style={styles.btn} onPress={onSignOut}>
        <Text style={styles.btnText}>Sign out</Text>
      </Pressable>

      <Pressable style={[styles.btn, styles.btnDanger]} onPress={onDeleteAccount}>
        <Text style={[styles.btnText, { color: '#fff' }]}>Delete my account</Text>
      </Pressable>

      <Text style={styles.fineprint}>
        Deleting your account scrubbs your profile and revokes all sessions.
        Required by App Store policy and our privacy commitment.
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
