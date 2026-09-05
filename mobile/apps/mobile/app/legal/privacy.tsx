import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, fontSize } from '@protein-outfitters/shared';

export default function PrivacyScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Privacy Policy</Text>
      <Text style={styles.dim}>Last updated: May 6, 2026</Text>

      <P>
        This privacy policy describes how Protein Outfitters (“we,” “us”)
        collects, uses, and shares information when you use our mobile and web
        apps.
      </P>

      <H2>What we collect</H2>
      <P>
        <Bold>Account information.</Bold> If you create an account, we collect
        your name, email address, and an authentication identifier from your
        sign-in provider (Apple, Google, or email).
      </P>
      <P>
        <Bold>Service requests.</Bold> When you submit a service request, we
        collect the contact information you enter (name, email, phone, ZIP),
        the animal type and service you’re requesting, your preferred date,
        and any notes you write.
      </P>
      <P>
        <Bold>Location.</Bold> With your permission, we use your device’s
        coarse location to center the map near you and to sort processors by
        distance. You can decline this — the app will work, you’ll just need
        to search by ZIP. We don’t store your location on our servers.
      </P>

      <H2>What we don’t do</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>We don’t sell your personal information</Bullet>
        <Bullet>We don’t track you across other apps or websites</Bullet>
        <Bullet>We don’t share your information with advertisers</Bullet>
        <Bullet>We don’t run third-party fingerprinting analytics</Bullet>
      </View>

      <H2>Sharing</H2>
      <P>
        When you submit a request to a processor, we share the contact info
        you entered with that specific processor (or send it to them by email
        if they haven’t claimed their listing yet). That’s the whole point of
        the request.
      </P>

      <H2>Your choices</H2>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <Bullet>
          <Bold>Delete your account:</Bold> Account → Delete my account.
          Permanent and immediate.
        </Bullet>
        <Bullet>
          <Bold>Export your data:</Bold> email privacy@proteinoutfitters.com
        </Bullet>
        <Bullet>
          <Bold>CCPA / GDPR:</Bold> contact us at privacy@proteinoutfitters.com
          for additional rights.
        </Bullet>
      </View>

      <H2>Children</H2>
      <P>
        The app is not directed to children under 13, and we don’t knowingly
        collect their information.
      </P>

      <H2>Contact</H2>
      <P>privacy@proteinoutfitters.com</P>

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
