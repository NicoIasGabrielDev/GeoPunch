import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../../src/contexts/AuthContext';
import { timesheetApi, eventsApi, workplaceApi } from '../../src/services/api';
import { StatusCard } from '../../src/components/StatusCard';
import { Button } from '../../src/components/Button';
import { TodayStatus, Workplace, LocationData } from '../../src/types';
import {
  calculateDistance,
  requestLocationPermissions,
  getCurrentLocation,
  generateEventId,
} from '../../src/utils/location';

export default function HomeScreen() {
  const { user, refreshUser } = useAuth();
  const [todayStatus, setTodayStatus] = useState<TodayStatus | null>(null);
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [distance, setDistance] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean>(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  useEffect(() => {
    setupLocation();
  }, []);

  useEffect(() => {
    if (currentLocation && workplace) {
      const dist = calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        workplace.latitude,
        workplace.longitude
      );
      setDistance(dist);
    }
  }, [currentLocation, workplace]);

  const setupLocation = async () => {
    const granted = await requestLocationPermissions();
    setLocationPermission(granted);
    if (granted) {
      updateLocation();
    }
  };

  const updateLocation = async () => {
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
    try {
      setLoading(true);
      const [statusRes, workplaceRes] = await Promise.all([
        timesheetApi.getTodayStatus(),
        workplaceApi.getUserWorkplace(),
      ]);
      setTodayStatus(statusRes.data);
      setWorkplace(statusRes.data.workplace || workplaceRes.data);
      await updateLocation();
    } catch (error: any) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    await refreshUser();
    setRefreshing(false);
  };

  const handleManualPunch = async (punchType: 'CLOCK_IN' | 'CLOCK_OUT') => {
    if (!currentLocation) {
      Alert.alert('Erro', 'Não foi possível obter a sua localização');
      return;
    }

    if (currentLocation.accuracy > 50) {
      Alert.alert(
        'Precisão GPS baixa',
        `A precisão atual é de ${Math.round(currentLocation.accuracy)}m. Deseja continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: () => executePunch(punchType) },
        ]
      );
      return;
    }

    executePunch(punchType);
  };

  const executePunch = async (punchType: 'CLOCK_IN' | 'CLOCK_OUT') => {
    setActionLoading(punchType);
    try {
      const response = await eventsApi.manualPunch({
        punchType,
        latitude: currentLocation!.latitude,
        longitude: currentLocation!.longitude,
        accuracy: currentLocation!.accuracy,
      });
      Alert.alert('Sucesso', response.data.message);
      await loadData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Erro ao registar';
      Alert.alert('Erro', message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleLunchBreak = async (breakType: 'LUNCH_START' | 'LUNCH_END') => {
    if (!currentLocation) {
      Alert.alert('Erro', 'Não foi possível obter a sua localização');
      return;
    }

    setActionLoading(breakType);
    try {
      const response = await eventsApi.manualBreak({
        breakType,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracy: currentLocation.accuracy,
      });
      Alert.alert('Sucesso', response.data.message);
      await loadData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Erro ao registar';
      Alert.alert('Erro', message);
    } finally {
      setActionLoading(null);
    }
  };

  const renderPunchButtons = () => {
    if (!todayStatus) return null;

    const { status, clockIn, clockOut, lunchStart, lunchEnd } = todayStatus;
    const withinGeofence = distance !== undefined && workplace && distance <= workplace.radiusMeters;

    return (
      <View style={styles.buttonsContainer}>
        {/* Clock In/Out Buttons */}
        {!clockIn && (
          <Button
            title="Registar Entrada"
            onPress={() => handleManualPunch('CLOCK_IN')}
            loading={actionLoading === 'CLOCK_IN'}
            disabled={!withinGeofence}
            variant="success"
            style={styles.actionButton}
          />
        )}

        {clockIn && !clockOut && (
          <Button
            title="Registar Saída"
            onPress={() => handleManualPunch('CLOCK_OUT')}
            loading={actionLoading === 'CLOCK_OUT'}
            disabled={!withinGeofence}
            variant="danger"
            style={styles.actionButton}
          />
        )}

        {/* Lunch Buttons */}
        {clockIn && !clockOut && !lunchStart && (
          <Button
            title="Início de Almoço"
            onPress={() => handleLunchBreak('LUNCH_START')}
            loading={actionLoading === 'LUNCH_START'}
            variant="secondary"
            style={styles.actionButton}
          />
        )}

        {clockIn && !clockOut && lunchStart && !lunchEnd && (
          <Button
            title="Fim de Almoço"
            onPress={() => handleLunchBreak('LUNCH_END')}
            loading={actionLoading === 'LUNCH_END'}
            variant="secondary"
            style={styles.actionButton}
          />
        )}

        {!withinGeofence && workplace && (
          <View style={styles.warningBox}>
            <Ionicons name="warning" size={20} color="#ffc107" />
            <Text style={styles.warningText}>
              Está fora da área do local de trabalho ({Math.round(distance || 0)}m de distância)
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (!user?.workplaceId && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noWorkplaceContainer}>
          <Ionicons name="business" size={64} color="#ccc" />
          <Text style={styles.noWorkplaceTitle}>Sem Local de Trabalho</Text>
          <Text style={styles.noWorkplaceText}>
            Contacte o administrador para que lhe seja atribuído um local de trabalho.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>Olá, {user?.name?.split(' ')[0]}!</Text>
          <Text style={styles.date}>
            {new Date().toLocaleDateString('pt-PT', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
        </View>

        {!locationPermission && (
          <View style={styles.permissionWarning}>
            <Ionicons name="location-outline" size={24} color="#dc3545" />
            <Text style={styles.permissionText}>
              Permissão de localização necessária para o funcionamento da app
            </Text>
            <Button
              title="Ativar"
              onPress={setupLocation}
              size="small"
              style={{ marginTop: 8 }}
            />
          </View>
        )}

        {todayStatus && (
          <StatusCard
            status={todayStatus.status}
            workplaceName={workplace?.name}
            distance={distance}
            clockIn={todayStatus.clockIn}
            clockOut={todayStatus.clockOut}
            netWorkedFormatted={todayStatus.netWorkedFormatted}
          />
        )}

        {todayStatus && (
          <View style={styles.detailsCard}>
            <Text style={styles.detailsTitle}>Detalhes de Hoje</Text>
            
            <View style={styles.detailRow}>
              <Ionicons name="log-in" size={20} color="#28a745" />
              <Text style={styles.detailLabel}>Entrada:</Text>
              <Text style={styles.detailValue}>
                {todayStatus.clockIn
                  ? new Date(todayStatus.clockIn).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
                {todayStatus.clockInMethod && (
                  <Text style={styles.methodTag}> ({todayStatus.clockInMethod})</Text>
                )}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="restaurant" size={20} color="#ffc107" />
              <Text style={styles.detailLabel}>Almoço:</Text>
              <Text style={styles.detailValue}>
                {todayStatus.lunchStart
                  ? new Date(todayStatus.lunchStart).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
                {' - '}
                {todayStatus.lunchEnd
                  ? new Date(todayStatus.lunchEnd).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="log-out" size={20} color="#dc3545" />
              <Text style={styles.detailLabel}>Saída:</Text>
              <Text style={styles.detailValue}>
                {todayStatus.clockOut
                  ? new Date(todayStatus.clockOut).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
                {todayStatus.clockOutMethod && (
                  <Text style={styles.methodTag}> ({todayStatus.clockOutMethod})</Text>
                )}
              </Text>
            </View>

            {todayStatus.breakMinutes > 0 && (
              <View style={styles.detailRow}>
                <Ionicons name="time" size={20} color="#6c757d" />
                <Text style={styles.detailLabel}>Pausa:</Text>
                <Text style={styles.detailValue}>
                  {Math.floor(todayStatus.breakMinutes / 60)}h {todayStatus.breakMinutes % 60}min
                </Text>
              </View>
            )}
          </View>
        )}

        {renderPunchButtons()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 20,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  date: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    textTransform: 'capitalize',
  },
  permissionWarning: {
    backgroundColor: '#fff3cd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  permissionText: {
    color: '#856404',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
    marginLeft: 10,
    width: 70,
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 1,
  },
  methodTag: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  buttonsContainer: {
    marginTop: 20,
  },
  actionButton: {
    marginBottom: 12,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  warningText: {
    color: '#856404',
    marginLeft: 8,
    flex: 1,
    fontSize: 13,
  },
  noWorkplaceContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noWorkplaceTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
  },
  noWorkplaceText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
});
