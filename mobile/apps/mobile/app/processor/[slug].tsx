import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import {
  colors,
  spacing,
  fontSize,
  radius,
  type Processor,
} from '@protein-outfitters/shared';
import { loadProcessorBySlug, normalizeRouteSlug } from '@/lib/processors';
import {
  CUSTOM_EXEMPT_MAP_LABEL,
  isCustomExemptListing,
} from '@/lib/neonAdapter';

export default function ProcessorDetail() {
  const { slug: slugParam } = useLocalSearchParams<{ slug: string }>();
  const slug = normalizeRouteSlug(slugParam);
  const [proc, setProc] = useState<Processor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadProcessorBySlug(slug);
        if (!cancelled) {
          if (!result.processor) setError(result.error ?? 'Processor not found.');
          else setProc(result.processor);
        }
      } catch (e: unknown) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.proc} />
      </View>
    );
  }
  if (error || !proc) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={styles.header}>
        <Text style={styles.name}>{proc.name}</Text>
        <View
          style={[
            styles.roleBadge,
            {
              backgroundColor:
                proc.role === 'processor' ? colors.procDeep : colors.supDeep,
            },
          ]}
        >
          <Text style={styles.roleBadgeText}>{proc.role.toUpperCase()}</Text>
        </View>
      </View>

      {isCustomExemptListing(proc) ? (
        <View style={styles.unclaimedBanner}>
          <Text style={styles.unclaimedText}>
            {CUSTOM_EXEMPT_MAP_LABEL}. Prefer not to be listed? Email
            support@proteinoutfitters.com.
          </Text>
        </View>
      ) : proc.claim_status === 'unclaimed' && proc.slug ? (
        <Link href={`/claim/${proc.slug}`} asChild>
          <Pressable style={styles.unclaimedBanner}>
            <Text style={styles.unclaimedText}>
              This listing hasn't been claimed yet. Are you the owner?{' '}
              <Text style={{ color: colors.procLight, fontWeight: '600' }}>
                Claim it →
              </Text>
            </Text>
          </Pressable>
        </Link>
      ) : null}

      <Section title="Address">
        <Text style={styles.body}>
          {proc.address.full ??
            [proc.address.city, proc.address.state, proc.address.zip]
              .filter(Boolean)
              .join(', ')}
        </Text>
      </Section>

      {proc.services.length > 0 ? (
        <Section title="Services">
          <View style={styles.chipRow}>
            {proc.services.map(s => (
              <View key={s} style={styles.chip}>
                <Text style={styles.chipText}>{s}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Contact">
        {proc.phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${proc.phone}`)}>
            <Text style={styles.link}>{proc.phone}</Text>
          </Pressable>
        ) : null}
        {proc.email ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${proc.email}`)}>
            <Text style={styles.link}>{proc.email}</Text>
          </Pressable>
        ) : null}
        {proc.website ? (
          <Pressable onPress={() => Linking.openURL(proc.website!)}>
            <Text style={styles.link}>{proc.website}</Text>
          </Pressable>
        ) : null}
        {proc.contact_name ? (
          <Text style={[styles.body, { color: colors.textDim }]}>
            Contact: {proc.contact_name}
          </Text>
        ) : null}
      </Section>

      {proc.usda_establishment_number ? (
        <Section title="USDA Establishment">
          <Text style={styles.body}>{proc.usda_establishment_number}</Text>
        </Section>
      ) : null}

      <Section title="Source">
        <Text style={[styles.body, { color: colors.textMute }]}>
          {proc.source}
          {proc.source_url ? ` · ${proc.source_url}` : ''}
        </Text>
      </Section>

      {proc.slug ? (
        <Link href={`/request/${proc.slug}`} asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>Request Service</Text>
          </Pressable>
        </Link>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ marginTop: spacing.xs }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  name: { color: colors.text, fontSize: 22, fontWeight: '700', flex: 1 },
  roleBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm },
  roleBadgeText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.5 },
  unclaimedBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  unclaimedText: { color: colors.textDim, fontSize: fontSize.sm, lineHeight: 18 },
  sectionTitle: { color: colors.textMute, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  body: { color: colors.text, fontSize: fontSize.base, lineHeight: 20 },
  link: { color: colors.procLight, fontSize: fontSize.base, paddingVertical: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipText: { color: colors.text, fontSize: fontSize.sm },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.proc,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
  error: { color: colors.warn, fontSize: fontSize.base, paddingHorizontal: spacing.lg, textAlign: 'center' },
});
