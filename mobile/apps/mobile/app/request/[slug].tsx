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
  TextInput,
  View,
} from 'react-native';
import { Link, router, useLocalSearchParams } from 'expo-router';
import {
  colors,
  spacing,
  fontSize,
  radius,
  getProcessorBySlug,
  submitRequest,
  type AnimalType,
  type ServiceRequested,
  type Processor,
} from '@protein-outfitters/shared';
import { supabase } from '@/lib/supabase';

const ANIMALS: { value: AnimalType; label: string }[] = [
  { value: 'beef', label: 'Beef' },
  { value: 'pork', label: 'Pork' },
  { value: 'lamb', label: 'Lamb' },
  { value: 'goat', label: 'Goat' },
  { value: 'poultry', label: 'Poultry' },
  { value: 'venison', label: 'Venison' },
  { value: 'elk', label: 'Elk' },
  { value: 'wild_game', label: 'Other Wild Game' },
];

const SERVICES: { value: ServiceRequested; label: string }[] = [
  { value: 'whole_animal_processing', label: 'Whole animal' },
  { value: 'half_animal_processing', label: 'Half' },
  { value: 'quarter_animal_processing', label: 'Quarter' },
  { value: 'custom_cuts', label: 'Custom cuts' },
  { value: 'smoking', label: 'Smoking' },
  { value: 'sausage_making', label: 'Sausage' },
  { value: 'game_processing', label: 'Game processing' },
  { value: 'consultation', label: 'Just a question' },
];

export default function RequestScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [proc, setProc] = useState<Processor | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [zip, setZip] = useState('');
  const [animal, setAnimal] = useState<AnimalType>('beef');
  const [service, setService] = useState<ServiceRequested>(
    'whole_animal_processing',
  );
  const [notes, setNotes] = useState('');

  useEffect(() => {
    (async () => {
      const data = await getProcessorBySlug(supabase, slug);
      setProc(data);
    })();
  }, [slug]);

  const submit = async () => {
    if (!proc) return;
    if (!name.trim() || !email.trim()) {
      Alert.alert('Missing info', 'Please add your name and email.');
      return;
    }
    setSubmitting(true);
    try {
      await submitRequest(supabase, {
        processor_id: proc.id,
        user_id: null,
        contact_name: name.trim(),
        contact_email: email.trim(),
        contact_phone: phone.trim() || null,
        contact_zip: zip.trim() || null,
        animal_type: animal,
        service_requested: service,
        preferred_date: null,
        notes: notes.trim() || null,
      });
      Alert.alert(
        'Request sent',
        `${proc.name} has been notified. They'll reach out at ${email}.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      Alert.alert(
        'Could not send',
        e instanceof Error ? e.message : 'Try again in a moment.',
      );
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>Request service from</Text>
        <Text style={styles.name}>{proc.name}</Text>

        <Field label="Your name *">
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            placeholder="Sam Lifter"
            placeholderTextColor={colors.textMute}
          />
        </Field>
        <Field label="Email *">
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMute}
          />
        </Field>
        <Field label="Phone">
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="(555) 555-1234"
            placeholderTextColor={colors.textMute}
          />
        </Field>
        <Field label="ZIP">
          <TextInput
            style={styles.input}
            value={zip}
            onChangeText={setZip}
            keyboardType="number-pad"
            maxLength={5}
            placeholder="55944"
            placeholderTextColor={colors.textMute}
          />
        </Field>

        <Field label="Animal">
          <ChipPicker
            options={ANIMALS}
            value={animal}
            onChange={v => setAnimal(v as AnimalType)}
          />
        </Field>
        <Field label="Service">
          <ChipPicker
            options={SERVICES}
            value={service}
            onChange={v => setService(v as ServiceRequested)}
          />
        </Field>

        <Field label="Notes">
          <TextInput
            style={[styles.input, { height: 96, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Cut sheet, timing, anything they should know"
            placeholderTextColor={colors.textMute}
          />
        </Field>

        <Pressable
          style={[styles.cta, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
        >
          <Text style={styles.ctaText}>
            {submitting ? 'Sending…' : 'Send Request'}
          </Text>
        </Pressable>
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.fineprint}>
            We'll forward your request to {proc.name} and email you when they
            respond. By submitting, you agree to our{' '}
            <Link href="/legal/terms" style={styles.fineprintLink}>
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" style={styles.fineprintLink}>
              Privacy Policy
            </Link>
            .
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ marginTop: spacing.xs }}>{children}</View>
    </View>
  );
}

function ChipPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && { color: '#fff' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg0 },
  lead: { color: colors.textMute, fontSize: fontSize.sm },
  name: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: 4 },
  label: { color: colors.textMute, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.lg,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.base,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.procDeep, borderColor: colors.proc },
  chipText: { color: colors.text, fontSize: fontSize.sm },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.proc,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
  fineprint: {
    color: colors.textMute,
    fontSize: fontSize.xs,
    lineHeight: 16,
    textAlign: 'center',
  },
  fineprintLink: { color: colors.procLight, fontWeight: '600' },
});
