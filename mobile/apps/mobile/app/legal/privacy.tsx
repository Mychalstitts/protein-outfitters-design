import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, fontSize } from '@protein-outfitters/shared';

export default function PrivacyScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Privacy Policy</Text>
      <Text style={styles.dim}>Effective date: September 5, 2026</Text>
      <Text style={styles.dim}>
        Operator: Stittsworth Meats, Bemidji, Minnesota · Brand: Protein Outfitters
      </Text>

      <H2>1. Scope</H2>
      <P>
        This Privacy Policy describes how Stittsworth Meats (“we,” “us,”
        “Operator”), operating Protein Outfitters, collects, uses, and shares
        information when you use our website, mobile app, and related services
        (the “Service”).
      </P>

      <H2>2. What we collect</H2>
      <P>
        <Bold>Account info.</Bold> Email, name (optional), role, and any
        address you save for pickup.
      </P>
      <P>
        <Bold>Authentication.</Bold> Magic link and/or Sign in with Apple. We
        do not store passwords.
      </P>
      <P>
        <Bold>Reservation data.</Bold> Animals you reserve, share size,
        drop-off and pickup details, and cut-sheet selections.
      </P>
      <P>
        <Bold>Payment data.</Bold> Handled by Stripe. We never store full card
        numbers (PAN).
      </P>
      <P>
        <Bold>Producer / processor profile.</Bold> Farm or plant name,
        location, certifications, schedule, capabilities, and public bio.
      </P>
      <P>
        <Bold>Device and usage logs.</Bold> Standard server logs for security,
        reliability, and abuse prevention.
      </P>
      <P>
        <Bold>Maps and search.</Bold> Google Maps and Gemini power geocoding
        and search. We do not run third-party advertising trackers.
      </P>

      <H2>3. Why we collect it</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>Operate the marketplace</Bullet>
        <Bullet>USDA / state / equal-to recordkeeping</Bullet>
        <Bullet>Reliability, fraud prevention, and law</Bullet>
      </View>

      <H2>4. Who can see your data</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>You — from your account or on request</Bullet>
        <Bullet>The producer and processor on that reservation</Bullet>
        <Bullet>
          Service providers: Stripe, Resend, Supabase, Vercel, Google Maps /
          Gemini, Apple
        </Bullet>
        <Bullet>Government when required</Bullet>
        <Bullet>We do not sell or rent data to advertisers</Bullet>
      </View>

      <H2>5. Cookies and localStorage</H2>
      <P>
        Session and preferences only. No advertising cookies.
      </P>

      <H2>6. Public profiles</H2>
      <P>
        Producer and processor profiles are public. Buyer profiles are not.
      </P>

      <H2>7. Retention and deletion</H2>
      <P>
        Delete your account in-app with Delete my account, or email
        hello@proteinoutfitters.com. We keep tax and regulatory records
        typically up to 7 years.
      </P>

      <H2>8. Children</H2>
      <P>
        The Service is not directed at children under 13. You must be of legal
        age to reserve (see Terms).
      </P>

      <H2>9. Your choices</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>Update your account information</Bullet>
        <Bullet>Access, correct, or delete via the app or hello@</Bullet>
        <Bullet>
          Opt out of marketing email. Transactional messages are still sent.
        </Bullet>
      </View>

      <H2>10. Changes</H2>
      <P>Material changes will be emailed and/or posted.</P>

      <H2>11. Contact</H2>
      <P>hello@proteinoutfitters.com</P>
      <P>Operator: Stittsworth Meats, Bemidji, Minnesota.</P>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.h2}>{children}</Text>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.body}>{children}</Text>
);
const Bold = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ fontWeight: '700', color: colors.text }}>{children}</Text>
);
const Bullet = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.bullet}>{`• `}{children}</Text>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  content: { padding: spacing.lg, gap: spacing.sm },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  h2: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginTop: spacing.lg,
  },
  dim: { color: colors.textMute, fontSize: fontSize.sm },
  body: { color: colors.textDim, fontSize: fontSize.base, lineHeight: 22 },
  bullet: { color: colors.textDim, fontSize: fontSize.base, lineHeight: 22, paddingLeft: 4 },
});
