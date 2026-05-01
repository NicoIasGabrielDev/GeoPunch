import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/contexts/AuthContext';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [allowFallback, setAllowFallback] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAllowFallback(true);
    }, 3500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)');
      return;
    }

    if (!isLoading && allowFallback) {
      router.replace('/(auth)/login');
    }
  }, [allowFallback, isAuthenticated, isLoading, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark-outline" size={34} color="#1a73e8" />
        </View>
        <Text style={styles.title}>A concluir login</Text>
        <Text style={styles.subtitle}>
          Estamos a validar a sessão e a preparar a sua conta.
        </Text>
        <ActivityIndicator size="large" color="#1a73e8" style={styles.loader} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#edf3f9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#15315d',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#ebf3ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#12233f',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5b6b8c',
    textAlign: 'center',
    marginTop: 10,
  },
  loader: {
    marginTop: 22,
  },
});
