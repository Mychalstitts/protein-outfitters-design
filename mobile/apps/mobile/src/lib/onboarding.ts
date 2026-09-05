import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'po:onboarded:v1';

export async function hasOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, 'true');
  } catch {
    // No-op if storage is unavailable
  }
}
