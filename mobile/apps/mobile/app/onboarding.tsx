import { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, radius } from '@protein-outfitters/shared';
import { markOnboarded } from '@/lib/onboarding';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    key: 'find',
    title: 'Every meat processor in America',
    body:
      'Browse a live map of 500+ USDA and state-inspected processors and suppliers. We seed the map with public data so you never hit an empty page.',
    accent: colors.proc,
  },
  {
    key: 'request',
    title: 'Request work direct',
    body:
      'Tell a processor what animal, what cuts, when you need it. They get a real warm lead — not a cold call. You get a real response.',
    accent: colors.sup,
  },
  {
    key: 'claim',
    title: 'Are you a processor?',
    body:
      'If your shop is on the map, claim your listing to manage requests, post photos, and build your reputation. Free to claim, always.',
    accent: colors.hw,
  },
];

export default function OnboardingScreen() {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index);
    },
  ).current;

  const next = async () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1 });
    } else {
      await markOnboarded();
      router.replace('/');
    }
  };

  const skip = async () => {
    await markOnboarded();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.skipRow}>
        <Pressable onPress={skip} hitSlop={10}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={s => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View
              style={[
                styles.bigDot,
                { backgroundColor: item.accent + '22', borderColor: item.accent },
              ]}
            />
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View
            key={s.key}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <Pressable style={styles.cta} onPress={next}>
        <Text style={styles.ctaText}>
          {index === SLIDES.length - 1 ? 'Get started' : 'Next'}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  skipRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, alignItems: 'flex-end' },
  skipText: { color: colors.textMute, fontSize: fontSize.base, fontWeight: '500' },
  slide: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  bigDot: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  body: {
    color: colors.textDim,
    fontSize: fontSize.lg,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 360,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.bg4,
  },
  dotActive: { backgroundColor: colors.proc, width: 24 },
  cta: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    backgroundColor: colors.proc,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: fontSize.lg, fontWeight: '700' },
});
