import { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  colors,
  fontSize,
  radius,
  spacing,
  type ProcessorFilters,
  type Processor,
} from '@protein-outfitters/shared';

const COMMON_SERVICES = [
  'Retail',
  'Wholesale',
  'Custom Cuts',
  'Smoking',
  'Sausage',
  'Game Processing',
  'Slaughter',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: ProcessorFilters;
  onChange: (next: ProcessorFilters) => void;
  /** Used to compute available states from the loaded dataset */
  processors: Processor[];
}

export function FilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  processors,
}: Props) {
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const p of processors) {
      if (p.address.state) set.add(p.address.state);
    }
    return Array.from(set).sort();
  }, [processors]);

  const toggle = <T extends string>(arr: T[] | undefined, value: T): T[] => {
    const current = new Set(arr ?? []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    return Array.from(current);
  };

  const reset = () => onChange({ query: filters.query });

  const activeCount =
    (filters.states?.length ?? 0) +
    (filters.services?.length ?? 0) +
    (filters.claimStatus && filters.claimStatus !== 'any' ? 1 : 0) +
    (filters.hasPhone ? 1 : 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
            </Text>
            {activeCount > 0 ? (
              <Pressable onPress={reset} hitSlop={10}>
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            <Section title="State">
              <View style={styles.chipRow}>
                {states.map(s => {
                  const active = filters.states?.includes(s) ?? false;
                  return (
                    <Pressable
                      key={s}
                      onPress={() =>
                        onChange({
                          ...filters,
                          states: toggle(filters.states, s),
                        })
                      }
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && { color: '#fff' }]}>
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Services">
              <View style={styles.chipRow}>
                {COMMON_SERVICES.map(s => {
                  const active = filters.services?.includes(s) ?? false;
                  return (
                    <Pressable
                      key={s}
                      onPress={() =>
                        onChange({
                          ...filters,
                          services: toggle(filters.services, s),
                        })
                      }
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && { color: '#fff' }]}>
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Listing">
              <View style={styles.chipRow}>
                {(['any', 'claimed', 'unclaimed'] as const).map(s => {
                  const active = (filters.claimStatus ?? 'any') === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => onChange({ ...filters, claimStatus: s })}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && { color: '#fff' }]}>
                        {s === 'any' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title="Other">
              <Pressable
                onPress={() =>
                  onChange({ ...filters, hasPhone: !filters.hasPhone })
                }
                style={[
                  styles.checkRow,
                  filters.hasPhone && styles.checkRowActive,
                ]}
              >
                <View style={[styles.check, filters.hasPhone && styles.checkActive]}>
                  {filters.hasPhone ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkText}>Has a phone number</Text>
              </Pressable>
            </Section>

            <View style={{ height: spacing.xl }} />
          </ScrollView>

          <Pressable style={styles.cta} onPress={onClose}>
            <Text style={styles.ctaText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ marginTop: spacing.sm }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bg4,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  reset: { color: colors.procLight, fontSize: fontSize.base, fontWeight: '600' },
  sectionTitle: {
    color: colors.textMute,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  checkRowActive: { borderColor: colors.proc },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.bg4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkActive: { backgroundColor: colors.proc, borderColor: colors.proc },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkText: { color: colors.text, fontSize: fontSize.base, fontWeight: '500' },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.proc,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
});
