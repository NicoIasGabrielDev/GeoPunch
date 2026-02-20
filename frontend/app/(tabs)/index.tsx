import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../../src/contexts/AuthContext';
import { timesheetApi, punchApi, workplaceApi } from '../../src/services/api';
import { StatusCard } from '../../src/components/StatusCard';
import { Button } from '../../src/components/Button';
import { TodayStatus, Workplace, LocationData } from '../../src/types';
import {
  calculateDistance,
  requestLocationPermissions,
  getCurrentLocation,
} from '../../src/utils/location';

interface TodayStatusExtended extends TodayStatus {
  workplace?: {
    clockInWindow?: string;
    clockOutWindow?: string;
  } & Workplace | null;
}

export default function HomeScreen() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [todayStatus, setTodayStatus] = useState<TodayStatusExtended | null>(null);
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [distance, setDistance] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean>(false);
  const [backgroundPermission, setBackgroundPermission] = useState<boolean>(false);
  const [isWorkday, setIsWorkday] = useState<boolean>(true);

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

  // Check if today is a workday
  useEffect(() => {
    if (workplace?.workdays) {
      const dayMap: { [key: number]: keyof typeof workplace.workdays } = {
        0: 'sunday',
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday',
      };
      const today = new Date().getDay();
      setIsWorkday(workplace.workdays[dayMap[today]] || false);
    }
  }, [workplace]);

  const setupLocation = async () => {
    try {
      // Check if location services are available
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        console.log('Location services disabled');
        setLocationPermission(false);
        return;
      }

      const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
      setLocationPermission(foregroundStatus === 'granted');
      
      if (Platform.OS !== 'web') {
        try {
          const { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();
          setBackgroundPermission(backgroundStatus === 'granted');
        } catch (bgError) {
          // Background permissions might not be available in Expo Go
          console.log('Background location check failed:', bgError);
          setBackgroundPermission(false);
        }
      } else {
        setBackgroundPermission(true); // Not applicable on web
      }
      
      if (foregroundStatus === 'granted') {
        updateLocation();
      }
    } catch (error: any) {
      // Handle Expo Go limitation - location permissions not available
      if (error?.message?.includes('NSLocation') || error?.message?.includes('Info.plist')) {
        console.log('Location not available in Expo Go - use development build');
        setLocationPermission(false);
        setBackgroundPermission(false);
      } else {
        console.error('Error checking permissions:', error);
      }
    }
  };

  const requestPermissions = async () => {
    try {
      const granted = await requestLocationPermissions();
      setLocationPermission(granted);
      if (granted) {
        updateLocation();
        await setupLocation();
      }
    } catch (error: any) {
      // Handle Expo Go limitation
      if (error?.message?.includes('NSLocation') || error?.message?.includes('Info.plist')) {
        console.log('Location permissions not available in Expo Go');
        Alert.alert(
          'Limitação do Expo Go',
          'As permissões de localização não estão disponíveis no Expo Go. Para funcionalidade completa, use um development build.',
          [{ text: 'OK' }]
        );
      } else {
        console.error('Error requesting permissions:', error);
      }
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
        workplaceApi.getActive(),
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

  const handleManualPunch = async (punchType: 'IN' | 'OUT') => {
    if (!currentLocation) {
      Alert.alert('Erro', 'Não foi possível obter a sua localização. Por favor, ative a localização.');
      return;
    }

    // Warn about outside geofence but allow punch
    const withinGeofence = distance !== undefined && workplace && distance <= workplace.radiusMeters;
    
    if (!withinGeofence && workplace) {
      Alert.alert(
        'Fora do Local de Trabalho',
        `Está a ${Math.round(distance || 0)}m do local (máximo ${workplace.radiusMeters}m). O registo será marcado como "fora do local". Deseja continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: () => executePunch(punchType) },
        ]
      );
      return;
    }

    if (currentLocation.accuracy > 50) {
      Alert.alert(
        'Precisão GPS baixa',
        `A precisão atual é de ${Math.round(currentLocation.accuracy)}m. O registo pode ser impreciso. Deseja continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: () => executePunch(punchType) },
        ]
      );
      return;
    }

    executePunch(punchType);
  };

  const executePunch = async (punchType: 'IN' | 'OUT') => {
    setActionLoading(punchType);
    try {
      await punchApi.create({
        punchType,
        latitude: currentLocation!.latitude,
        longitude: currentLocation!.longitude,
        accuracy: currentLocation!.accuracy,
        method: 'manual',
      });
      Alert.alert('Sucesso', punchType === 'IN' ? 'Entrada registada' : 'Saída registada');
      await loadData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Erro ao registar';
      Alert.alert('Erro', message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBreak = async (breakType: 'BREAK_START' | 'BREAK_END') => {
    if (!currentLocation) {
      Alert.alert('Erro', 'Não foi possível obter a sua localização');
      return;
    }

    setActionLoading(breakType);
    try {
      await punchApi.create({
        punchType: breakType,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracy: currentLocation.accuracy,
        method: 'manual',
      });
      Alert.alert('Sucesso', breakType === 'BREAK_START' ? 'Pausa iniciada' : 'Pausa terminada');
      await loadData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Erro ao registar';
      Alert.alert('Erro', message);
    } finally {
      setActionLoading(null);
    }
  };

  const renderPermissionDiagnostics = () => {
    if (locationPermission && backgroundPermission) return null;
    
    return (
      <View style={styles.diagnosticsCard}>
        <View style={styles.diagnosticsHeader}>
          <Ionicons name="settings-outline" size={24} color="#1a73e8" />
          <Text style={styles.diagnosticsTitle}>Diagnóstico de Permissões</Text>
        </View>
        
        <View style={styles.permissionRow}>
          <Ionicons 
            name={locationPermission ? "checkmark-circle" : "close-circle"} 
            size={20} 
            color={locationPermission ? "#28a745" : "#dc3545"} 
          />
          <Text style={styles.permissionText}>
            Localização em primeiro plano: {locationPermission ? "Ativa" : "Inativa"}
          </Text>
        </View>
        
        {Platform.OS !== 'web' && (
          <View style={styles.permissionRow}>
            <Ionicons 
              name={backgroundPermission ? "checkmark-circle" : "close-circle"} 
              size={20} 
              color={backgroundPermission ? "#28a745" : "#ffc107"} 
            />
            <Text style={styles.permissionText}>
              Localização em segundo plano: {backgroundPermission ? "Ativa" : "Limitada"}
            </Text>
          </View>
        )}
        
        {!locationPermission && (
          <Button
            title="Ativar Localização"
            onPress={requestPermissions}
            size="small"
            style={{ marginTop: 12 }}
          />
        )}
        
        {!backgroundPermission && Platform.OS !== 'web' && (
          <Text style={styles.permissionHint}>
            Nota: Sem permissão de segundo plano, as notificações de geofence podem não funcionar quando a app está fechada.
          </Text>
        )}
      </View>
    );
  };

  const renderWorkdayWarning = () => {
    if (isWorkday || !workplace) return null;
    
    return (
      <View style={[styles.warningBox, { backgroundColor: '#fff3cd', marginBottom: 16 }]}>
        <Ionicons name="information-circle" size={20} color="#856404" />
        <Text style={[styles.warningText, { color: '#856404' }]}>
          Hoje não é um dia de trabalho configurado para "{workplace.name}"
        </Text>
      </View>
    );
  };

  const renderPunchButtons = () => {
    if (!todayStatus) return null;

    const { status, punchIn, punchOut, breaks } = todayStatus;
    const withinGeofence = distance !== undefined && workplace && distance <= workplace.radiusMeters;
    const hasOpenBreak = breaks?.some(b => b.endedAt === null);

    return (
      <View style={styles.buttonsContainer}>
        {/* Clock In Button */}
        {!punchIn && (
          <Button
            title="Registar Entrada"
            onPress={() => handleManualPunch('IN')}
            loading={actionLoading === 'IN'}
            disabled={!locationPermission}
            variant="success"
            style={styles.actionButton}
          />
        )}

        {/* Clock Out Button */}
        {punchIn && !punchOut && (
          <Button
            title="Registar Saída"
            onPress={() => handleManualPunch('OUT')}
            loading={actionLoading === 'OUT'}
            disabled={!locationPermission || hasOpenBreak}
            variant="danger"
            style={styles.actionButton}
          />
        )}

        {/* Break Buttons */}
        {punchIn && !punchOut && !hasOpenBreak && (
          <Button
            title="Iniciar Pausa"
            onPress={() => handleBreak('BREAK_START')}
            loading={actionLoading === 'BREAK_START'}
            disabled={!locationPermission}
            variant="secondary"
            style={styles.actionButton}
          />
        )}

        {punchIn && !punchOut && hasOpenBreak && (
          <Button
            title="Terminar Pausa"
            onPress={() => handleBreak('BREAK_END')}
            loading={actionLoading === 'BREAK_END'}
            disabled={!locationPermission}
            variant="secondary"
            style={styles.actionButton}
          />
        )}

        {/* Location warnings */}
        {!withinGeofence && workplace && locationPermission && (
          <View style={styles.warningBox}>
            <Ionicons name="warning" size={20} color="#ffc107" />
            <Text style={styles.warningText}>
              Está fora da área do local de trabalho ({Math.round(distance || 0)}m de distância, máximo {workplace.radiusMeters}m)
            </Text>
          </View>
        )}
        
        {currentLocation && currentLocation.accuracy > 30 && (
          <View style={[styles.warningBox, { backgroundColor: '#e3f2fd' }]}>
            <Ionicons name="locate" size={20} color="#1a73e8" />
            <Text style={[styles.warningText, { color: '#1a73e8' }]}>
              Precisão GPS: {Math.round(currentLocation.accuracy)}m
            </Text>
          </View>
        )}
      </View>
    );
  };

  // No active workplace - prompt to configure
  if (!workplace && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noWorkplaceContainer}>
          <Ionicons name="business-outline" size={64} color="#ccc" />
          <Text style={styles.noWorkplaceTitle}>Sem Local de Trabalho</Text>
          <Text style={styles.noWorkplaceText}>
            Configure um local de trabalho para começar a registar ponto.
          </Text>
          <Button
            title="Configurar Local"
            onPress={() => router.push('/(tabs)/workplaces')}
            style={{ marginTop: 20 }}
          />
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

        {renderPermissionDiagnostics()}
        {renderWorkdayWarning()}

        {/* Active workplace card */}
        {workplace && (
          <TouchableOpacity 
            style={styles.workplaceCard}
            onPress={() => router.push('/(tabs)/workplaces')}
          >
            <View style={styles.workplaceCardContent}>
              <View style={styles.workplaceIcon}>
                <Ionicons name="business" size={24} color="#1a73e8" />
              </View>
              <View style={styles.workplaceInfo}>
                <Text style={styles.workplaceLabel}>Local Ativo</Text>
                <Text style={styles.workplaceName}>{workplace.name}</Text>
                {workplace.schedule && (
                  <Text style={styles.workplaceSchedule}>
                    {workplace.schedule.startTime} - {workplace.schedule.endTime}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </View>
          </TouchableOpacity>
        )}

        {todayStatus && (
          <StatusCard
            status={todayStatus.status}
            workplaceName={workplace?.name}
            distance={distance}
            clockIn={todayStatus.punchIn?.occurredAt}
            clockOut={todayStatus.punchOut?.occurredAt}
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
                {todayStatus.punchIn
                  ? new Date(todayStatus.punchIn.occurredAt).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
                {todayStatus.punchIn?.outsideWorkplace && (
                  <Text style={styles.outsideTag}> (fora do local)</Text>
                )}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="time" size={20} color="#ffc107" />
              <Text style={styles.detailLabel}>Pausas:</Text>
              <Text style={styles.detailValue}>
                {todayStatus.breakMinutes > 0 
                  ? `${Math.floor(todayStatus.breakMinutes / 60)}h ${todayStatus.breakMinutes % 60}min`
                  : '--:--'}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="log-out" size={20} color="#dc3545" />
              <Text style={styles.detailLabel}>Saída:</Text>
              <Text style={styles.detailValue}>
                {todayStatus.punchOut
                  ? new Date(todayStatus.punchOut.occurredAt).toLocaleTimeString('pt-PT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--:--'}
                {todayStatus.punchOut?.outsideWorkplace && (
                  <Text style={styles.outsideTag}> (fora do local)</Text>
                )}
              </Text>
            </View>

            <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="hourglass" size={20} color="#1a73e8" />
              <Text style={styles.detailLabel}>Total:</Text>
              <Text style={[styles.detailValue, { fontWeight: '700', color: '#1a73e8' }]}>
                {todayStatus.netWorkedFormatted}
              </Text>
            </View>
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
  diagnosticsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#1a73e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  diagnosticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  diagnosticsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  permissionText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  permissionHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    fontStyle: 'italic',
  },
  workplaceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  workplaceCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  workplaceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e3f2fd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  workplaceInfo: {
    flex: 1,
  },
  workplaceLabel: {
    fontSize: 12,
    color: '#999',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  workplaceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  workplaceSchedule: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
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
  outsideTag: {
    fontSize: 12,
    color: '#dc3545',
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
