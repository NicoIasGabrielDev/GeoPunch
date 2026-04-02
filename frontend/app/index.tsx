import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>GeoPunch</Text>
        <Text style={styles.subtitle}>Controlo de Ponto Inteligente</Text>
      </View>
      <ActivityIndicator size="large" color="#1a73e8" style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#dbeafb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1a73e8',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  loader: {
    marginTop: 20,
  },
});
