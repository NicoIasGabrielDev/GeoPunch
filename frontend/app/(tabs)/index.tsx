import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { isScreenshotSeedEnabled } from '../../src/config/appMode';
import { useAuth } from '../../src/contexts/AuthContext';
import { screenshotSeedService } from '../../src/demo/screenshotSeed';
import {
  ensureBackendReady,
  timesheetService,
  punchService,
  workplaceService,
} from '../../src/services/backend';
import { StatusCard } from '../../src/components/StatusCard';
import { Button } from '../../src/components/Button';
import { TodayStatus, Workplace, LocationData } from '../../src/types';
import { getHumanReadableError } from '../../src/utils/network';
import {
  calculateDistance,
  requestLocationPermissions,
  getCurrentLocation,
} from '../../src/utils/location';

interface TodayStatusExtended extends Omit<TodayStatus, 'workplace'> {
  workplace: (({ clockInWindow?: string; clockOutWindow?: string }) & Workplace) | null;
}

export default function HomeScreen() {
  const { user, refreshUser, isAuthenticated } = useAuth();
  const router = useRouter();
  const [todayStatus, setTodayStatus] = useState<TodayStatusExtended | null>(null);
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [distance, setDistance] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean>(false);

  const isEnterpriseOwner = user?.role === 'enterprise_owner';

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        if (isEnterpriseOwner) {
          setLoading(false);
        } else {
          loadData();
        }
      } else {
        setLoading(false);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, isEnterpriseOwner])
  );

  useEffect(() => {
    if (!isEnterpriseOwner) {
      setupLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnterpriseOwner]);

  useEffect(() => {
    if (currentLocation && workplace) {
      setDistance(calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        workplace.latitude,
        workplace.longitude,
      ));
    }
  }, [currentLocation, workplace]);

  const setupLocation = async () => {
    if (isScreenshotSeedEnabled) {
      setLocationPermission(true);
      setCurrentLocation(screenshotSeedService.getCurrentLocation());
      return;
    }

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationPermission(false);
        return;
      }

      const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
      setLocationPermission(foregroundStatus === 'granted');
      if (foregroundStatus === 'granted') {
        updateLocation();
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
      setLocationPermission(false);
    }
  };

  const requestPermissions = async () => {
    try {
      const granted = await requestLocationPermissions();
      setLocationPermission(granted);
      if (granted) {
        updateLocation();
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
    }
  };

  const updateLocation = async () => {
    if (isScreenshotSeedEnabled) {
      setCurrentLocation(screenshotSeedService.getCurrentLocation());
      return;
    }

    const location = await getCurrentLocation();
    if (location) {
      setCurrentLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || 0,
      });
    }
  };

  const loadData = async () => {
    if (!isAuthenticated || isEnterpriseOwner) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      await ensureBackendReady();
      const [statusData, workplaceData] = await Promise.all([
        timesheetService.getTodayStatus(),
        workplaceService.getActive(),
      ]);
      setTodayStatus(statusData ?? null);
      setWorkplace(statusData?.workplace ?? workplaceData ?? null);
      await updateLocation();
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (!isEnterpriseOwner) {
      await loadData();
    }
    await refreshUser();
    setRefreshing(false);
  };

  const executePunch = async (punchType: 'IN' | 'OUT') => {
    setActionLoading(punchType);
    try {
      await punchService.create({
        punchType,
        latitude: currentLocation!.latitude,
        longitude: currentLocation!.longitude,
        accuracy: currentLocation!.accuracy,
        method: 'MANUAL',
      });
      Alert.alert('Sucesso', punchType === 'IN' ? 'Entrada registada' : 'Saída registada');
      await loadData();
    } catch (error: any) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Erro ao registar',
        service: 'backend',
      }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleManualPunch = async (punchType: 'IN' | 'OUT') => {
    if (!currentLocation) {
      Alert.alert('Erro', 'Não foi possível obter a sua localização.');
      return;
    }

    const withinGeofence = distance !== undefined && workplace && distance <= workplace.radiusMeters;
    if (!withinGeofence && workplace) {
      Alert.alert(
        'Fora do Local de Trabalho',
        `Está a ${Math.round(distance || 0)}m do local. Deseja continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: () => executePunch(punchType) },
        ],
      );
      return;
    }

    executePunch(punchType);
  };

  const handleBreak = async (breakType: 'BREAK_START' | 'BREAK_END') => {
    if (!currentLocation) {
      Alert.alert('Erro', 'Não foi possível obter a sua localização');
      return;
    }

    setActionLoading(breakType);
    try {
      await punchService.create({
        punchType: breakType,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracy: currentLocation.accuracy,
        method: 'MANUAL',
      });
      Alert.alert('Sucesso', breakType === 'BREAK_START' ? 'Pausa iniciada' : 'Pausa terminada');
      await loadData();
    } catch (error: any) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Erro ao registar',
        service: 'backend',
      }));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </SafeAreaView>
    );
  }

  if (isEnterpriseOwner) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />}
        >
          <View style={styles.enterpriseHero}>
            <Ionicons name="business" size={36} color="#1a73e8" />
            <Text style={styles.enterpriseTitle}>{user?.enterpriseName || 'Conta empresa'}</Text>
            <Text style={styles.enterpriseSubtitle}>
              Use esta conta para gerir funcionários, convites e locais de trabalho.
            </Text>
            <Button title="Abrir Gestão da Empresa" onPress={() => router.push('/(tabs)/admin')} style={{ marginTop: 16 }} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />}
      >
        {!locationPermission && (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>Localização desativada</Text>
            <Text style={styles.permissionText}>
              Ative a localização para registar pontos com georreferência.
            </Text>
            <Button title="Ativar Localização" onPress={requestPermissions} size="small" />
          </View>
        )}

        {todayStatus && workplace && (
          <StatusCard
            status={todayStatus.status}
            clockIn={todayStatus.punchIn?.occurredAt}
            clockOut={todayStatus.punchOut?.occurredAt}
            netWorkedFormatted={todayStatus.netWorkedFormatted}
            workplaceName={workplace.name}
            distance={distance}
          />
        )}

        <View style={styles.actionsCard}>
          <Text style={styles.actionsTitle}>Ações rápidas</Text>
          <View style={styles.actionsRow}>
            <Button
              title="Entrada"
              onPress={() => handleManualPunch('IN')}
              loading={actionLoading === 'IN'}
              style={styles.actionButton}
            />
            <Button
              title="Saída"
              onPress={() => handleManualPunch('OUT')}
              loading={actionLoading === 'OUT'}
              variant="danger"
              style={styles.actionButton}
            />
          </View>
          <View style={styles.actionsRow}>
            <Button
              title="Iniciar Pausa"
              onPress={() => handleBreak('BREAK_START')}
              loading={actionLoading === 'BREAK_START'}
              variant="secondary"
              style={styles.actionButton}
            />
            <Button
              title="Terminar Pausa"
              onPress={() => handleBreak('BREAK_END')}
              loading={actionLoading === 'BREAK_END'}
              variant="success"
              style={styles.actionButton}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  content: { padding: 16 },
  enterpriseHero: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  enterpriseTitle: { fontSize: 24, fontWeight: '700', color: '#111827', marginTop: 12 },
  enterpriseSubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 8 },
  permissionCard: { backgroundColor: '#fff7ed', borderRadius: 12, padding: 16, marginBottom: 16 },
  permissionTitle: { fontSize: 16, fontWeight: '700', color: '#9a3412', marginBottom: 6 },
  permissionText: { fontSize: 14, color: '#9a3412', marginBottom: 12 },
  actionsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  actionsTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 12 },
  actionsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  actionButton: { flex: 1 },
});
