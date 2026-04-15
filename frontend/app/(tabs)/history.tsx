import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { ensureBackendReady, timesheetService } from '../../src/services/backend';
import { DayTimesheet } from '../../src/types';
import { getHumanReadableError } from '../../src/utils/network';

export default function HistoryScreen() {
  const { user } = useAuth();
  const [timesheet, setTimesheet] = useState<DayTimesheet[]>([]);
  const [, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadTimesheet();
    }, [])
  );

  const loadTimesheet = async () => {
    try {
      setLoading(true);
      await ensureBackendReady();
      const data = await timesheetService.getTimesheet();
      setTimesheet(data ?? []);
    } catch (error) {
      console.error('Error loading timesheet:', error);
      Alert.alert(
        'Erro',
        getHumanReadableError(error, {
          defaultMessage: 'Não foi possível carregar o histórico.',
          service: 'backend',
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTimesheet();
    setRefreshing(false);
  };

  const formatTime = (dateString: string | null): string => {
    if (!dateString) return '--:--';
    const date = new Date(dateString);
    return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-PT', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'finished':
        return '#28a745';
      case 'working':
        return '#1a73e8';
      case 'on_break':
        return '#ffc107';
      default:
        return '#6c757d';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'finished':
        return 'Completo';
      case 'working':
        return 'A trabalhar';
      case 'on_break':
        return 'Em pausa';
      default:
        return 'Não iniciado';
    }
  };

  const renderItem = ({ item }: { item: DayTimesheet }) => {
    // Extract first IN and last OUT punches, and break info from the punches array
    const punchIn = item.punches.find(p => p.type === 'IN');
    const punchOut = [...item.punches].reverse().find(p => p.type === 'OUT');
    const breakStart = item.punches.find(p => p.type === 'BREAK_START');
    const breakEnd = item.punches.find(p => p.type === 'BREAK_END');

    return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
          <Text style={styles.workplaceName}>{item.workplaceName}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
        </View>
      </View>

      <View style={styles.timesRow}>
        <View style={styles.timeItem}>
          <Ionicons name="log-in" size={16} color="#28a745" />
          <Text style={styles.timeLabel}>Entrada</Text>
          <Text style={styles.timeValue}>{formatTime(punchIn?.occurredAt ?? null)}</Text>
          {punchIn?.method && (
            <Text style={styles.methodText}>{punchIn.method}</Text>
          )}
        </View>

        <View style={styles.timeItem}>
          <Ionicons name="restaurant" size={16} color="#ffc107" />
          <Text style={styles.timeLabel}>Almoço</Text>
          <Text style={styles.timeValue}>
            {formatTime(breakStart?.occurredAt ?? null)} - {formatTime(breakEnd?.occurredAt ?? null)}
          </Text>
        </View>

        <View style={styles.timeItem}>
          <Ionicons name="log-out" size={16} color="#dc3545" />
          <Text style={styles.timeLabel}>Saída</Text>
          <Text style={styles.timeValue}>{formatTime(punchOut?.occurredAt ?? null)}</Text>
          {punchOut?.method && (
            <Text style={styles.methodText}>{punchOut.method}</Text>
          )}
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerItem}>
          <Text style={styles.footerLabel}>Bruto</Text>
          <Text style={styles.footerValue}>
            {Math.floor(item.grossMinutes / 60)}h {item.grossMinutes % 60}m
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Text style={styles.footerLabel}>Pausa</Text>
          <Text style={styles.footerValue}>
            {Math.floor(item.breakMinutes / 60)}h {item.breakMinutes % 60}m
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Text style={styles.footerLabel}>Líquido</Text>
          <Text style={[styles.footerValue, styles.netValue]}>
            {item.netWorkedFormatted}
          </Text>
        </View>
      </View>
    </View>
  );
  };

  if (user?.role === 'enterprise_owner') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="business" size={64} color="#ccc" />
          <Text style={styles.emptyText}>O histórico individual não está disponível para conta empresa.</Text>
          <Text style={styles.emptySubtext}>Consulte os registos dos funcionários na área Empresa.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Histórico</Text>
        <Text style={styles.subtitle}>Últimos 30 dias</Text>
      </View>

      <FlatList
        data={timesheet}
        keyExtractor={(item) => item.date}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>Sem registos</Text>
            <Text style={styles.emptySubtext}>Os seus registos de ponto aparecerão aqui</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textTransform: 'capitalize',
  },
  workplaceName: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  timesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  timeItem: {
    alignItems: 'center',
    flex: 1,
  },
  timeLabel: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  timeValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  methodText: {
    fontSize: 10,
    color: '#999',
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
  },
  footerItem: {
    alignItems: 'center',
  },
  footerLabel: {
    fontSize: 11,
    color: '#999',
  },
  footerValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  netValue: {
    color: '#1a73e8',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
});
