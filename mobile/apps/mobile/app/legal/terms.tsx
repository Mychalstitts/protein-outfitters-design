import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, fontSize } from '@protein-outfitters/shared';

export default function TermsScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Terms of Service</Text>
      <Text style={styles.dim}>Effective date: September 5, 2026</Text>
      <Text style={styles.dim}>
        Operator: Stittsworth Meats, Bemidji, Minnesota · Brand: Protein Outfitters
      </Text>

      <H2>1. Who we are</H2>
      <P>
        Protein Outfitters is a marketplace operated by Stittsworth Meats
        (Bemidji, Minnesota). Animals sold through the marketplace are
        processed at a USDA, state-inspected, or equal-to plant. Custom-exempt
        processing is never sold. Institutions may use Donation Depot.
      </P>

      <H2>2. Agreement</H2>
      <P>
        By using the website, app, or Service, you agree to these Terms and
        the Refund policy. If you do not agree, do not use the Service.
      </P>

      <H2>3. Account</H2>
      <P>
        You sign in with a magic link and/or Sign in with Apple. We do not
        store passwords. You must be of legal age to reserve (18+ in the
        United States). Delete your account in-app with Delete my account, or
        email hello@proteinoutfitters.com.
      </P>

      <H2>4. Reservations</H2>
      <P>
        When checkout is enabled, you pay a deposit. The listed meat price is
        hanging weight $/lb: the producer’s rate plus Protein Outfitters’ 10%
        marketplace fee. Kill, cut, and wrap are set by the processor and paid
        at the plant. The first paid reservation locks that $/lb. Until
        checkout is enabled, we do not collect payment. There is no refund for
        unpaid amounts.
      </P>

      <H2>5. Cancellation and refunds</H2>
      <P>
        If the animal does not pass inspection, we refund what you paid. That
        is the refund rule. We do not offer condemnation insurance, a reserve,
        or a shared pool.
      </P>

      <H2>6. Inspection</H2>
      <P>
        USDA, state-inspected, or equal-to plants. Custom-exempt is never
        sold. Do not assume every plant is USDA-inspected.
      </P>

      <H2>7. Producers and processors</H2>
      <P>
        Producers control listings, prices, and processor choice. Processors
        set kill, cut, and wrap rates. When checkout is enabled, funds settle
        through Stripe Connect.
      </P>

      <H2>8. What you may not do</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>Resell platform-purchased meat without your own license</Bullet>
        <Bullet>Bypass the platform on a reservation that started here</Bullet>
        <Bullet>Misrepresent practices, certifications, or animal identity</Bullet>
      </View>

      <H2>9. Disclaimers</H2>
      <P>
        The Service is provided as is. Except for the refund rule in section
        5, we do not guarantee hanging weight, timing, or that a reservation
        will complete.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        Minnesota law. Our total liability is limited to the amounts you paid
        us for a reservation in the prior 12 months.
      </P>

      <H2>11. Disputes</H2>
      <P>
        Email hello@proteinoutfitters.com first. Unresolved disputes go to
        binding arbitration in Beltrami County, Minnesota.
      </P>

      <H2>12. Changes</H2>
      <P>
        Material changes will be emailed and/or posted. Continued use means
        you accept the update.
      </P>

      <H2>13. Contact</H2>
      <P>hello@proteinoutfitters.com</P>
      <P>Donation Depot: depot@proteinoutfitters.com</P>
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
const Bullet = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.bullet}>{`• `}{children}</Text>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  content: { padding: spacing.lg, gap: spacing.sm },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  h2: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', marginTop: spacing.lg },
  dim: { color: colors.textMute, fontSize: fontSize.sm },
  body: { color: colors.textDim, fontSize: fontSize.base, lineHeight: 22 },
  bullet: { color: colors.textDim, fontSize: fontSize.base, lineHeight: 22, paddingLeft: 4 },
});
