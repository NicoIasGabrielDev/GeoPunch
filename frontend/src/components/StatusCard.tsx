import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface StatusCardProps {
  status: 'not_started' | 'working' | 'on_lunch' | 'on_break' | 'finished';
  workplaceName?: string;
  distance?: number;
  radiusMeters?: number;
  clockIn?: string | null;
  clockOut?: string | null;
  netWorkedFormatted?: string;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  status,
  workplaceName,
  distance,
  radiusMeters,
  clockIn,
  clockOut,
  netWorkedFormatted,
}) => {
  const getStatusInfo = () => {
    switch (status) {
      case 'not_started':
        return {
          text: 'Pronto para começar',
          subtitle: 'Ainda não existe registo de entrada hoje.',
          color: '#5b6b8c',
          soft: '#eef3ff',
          deep: '#dce6fb',
          icon: 'time-outline' as const,
        };
      case 'working':
        return {
          text: 'Em trabalho',
          subtitle: 'Jornada em curso com registo ativo.',
          color: '#1c9b63',
          soft: '#e9fff4',
          deep: '#cbf5df',
          icon: 'briefcase' as const,
        };
      case 'on_lunch':
      case 'on_break':
        return {
          text: 'Em pausa',
          subtitle: 'Existe uma pausa aberta neste momento.',
          color: '#d99200',
          soft: '#fff7dd',
          deep: '#ffeab1',
          icon: 'restaurant' as const,
        };
      case 'finished':
        return {
          text: 'Dia concluído',
          subtitle: 'Entrada e saída já foram registadas.',
          color: '#1a73e8',
          soft: '#ebf3ff',
          deep: '#d9e9ff',
          icon: 'checkmark-circle' as const,
        };
      default:
        return {
          text: 'Estado indisponível',
          subtitle: 'Não foi possível interpretar o estado atual.',
          color: '#5b6b8c',
          soft: '#eef3ff',
          deep: '#dce6fb',
          icon: 'help-circle' as const,
        };
    }
  };

  const statusInfo = getStatusInfo();
  const isInsideWorkplace =
    distance !== undefined && radiusMeters !== undefined ? distance <= radiusMeters : undefined;

  const formatTime = (dateString: string | null | undefined): string => {
    if (!dateString) return '--:--';
    const date = new Date(dateString);
    return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  };

  const progressLabel =
    status === 'finished'
      ? 'Jornada fechada'
      : status === 'working'
        ? 'A decorrer'
        : status === 'on_break' || status === 'on_lunch'
          ? 'Pausa ativa'
          : 'Por iniciar';

  return (
    <View style={styles.card}>
      <View style={styles.headerBand}>
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.deep }]}>
              <Ionicons name={statusInfo.icon} size={16} color={statusInfo.color} />
              <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.text}</Text>
            </View>
            <Text style={styles.title}>Resumo do dia</Text>
            <Text style={styles.subtitle}>{statusInfo.subtitle}</Text>
          </View>
          <View style={[styles.heroIconWrap, { backgroundColor: statusInfo.deep }]}>
            <Ionicons name={statusInfo.icon} size={28} color={statusInfo.color} />
          </View>
        </View>

        <View style={styles.highlightRow}>
          <View style={styles.highlightCard}>
            <Text style={styles.highlightLabel}>Estado</Text>
            <Text style={styles.highlightValue}>{progressLabel}</Text>
          </View>
          <View style={styles.highlightCard}>
            <Text style={styles.highlightLabel}>Total hoje</Text>
            <Text style={[styles.highlightValue, { color: statusInfo.color }]}>
              {netWorkedFormatted || '00:00'}
            </Text>
          </View>
        </View>
      </View>

      {workplaceName && (
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <View style={styles.locationTitleRow}>
              <Ionicons name="location" size={18} color="#1f3a68" />
              <Text style={styles.locationTitle}>{workplaceName}</Text>
            </View>
            {isInsideWorkplace !== undefined && (
              <View
                style={[
                  styles.geofencePill,
                  isInsideWorkplace ? styles.geofencePillInside : styles.geofencePillOutside,
                ]}
              >
                <Text
                  style={[
                    styles.geofencePillText,
                    isInsideWorkplace ? styles.geofencePillTextInside : styles.geofencePillTextOutside,
                  ]}
                >
                  {isInsideWorkplace ? 'Dentro do raio' : 'Fora do raio'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.locationStats}>
            {distance !== undefined && (
              <View style={styles.locationStatBox}>
                <Text style={styles.locationStatLabel}>Distância</Text>
                <Text style={styles.locationStatValue}>{Math.round(distance)}m</Text>
              </View>
            )}
            {radiusMeters !== undefined && (
              <View style={styles.locationStatBox}>
                <Text style={styles.locationStatLabel}>Raio ativo</Text>
                <Text style={styles.locationStatValue}>{radiusMeters}m</Text>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.timeline}>
        <View style={styles.timelineItem}>
          <View style={styles.timelineBullet}>
            <Ionicons name="log-in-outline" size={16} color="#1a73e8" />
          </View>
          <View style={styles.timelineCopy}>
            <Text style={styles.timelineLabel}>Entrada</Text>
            <Text style={styles.timelineValue}>{formatTime(clockIn)}</Text>
          </View>
        </View>

        <View style={styles.timelineDivider} />

        <View style={styles.timelineItem}>
          <View style={styles.timelineBullet}>
            <Ionicons name="log-out-outline" size={16} color="#cf4e3a" />
          </View>
          <View style={styles.timelineCopy}>
            <Text style={styles.timelineLabel}>Saída</Text>
            <Text style={styles.timelineValue}>{formatTime(clockOut)}</Text>
          </View>
        </View>

        <View style={styles.timelineDivider} />

        <View style={styles.timelineItem}>
          <View style={styles.timelineBullet}>
            <Ionicons name="time-outline" size={16} color="#1c9b63" />
          </View>
          <View style={styles.timelineCopy}>
            <Text style={styles.timelineLabel}>Tempo líquido</Text>
            <Text style={[styles.timelineValue, styles.worked]}>{netWorkedFormatted || '00:00'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#15315d',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  headerBand: {
    padding: 20,
    backgroundColor: '#f8fbff',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#12233f',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5b6b8c',
    marginTop: 6,
  },
  heroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  highlightCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  highlightLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c8aa5',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  highlightValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 6,
  },
  locationCard: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  locationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1f3a68',
    marginLeft: 6,
  },
  geofencePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  geofencePillInside: {
    backgroundColor: '#e6fbf1',
  },
  geofencePillOutside: {
    backgroundColor: '#fff1ef',
  },
  geofencePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  geofencePillTextInside: {
    color: '#1c9b63',
  },
  geofencePillTextOutside: {
    color: '#cf4e3a',
  },
  locationStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  locationStatBox: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#f5f8ff',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  locationStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7887a6',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  locationStatValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 4,
  },
  timeline: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineBullet: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#f4f7fb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineCopy: {
    marginLeft: 12,
    flex: 1,
  },
  timelineLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7c8aa5',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  timelineValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#12233f',
    marginTop: 3,
  },
  timelineDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#d9e3f1',
    marginLeft: 18,
    marginVertical: 6,
  },
  worked: {
    color: '#1a73e8',
  },
});
