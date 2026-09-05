import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  colors,
  spacing,
  fontSize,
  radius,
  type Processor,
} from '@protein-outfitters/shared';
import { claimProcessor, getCachedUser, refreshCurrentUser, type AuthUser } from '@/lib/auth';
import { loadProcessorBySlug, normalizeRouteSlug } from '@/lib/processors';
import {
  CUSTOM_EXEMPT_LABEL,
  CUSTOM_EXEMPT_NOTE,
  isCustomExemptListing,
  isSyntheticSlug,
} from '@/lib/neonAdapter';
import { ApiError } from '@/lib/api';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ClaimScreen() {
  const { slug: slugParam } = useLocalSearchParams<{ slug: string }>();
  const slug = normalizeRouteSlug(slugParam);
  const [proc, setProc] = useState<Processor | null>(null);
  const [source, setSource] = useState<string>('bundled');
  const [user, setUser] = useState<AuthUser | null>(getCachedUser());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await loadProcessorBySlug(slug);
      setProc(result.processor);
      setSource(result.source);
      const u = await refreshCurrentUser();
      setUser(u);
    })();
  }, [slug]);

  const submit = async () => {
    if (!proc) return;
    if (isCustomExemptListing(proc)) {
      Alert.alert(
        'Not claimable',
        CUSTOM_EXEMPT_LABEL,
      );
      return;
    }
    if (!user) {
      Alert.alert(
        'Sign in required',
        'You need an account to claim a listing. Sign in and try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.replace('/account') },
        ],
      );
      return;
    }
    // Neon claim is by slug (preferred) or UUID. Bundled mamp-* ids will not work.
    // Synthetic neon-<uuid> slugs aren't on /api/processors?slug= — claim by id.
    const canClaimBySlug =
      Boolean(proc.slug) && !isSyntheticSlug(String(proc.slug));
    const canClaimById = UUID_RE.test(String(proc.id));
    if (!canClaimBySlug && !canClaimById) {
      Alert.alert(
        'Listing not on the live map yet',
        'This pin is from offline cache and is not claimable until it syncs to our directory. Open it from a live search result and try again.',
      );
      return;
    }
    setSubmitting(true);
    try {
      await claimProcessor(
        canClaimBySlug
          ? { claim_slug: proc.slug }
          : { claim_id: String(proc.id) },
      );
      Alert.alert(
        'Listing claimed',
        `${proc.name} is now linked to your account. You can manage it on proteinoutfitters.com.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Try again in a moment.';
      Alert.alert('Could not claim', msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!proc) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.proc} />
      </View>
    );
  }

  if (isCustomExemptListing(proc)) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{CUSTOM_EXEMPT_LABEL}</Text>
        <Text style={[styles.body, { textAlign: 'center' }]}>
          {CUSTOM_EXEMPT_NOTE}. This shop stays on the map for directory
          honesty. It is custom-exempt and not claimable. Prefer not to be
          listed? Email support@proteinoutfitters.com.
        </Text>
      </View>
    );
  }

  if (proc.claim_status === 'claimed') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Already claimed</Text>
        <Text style={[styles.body, { textAlign: 'center' }]}>
          This listing has already been claimed. If you believe this is in
          error, contact support@proteinoutfitters.com.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.kicker}>Claim listing</Text>
        <Text style={styles.h1}>{proc.name}</Text>
        <Text style={styles.body}>
          Claiming links this listing to your Protein Outfitters account
          {source === 'api' ? '' : ' (live directory preferred)'}. Free. Sign in
          required. Manage the listing on the web after you claim.
        </Text>

        <Pressable
          style={[styles.cta, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
        >
          <Text style={styles.ctaText}>
            {submitting ? 'Claiming…' : 'Claim this listing'}
          </Text>
        </Pressable>

        <Text style={styles.fineprint}>
          Submitting a fraudulent claim is a violation of our Terms and may
          result in account suspension.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg0, padding: spacing.lg },
  kicker: { color: colors.procLight, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 4, letterSpacing: -0.3 },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.textDim, fontSize: fontSize.base, lineHeight: 22, marginTop: spacing.sm },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.proc,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
  fineprint: { color: colors.textMute, fontSize: fontSize.xs, marginTop: spacing.md, lineHeight: 16, textAlign: 'center' },
});
