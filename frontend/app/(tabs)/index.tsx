import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { isScreenshotSeedEnabled } from '@/src/config/appMode';
import { useAuth } from '@/src/contexts/AuthContext';
import { screenshotSeedService } from '@/src/demo/screenshotSeed';
import {
  ensureBackendReady,
  timesheetService,
  punchService,
  workplaceService,
} from '@/src/services/backend';
import { StatusCard } from '@/src/components/StatusCard';
import { Button } from '@/src/components/Button';
import { TodayStatus, Workplace, LocationData } from '@/src/types';
import { getHumanReadableError } from '@/src/utils/network';
import {
  calculateDistance,
  requestLocationPermissions,
  getCurrentLocation,
} from '@/src/utils/location';

interface TodayStatusExtended extends Omit<TodayStatus, 'workplace'> {
  workplace: (({ clockInWindow?: string; clockOutWindow?: string }) & Workplace) | null;
}

type QuickAction = {
  key: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'primary' | 'danger' | 'neutral' | 'success';
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
};

const formatSchedule = (workplace?: Workplace | null) => {
  if (!workplace?.schedule) {
    return 'Sem horário definido';
  }

  return `${workplace.schedule.startTime} - ${workplace.schedule.endTime}`;
};

const getStatusAccent = (status?: TodayStatus['status']) => {
  switch (status) {
    case 'working':
      return {
        badge: 'Em trabalho',
        label: 'Jornada em curso',
        description: 'Pode iniciar pausa ou fechar o turno quando terminar.',
        color: '#1c9b63',
        soft: '#e9fff4',
        icon: 'briefcase' as const,
      };
    case 'on_break':
      return {
        badge: 'Em pausa',
        label: 'Pausa ativa',
        description: 'Retome a jornada antes de sair para manter o registo consistente.',
        color: '#c88511',
        soft: '#fff6de',
        icon: 'cafe' as const,
      };
    case 'finished':
      return {
        badge: 'Concluído',
        label: 'Dia fechado',
        description: 'Os principais registos de hoje já estão concluídos.',
        color: '#1a73e8',
        soft: '#ebf3ff',
        icon: 'checkmark-circle' as const,
      };
    case 'not_started':
    default:
      return {
        badge: 'Pronto',
        label: 'Aguardando entrada',
        description: 'Assim que estiver pronto, registe a entrada para começar o dia.',
        color: '#5b6b8c',
        soft: '#eef3ff',
        icon: 'time-outline' as const,
      };
  }
};

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadDataRequestId = useRef(0);

  const isEnterpriseOwner = user?.role === 'enterprise_owner';
  const todayLabel = new Date().toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  const currentStatus = todayStatus?.status ?? 'not_started';
  const statusAccent = getStatusAccent(currentStatus);
  const withinGeofence =
    distance !== undefined && workplace ? distance <= workplace.radiusMeters : undefined;
  const canPunchIn = !!workplace && currentStatus === 'not_started';
  const canPunchOut =
    !!workplace && (currentStatus === 'working' || currentStatus === 'on_break');
  const canStartBreak = !!workplace && currentStatus === 'working';
  const canEndBreak = !!workplace && currentStatus === 'on_break';

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
      return () => {
        loadDataRequestId.current += 1;
      };
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
    const requestId = ++loadDataRequestId.current;

    if (!isAuthenticated || isEnterpriseOwner) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError(null);
      await ensureBackendReady();
      const [statusData, workplaceData] = await Promise.all([
        timesheetService.getTodayStatus(),
        workplaceService.getActive(),
      ]);
      if (loadDataRequestId.current !== requestId) return;
      setTodayStatus(statusData ?? null);
      setWorkplace(statusData?.workplace ?? workplaceData ?? null);
      await updateLocation();
    } catch (error) {
      console.error('Error loading data:', error);
      if (loadDataRequestId.current === requestId) {
        setLoadError(getHumanReadableError(error, {
          defaultMessage: 'Não foi possível atualizar os dados. Verifique a ligação e tente novamente.',
          service: 'backend',
        }));
      }
    } finally {
      if (loadDataRequestId.current === requestId) {
        setLoading(false);
      }
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

    if (!workplace) {
      Alert.alert('Sem local ativo', 'Ative um local de trabalho antes de registar pontos.');
      return;
    }

    if (punchType === 'IN' && !canPunchIn) {
      Alert.alert('Ação indisponível', 'A entrada já foi registada ou o dia já foi concluído.');
      return;
    }

    if (punchType === 'OUT' && !canPunchOut) {
      Alert.alert('Ação indisponível', 'A saída só fica disponível após uma entrada válida.');
      return;
    }

    if (withinGeofence === false) {
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

    if (!workplace) {
      Alert.alert('Sem local ativo', 'Ative um local de trabalho antes de registar pausas.');
      return;
    }

    if (breakType === 'BREAK_START' && !canStartBreak) {
      Alert.alert('Ação indisponível', 'Só pode iniciar pausa quando estiver em trabalho.');
      return;
    }

    if (breakType === 'BREAK_END' && !canEndBreak) {
      Alert.alert('Ação indisponível', 'Não existe nenhuma pausa ativa para terminar.');
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

  const quickActions: QuickAction[] = [
    {
      key: 'IN',
      title: 'Registar entrada',
      subtitle: canPunchIn ? 'Inicie a jornada' : 'Disponível quando ainda não iniciou o dia',
      icon: 'log-in-outline',
      tone: 'primary',
      disabled: !canPunchIn,
      loading: actionLoading === 'IN',
      onPress: () => handleManualPunch('IN'),
    },
    {
      key: 'OUT',
      title: 'Registar saída',
      subtitle: canPunchOut ? 'Feche a jornada' : 'Disponível após entrada válida',
      icon: 'log-out-outline',
      tone: 'danger',
      disabled: !canPunchOut,
      loading: actionLoading === 'OUT',
      onPress: () => handleManualPunch('OUT'),
    },
    {
      key: 'BREAK_START',
      title: 'Iniciar pausa',
      subtitle: canStartBreak ? 'Abra uma pausa' : 'Disponível enquanto está em trabalho',
      icon: 'cafe-outline',
      tone: 'neutral',
      disabled: !canStartBreak,
      loading: actionLoading === 'BREAK_START',
      onPress: () => handleBreak('BREAK_START'),
    },
    {
      key: 'BREAK_END',
      title: 'Terminar pausa',
      subtitle: canEndBreak ? 'Retome a jornada' : 'Disponível apenas com pausa ativa',
      icon: 'play-circle-outline',
      tone: 'success',
      disabled: !canEndBreak,
      loading: actionLoading === 'BREAK_END',
      onPress: () => handleBreak('BREAK_END'),
    },
  ];

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
        <View style={styles.heroCard}>
          <View style={styles.heroBackgroundBubble} />
          <View style={styles.heroBackgroundBubbleSecondary} />

          <View style={styles.heroTopRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>Painel diário</Text>
              <Text style={styles.heroTitle}>
                Olá, {user?.name?.split(' ')[0] || 'utilizador'}
              </Text>
              <Text style={styles.heroSubtitle}>
                {todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}
              </Text>
            </View>
            <View style={[styles.heroStatusIcon, { backgroundColor: statusAccent.soft }]}>
              <Ionicons name={statusAccent.icon} size={24} color={statusAccent.color} />
            </View>
          </View>

          <View style={[styles.heroStatusStrip, { backgroundColor: statusAccent.soft }]}>
            <View>
              <Text style={[styles.heroStatusBadge, { color: statusAccent.color }]}>
                {statusAccent.badge}
              </Text>
              <Text style={styles.heroStatusTitle}>{statusAccent.label}</Text>
              <Text style={styles.heroStatusDescription}>{statusAccent.description}</Text>
            </View>
          </View>

          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaPill}>
              <Ionicons name="briefcase-outline" size={14} color="#183153" />
              <Text style={styles.heroMetaText}>
                {user?.role === 'employee' ? 'Funcionário associado' : 'Conta pessoal'}
              </Text>
            </View>
            <View style={styles.heroMetaPill}>
              <Ionicons
                name={locationPermission ? 'navigate-circle-outline' : 'warning-outline'}
                size={14}
                color={locationPermission ? '#1c9b63' : '#b45309'}
              />
              <Text style={styles.heroMetaText}>
                {locationPermission ? 'GPS pronto' : 'GPS pendente'}
              </Text>
            </View>
          </View>

          <View style={styles.heroSummaryGrid}>
            <View style={styles.heroSummaryCard}>
              <Text style={styles.heroSummaryLabel}>Local ativo</Text>
              <Text style={styles.heroSummaryValue} numberOfLines={2}>
                {workplace?.name || 'Por configurar'}
              </Text>
              <Text style={styles.heroSummaryHint}>{formatSchedule(workplace)}</Text>
            </View>
            <View style={styles.heroSummaryCard}>
              <Text style={styles.heroSummaryLabel}>Trabalho hoje</Text>
              <Text style={styles.heroSummaryValue}>{todayStatus?.netWorkedFormatted || '00:00'}</Text>
              <Text style={styles.heroSummaryHint}>
                {todayStatus?.isScheduledWorkday === false ? 'Hoje não é dia previsto' : 'Atualizado em tempo real'}
              </Text>
            </View>
          </View>
        </View>

        {!locationPermission && (
          <View style={styles.permissionCard}>
            <View style={styles.permissionHeader}>
              <Ionicons name="warning-outline" size={22} color="#9a3412" />
              <Text style={styles.permissionTitle}>Localização desativada</Text>
            </View>
            <Text style={styles.permissionText}>
              Ative a localização para registar pontos com georreferência.
            </Text>
            <Button title="Ativar localização" onPress={requestPermissions} size="small" />
          </View>
        )}

        {loadError && (
          <View style={styles.errorCard}>
            <View style={styles.errorHeader}>
              <Ionicons name="cloud-offline-outline" size={22} color="#991b1b" />
              <Text style={styles.errorTitle}>Dados indisponíveis</Text>
            </View>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button
              title="Tentar novamente"
              onPress={loadData}
              loading={loading}
              size="small"
              variant="outline"
            />
          </View>
        )}

        {todayStatus && workplace ? (
          <StatusCard
            status={todayStatus.status}
            clockIn={todayStatus.punchIn?.occurredAt}
            clockOut={todayStatus.punchOut?.occurredAt}
            netWorkedFormatted={todayStatus.netWorkedFormatted}
            workplaceName={workplace.name}
            distance={distance}
            radiusMeters={workplace.radiusMeters}
          />
        ) : (
          <View style={styles.emptyStateCard}>
            <View style={styles.emptyStateIcon}>
              <Ionicons name="location-outline" size={30} color="#1a73e8" />
            </View>
            <Text style={styles.emptyStateTitle}>Sem local de trabalho ativo</Text>
            <Text style={styles.emptyStateText}>
              Ative um local de trabalho para começar a registar a sua jornada com contexto de localização.
            </Text>
            <TouchableOpacity
              style={styles.emptyStateLink}
              onPress={() => router.push('/(tabs)/workplaces')}
            >
              <Text style={styles.emptyStateLinkText}>Abrir locais de trabalho</Text>
              <Ionicons name="arrow-forward" size={16} color="#1a73e8" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.insightsRow}>
          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <Text style={styles.insightLabel}>Posição atual</Text>
              <Ionicons
                name={withinGeofence ? 'checkmark-circle' : 'navigate-circle-outline'}
                size={16}
                color={withinGeofence ? '#1c9b63' : '#1a73e8'}
              />
            </View>
            <Text style={styles.insightValue}>
              {distance !== undefined ? `${Math.round(distance)}m` : '--'}
            </Text>
            <Text style={styles.insightHint}>
              {distance !== undefined && workplace
                ? withinGeofence
                  ? 'Dentro do raio permitido'
                  : 'Fora do raio configurado'
                : 'Aguardando posição GPS'}
            </Text>
          </View>
          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <Text style={styles.insightLabel}>Próximo passo</Text>
              <Ionicons name="flash-outline" size={16} color="#1a73e8" />
            </View>
            <Text style={styles.insightValue}>
              {currentStatus === 'working'
                ? 'Saída ou pausa'
                : currentStatus === 'on_break'
                  ? 'Terminar pausa'
                  : currentStatus === 'finished'
                    ? 'Dia concluído'
                    : 'Registar entrada'}
            </Text>
            <Text style={styles.insightHint}>
              {currentStatus === 'finished'
                ? 'Tudo registado por hoje'
                : 'Os atalhos abaixo seguem o estado atual'}
            </Text>
          </View>
        </View>

        <View style={styles.actionsCard}>
          <View style={styles.actionsHeader}>
            <View>
              <Text style={styles.actionsEyebrow}>Ações rápidas</Text>
              <Text style={styles.actionsTitle}>Registos do dia</Text>
            </View>
            <View style={styles.actionsIconWrap}>
              <Ionicons name="sparkles" size={18} color="#1a73e8" />
            </View>
          </View>
          <Text style={styles.actionsSubtitle}>
            Os atalhos ficam ativos apenas quando fazem sentido, para reduzir erros no fluxo.
          </Text>

          <View style={styles.quickActionsGrid}>
            {quickActions.map((action) => {
              const toneStyles = {
                primary: styles.quickActionPrimary,
                danger: styles.quickActionDanger,
                neutral: styles.quickActionNeutral,
                success: styles.quickActionSuccess,
              }[action.tone];

              return (
                <TouchableOpacity
                  key={action.key}
                  style={[
                    styles.quickActionCard,
                    toneStyles,
                    action.disabled && styles.quickActionDisabled,
                  ]}
                  onPress={action.onPress}
                  disabled={action.disabled || action.loading}
                  activeOpacity={0.85}
                >
                  <View style={styles.quickActionTopRow}>
                    <View style={styles.quickActionIconWrap}>
                      {action.loading ? (
                        <ActivityIndicator color={action.disabled ? '#8a94a8' : '#183153'} size="small" />
                      ) : (
                        <Ionicons name={action.icon} size={20} color={action.disabled ? '#8a94a8' : '#183153'} />
                      )}
                    </View>
                    <Ionicons
                      name={action.disabled ? 'lock-closed-outline' : 'arrow-forward'}
                      size={16}
                      color={action.disabled ? '#8a94a8' : '#183153'}
                    />
                  </View>
                  <Text style={[styles.quickActionTitle, action.disabled && styles.quickActionTitleDisabled]}>
                    {action.title}
                  </Text>
                  <Text style={[styles.quickActionSubtitle, action.disabled && styles.quickActionSubtitleDisabled]}>
                    {action.subtitle}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.helperCard}>
          <View style={styles.helperHeader}>
            <Ionicons name="information-circle-outline" size={18} color="#1a73e8" />
            <Text style={styles.helperTitle}>Dicas rápidas</Text>
          </View>
          <Text style={styles.helperText}>
            Se estiver fora do raio do local de trabalho, a app pede confirmação antes de registar o ponto.
          </Text>
          <Text style={styles.helperText}>
            Se mudou de local, confirme primeiro o workplace ativo no separador de locais de trabalho.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#edf3f9',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf3f9',
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  heroCard: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#163963',
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
  },
  heroBackgroundBubble: {
    position: 'absolute',
    top: -36,
    right: -10,
    width: 150,
    height: 150,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroBackgroundBubbleSecondary: {
    position: 'absolute',
    bottom: -40,
    left: -20,
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: 'rgba(111, 182, 255, 0.12)',
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ec0ec',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 29,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#c8d8ef',
    marginTop: 6,
  },
  heroStatusIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStatusStrip: {
    borderRadius: 22,
    padding: 16,
    marginTop: 18,
  },
  heroStatusBadge: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  heroStatusTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 8,
  },
  heroStatusDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: '#39506f',
    marginTop: 6,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  heroMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  heroMetaText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#eef4ff',
  },
  heroSummaryGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  heroSummaryCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 14,
  },
  heroSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ec0ec',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroSummaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 8,
  },
  heroSummaryHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#c8d8ef',
    marginTop: 8,
  },
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
  enterpriseTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  enterpriseSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
  permissionCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  permissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9a3412',
    marginLeft: 8,
  },
  permissionText: {
    fontSize: 14,
    color: '#9a3412',
    marginBottom: 12,
  },
  errorCard: {
    backgroundColor: '#fff1f2',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991b1b',
    marginLeft: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#991b1b',
    lineHeight: 20,
    marginBottom: 12,
  },
  emptyStateCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 20,
    marginTop: 4,
    marginBottom: 16,
    alignItems: 'flex-start',
    shadowColor: '#15315d',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  emptyStateIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#ebf3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 14,
  },
  emptyStateText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5b6b8c',
    marginTop: 8,
  },
  emptyStateLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  emptyStateLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a73e8',
    marginRight: 6,
  },
  insightsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  insightCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#15315d',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  insightLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c8aa5',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  insightValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 10,
  },
  insightHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#5b6b8c',
    marginTop: 8,
  },
  actionsCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    marginTop: 16,
    shadowColor: '#15315d',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  actionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionsEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c8aa5',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  actionsTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 4,
  },
  actionsSubtitle: {
    fontSize: 13,
    color: '#5b6b8c',
    lineHeight: 19,
    marginTop: 10,
    marginBottom: 14,
  },
  actionsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#ebf3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionCard: {
    width: '48%',
    borderRadius: 20,
    padding: 14,
    minHeight: 132,
  },
  quickActionPrimary: {
    backgroundColor: '#edf5ff',
  },
  quickActionDanger: {
    backgroundColor: '#fff1ef',
  },
  quickActionNeutral: {
    backgroundColor: '#f4f6fa',
  },
  quickActionSuccess: {
    backgroundColor: '#edfdf4',
  },
  quickActionDisabled: {
    backgroundColor: '#f4f6fa',
    opacity: 0.78,
  },
  quickActionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quickActionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 18,
  },
  quickActionTitleDisabled: {
    color: '#6d778c',
  },
  quickActionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: '#495a77',
    marginTop: 8,
  },
  quickActionSubtitleDisabled: {
    color: '#7f889b',
  },
  helperCard: {
    backgroundColor: '#f4f8ff',
    borderRadius: 20,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  helperHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  helperTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f3a68',
    marginLeft: 8,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#4f5f7a',
    marginTop: 6,
  },
});
