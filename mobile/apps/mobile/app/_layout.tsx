import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { colors } from '@protein-outfitters/shared';
import { hasOnboarded } from '@/lib/onboarding';

export default function RootLayout() {
  const [routed, setRouted] = useState(false);

  useEffect(() => {
    (async () => {
      const seen = await hasOnboarded();
      if (!seen) router.replace('/onboarding');
      setRouted(true);
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg0 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* Render a black canvas before the route decision lands so we don't
            flash the home screen for a frame on a fresh install */}
        {!routed ? <View style={{ flex: 1, backgroundColor: colors.bg0 }} /> : null}
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg0 },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg0 },
          }}
        >
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'Protein Outfitters' }} />
          <Stack.Screen name="map" options={{ title: 'Find a Processor' }} />
          <Stack.Screen
            name="processor/[slug]"
            options={{ title: 'Processor', presentation: 'card' }}
          />
          <Stack.Screen
            name="request/[slug]"
            options={{ title: 'Request Service', presentation: 'modal' }}
          />
          <Stack.Screen
            name="claim/[slug]"
            options={{ title: 'Claim Listing', presentation: 'modal' }}
          />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="auth/callback" options={{ title: 'Signing in', headerShown: false }} />
          <Stack.Screen name="legal/privacy" options={{ title: 'Privacy Policy' }} />
          <Stack.Screen name="legal/terms" options={{ title: 'Terms of Service' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
