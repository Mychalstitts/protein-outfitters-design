import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, radius } from '@protein-outfitters/shared';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Text style={styles.logoText}>PO</Text>
        </View>
        <Text style={styles.title}>Protein Outfitters</Text>
        <Text style={styles.subtitle}>
          Find a meat plant near you. Send a cut request. Claim your shop if
          you&apos;re listed.
        </Text>
      </View>

      <View style={styles.actions}>
        <Link href="/map" asChild>
          <Pressable style={[styles.btn, styles.btnPrimary]}>
            <Text style={styles.btnPrimaryText}>Browse the map</Text>
          </Pressable>
        </Link>
        <Link href="/account" asChild>
          <Pressable style={[styles.btn, styles.btnSecondary]}>
            <Text style={styles.btnSecondaryText}>Sign in</Text>
          </Pressable>
        </Link>
      </View>

      <Text style={styles.footer}>
        Sign in to send a request or claim a listing.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.proc,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoText: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: fontSize.lg,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  btn: {
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.proc,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
  },
  btnSecondaryText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  footer: {
    color: colors.textMute,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingBottom: spacing.lg,
  },
});
