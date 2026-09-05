import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  spacing,
  fontSize,
  radius,
  filterProcessors,
  formatDistance,
  distance as haversine,
  type Processor,
  type ProcessorFilters,
} from '@protein-outfitters/shared';
import {
  loadBundledProcessors,
  loadProcessors,
  type DataSource,
} from '@/lib/processors';
import { FilterSheet } from '@/components/FilterSheet';

const DEFAULT_REGION = {
  latitude: 39.8283,
  longitude: -98.5795,
  latitudeDelta: 30,
  longitudeDelta: 50,
};

export default function MapScreen() {
  // Render bundled data instantly on mount — no spinner on first paint.
  const [processors, setProcessors] = useState<Processor[]>(() =>
    loadBundledProcessors(),
  );
  const [source, setSource] = useState<DataSource>('bundled');
  const [loading, setLoading] = useState(true);
  const [softError, setSoftError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [filters, setFilters] = useState<ProcessorFilters>({});
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const activeFilterCount =
    (filters.states?.length ?? 0) +
    (filters.services?.length ?? 0) +
    (filters.claimStatus && filters.claimStatus !== 'any' ? 1 : 0) +
    (filters.hasPhone ? 1 : 0);

  // Try server data; if it fails, we still have bundled.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadProcessors();
      if (cancelled) return;
      setProcessors(result.processors);
      setSource(result.source);
      if (result.error) setSoftError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Location is opt-in. Permission denied is fine — we just don't sort.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({});
        setUserLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        // Location unavailable on simulator without a config — silent.
      }
    })();
  }, []);

  const visible = useMemo(() => {
    let list = filterProcessors(processors, { ...filters, query });
    if (userLoc) {
      list = [...list].sort(
        (a, b) =>
          haversine(userLoc, { lat: a.lat, lng: a.lng }) -
          haversine(userLoc, { lat: b.lat, lng: b.lng }),
      );
    }
    return list;
  }, [processors, query, filters, userLoc]);

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <View style={styles.searchBar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, city, or service"
          placeholderTextColor={colors.textMute}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <Pressable
          onPress={() => setFilterSheetOpen(true)}
          style={[
            styles.toggleBtn,
            { paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.bg4, borderRadius: radius.lg, backgroundColor: colors.bg2 },
            activeFilterCount > 0 && { backgroundColor: colors.procDeep, borderColor: colors.proc },
          ]}
          accessibilityLabel="Filters"
        >
          <Text style={styles.toggleText}>
            Filter{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </Text>
        </Pressable>
        <View style={styles.viewToggle}>
          <Pressable
            onPress={() => setView('map')}
            style={[styles.toggleBtn, view === 'map' && styles.toggleBtnActive]}
            accessibilityLabel="Map view"
          >
            <Text style={styles.toggleText}>Map</Text>
          </Pressable>
          <Pressable
            onPress={() => setView('list')}
            style={[styles.toggleBtn, view === 'list' && styles.toggleBtnActive]}
            accessibilityLabel="List view"
          >
            <Text style={styles.toggleText}>List</Text>
          </Pressable>
        </View>
      </View>

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        filters={filters}
        onChange={setFilters}
        processors={processors}
      />

      {view === 'map' ? (
        <MapView
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFillObject}
          initialRegion={
            userLoc
              ? {
                  latitude: userLoc.lat,
                  longitude: userLoc.lng,
                  latitudeDelta: 1.5,
                  longitudeDelta: 1.5,
                }
              : DEFAULT_REGION
          }
          showsUserLocation
          showsMyLocationButton
          customMapStyle={DARK_MAP_STYLE}
        >
          {visible.map(p => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.name}
              description={p.address.full ?? undefined}
              pinColor={p.role === 'processor' ? colors.proc : colors.sup}
              onCalloutPress={() => router.push(`/processor/${p.slug}`)}
            />
          ))}
        </MapView>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={p => p.id}
          contentContainerStyle={
            visible.length === 0
              ? styles.emptyContent
              : { padding: spacing.md, gap: spacing.sm }
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/processor/${item.slug}`)}
              style={styles.card}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardMeta}>
                  {item.address.city ?? ''}
                  {item.address.state ? `, ${item.address.state}` : ''}
                </Text>
                {item.services.length > 0 ? (
                  <Text style={styles.cardServices} numberOfLines={1}>
                    {item.services.join(' · ')}
                  </Text>
                ) : null}
              </View>
              {userLoc ? (
                <Text style={styles.distance}>
                  {formatDistance(
                    haversine(userLoc, { lat: item.lat, lng: item.lng }),
                  )}
                </Text>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={
            query ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyBody}>
                  Try a different name, city, or service.
                </Text>
                <Pressable
                  onPress={() => setQuery('')}
                  style={styles.emptyBtn}
                >
                  <Text style={styles.emptyBtnText}>Clear search</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.proc} />
                <Text style={styles.emptyBody}>Loading processors…</Text>
              </View>
            )
          }
        />
      )}

      <View style={styles.statusBar}>
        <View
          style={styles.statusDot(
            source === 'api' ? 'live' : 'cached',
          )}
        />
        <Text style={styles.statusText}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>
            {visible.length}
          </Text>
          {' shown · '}
          <Text style={{ color: colors.text, fontWeight: '700' }}>
            {processors.length}
          </Text>
          {source === 'bundled' ? ' cached' : ' live'}
          {loading ? ' · syncing…' : ''}
        </Text>
      </View>

      {softError ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{softError}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1f2a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#aab2c0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1115' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1115' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#222936' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2a3140' }] },
];

const baseStyles = {
  root: { flex: 1, backgroundColor: colors.bg0 },
  searchBar: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bg1,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.bg2,
    color: colors.text,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.bg4,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.base,
  },
  viewToggle: {
    flexDirection: 'row' as const,
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.bg4,
    overflow: 'hidden' as const,
  },
  toggleBtn: { paddingHorizontal: spacing.md, justifyContent: 'center' as const },
  toggleBtnActive: { backgroundColor: colors.bg3 },
  toggleText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' as const },
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardName: { color: colors.text, fontSize: fontSize.base, fontWeight: '600' as const },
  cardMeta: { color: colors.textDim, fontSize: fontSize.sm, marginTop: 2 },
  cardServices: { color: colors.textMute, fontSize: fontSize.sm, marginTop: 4 },
  distance: { color: colors.procLight, fontSize: fontSize.sm, fontWeight: '600' as const },
  emptyContent: { flex: 1, justifyContent: 'center' as const },
  empty: {
    alignItems: 'center' as const,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' as const },
  emptyBody: { color: colors.textMute, fontSize: fontSize.base, textAlign: 'center' as const },
  emptyBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  emptyBtnText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' as const },
  statusBar: {
    position: 'absolute' as const,
    bottom: spacing.lg,
    alignSelf: 'center' as const,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.bg4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  statusText: { color: colors.textDim, fontSize: fontSize.sm },
  toast: {
    position: 'absolute' as const,
    top: 80,
    alignSelf: 'center' as const,
    maxWidth: '90%' as const,
    backgroundColor: colors.bg2,
    borderColor: colors.warn,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  toastText: { color: colors.text, fontSize: fontSize.sm },
};

const styles = {
  ...StyleSheet.create(baseStyles),
  statusDot: (kind: 'live' | 'cached') => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: kind === 'live' ? colors.proc : colors.hw,
  }),
};
