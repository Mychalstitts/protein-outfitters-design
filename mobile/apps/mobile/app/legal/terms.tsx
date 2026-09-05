import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, fontSize } from '@protein-outfitters/shared';

export default function TermsScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Terms of Service</Text>
      <Text style={styles.dim}>Last updated: May 6, 2026</Text>

      <P>
        These terms govern your use of the Protein Outfitters apps and
        website. By using the service you agree to them.
      </P>

      <H2>What the service is</H2>
      <P>
        Protein Outfitters is a directory and request platform that connects
        consumers with meat processors. We list processors based on public
        information from state meat processor associations and other public
        sources. We are not the processor.
      </P>

      <H2>Your account</H2>
      <P>
        You’re responsible for keeping your credentials safe. You must be at
        least 18 to create an account.
      </P>

      <H2>How requests work</H2>
      <P>
        When you submit a service request, you authorize us to forward your
        contact information to the processor you selected. Any agreement you
        reach with a processor is between you and them — we are not a party.
      </P>

      <H2>Processor listings</H2>
      <P>
        If you are a processor, you can claim your listing for free. If you’d
        rather not be listed at all, contact us and we’ll remove the listing
        within 7 days.
      </P>

      <H2>Acceptable use</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>Don’t use the service unlawfully</Bullet>
        <Bullet>Don’t submit false or misleading requests</Bullet>
        <Bullet>Don’t harass or threaten anyone</Bullet>
        <Bullet>Don’t scrape, copy, or resell our data</Bullet>
        <Bullet>Don’t flood the request system with bots</Bullet>
      </View>

      <H2>Disclaimers</H2>
      <P>
        The service is provided “as is.” We don’t guarantee processors will
        respond, perform work, or meet your standards. Verify a processor’s
        inspection status and reliability directly with them.
      </P>

      <H2>Liability</H2>
      <P>
        Our total liability is limited to the greater of $50 or the amount
        you paid us in the past twelve months.
      </P>

      <H2>Termination</H2>
      <P>
        You can stop using the service and delete your account at any time
        from the Account screen.
      </P>

      <H2>Contact</H2>
      <P>support@proteinoutfitters.com</P>

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
