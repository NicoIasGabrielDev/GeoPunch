import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface StatusCardProps {
  status: 'not_started' | 'working' | 'on_lunch' | 'on_break' | 'finished';
  workplaceName?: string;
  distance?: number;
  clockIn?: string | null;
  clockOut?: string | null;
  netWorkedFormatted?: string;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  status,
  workplaceName,
  distance,
  clockIn,
  clockOut,
  netWorkedFormatted,
}) => {
  const getStatusInfo = () => {
    switch (status) {
      case 'not_started':
        return { text: 'Não iniciado', color: '#6c757d', icon: 'time-outline' as const };
      case 'working':
        return { text: 'A trabalhar', color: '#28a745', icon: 'briefcase' as const };
      case 'on_lunch':
      case 'on_break':
        return { text: 'Em pausa', color: '#ffc107', icon: 'restaurant' as const };
      case 'finished':
        return { text: 'Dia terminado', color: '#1a73e8', icon: 'checkmark-circle' as const };
      default:
        return { text: 'Desconhecido', color: '#6c757d', icon: 'help-circle' as const };
    }
  };

  const statusInfo = getStatusInfo();

  const formatTime = (dateString: string | null | undefined): string => {
    if (!dateString) return '--:--';
    const date = new Date(dateString);
    return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={[styles.card, { borderLeftColor: statusInfo.color }]}>
      <View style={styles.header}>
        <Ionicons name={statusInfo.icon} size={28} color={statusInfo.color} />
        <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.text}</Text>
      </View>

      {workplaceName && (
        <View style={styles.row}>
          <Ionicons name="location" size={18} color="#666" />
          <Text style={styles.rowText}>{workplaceName}</Text>
          {distance !== undefined && (
            <Text style={styles.distance}>{Math.round(distance)}m</Text>
          )}
        </View>
      )}

      <View style={styles.timesContainer}>
        <View style={styles.timeBox}>
          <Text style={styles.timeLabel}>Entrada</Text>
          <Text style={styles.timeValue}>{formatTime(clockIn)}</Text>
        </View>
        <View style={styles.timeBox}>
          <Text style={styles.timeLabel}>Saída</Text>
          <Text style={styles.timeValue}>{formatTime(clockOut)}</Text>
        </View>
        <View style={styles.timeBox}>
          <Text style={styles.timeLabel}>Trabalhado</Text>
          <Text style={[styles.timeValue, styles.worked]}>{netWorkedFormatted || '00:00'}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusText: {
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  rowText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
    flex: 1,
  },
  distance: {
    fontSize: 14,
    color: '#1a73e8',
    fontWeight: '600',
  },
  timesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  timeBox: {
    alignItems: 'center',
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  timeValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  worked: {
    color: '#1a73e8',
  },
});
