import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { timesheetService } from '../../src/services/backend';

export default function ExportScreen() {
  const [fromDate, setFromDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState<string | null>(null);

  const formatDateDisplay = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-PT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setLoading(format);
    try {
      const data = format === 'csv'
        ? await timesheetService.exportCsv(fromDate, toDate)
        : await timesheetService.exportXlsx(fromDate, toDate);

      if (Platform.OS === 'web') {
        // For web, create a download link
        const blob = new Blob([data], {
          type: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timesheet_${fromDate}_${toDate}.${format}`;
        a.click();
        window.URL.revokeObjectURL(url);
        Alert.alert('Sucesso', 'Ficheiro exportado com sucesso!');
      } else {
        // For mobile, save to file system and share
        const filename = `timesheet_${fromDate}_${toDate}.${format}`;
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        
        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri);
          } else {
            Alert.alert('Erro', 'Partilha não disponível neste dispositivo');
          }
        };
        reader.readAsDataURL(data);
      }
    } catch (error: any) {
      console.error('Export error:', error);
      Alert.alert('Erro', 'Não foi possível exportar os dados');
    } finally {
      setLoading(null);
    }
  };

  const adjustDate = (type: 'from' | 'to', days: number) => {
    if (type === 'from') {
      const date = new Date(fromDate);
      date.setDate(date.getDate() + days);
      setFromDate(date.toISOString().split('T')[0]);
    } else {
      const date = new Date(toDate);
      date.setDate(date.getDate() + days);
      setToDate(date.toISOString().split('T')[0]);
    }
  };

  const setQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFromDate(start.toISOString().split('T')[0]);
    setToDate(end.toISOString().split('T')[0]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Ionicons name="download" size={48} color="#1a73e8" />
          <Text style={styles.title}>Exportar Folha de Ponto</Text>
          <Text style={styles.subtitle}>
            Selecione o período e formato para exportar
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Período</Text>

          <View style={styles.quickButtons}>
            <TouchableOpacity
              style={styles.quickButton}
              onPress={() => setQuickRange(7)}
            >
              <Text style={styles.quickButtonText}>7 dias</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickButton}
              onPress={() => setQuickRange(30)}
            >
              <Text style={styles.quickButtonText}>30 dias</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickButton}
              onPress={() => setQuickRange(90)}
            >
              <Text style={styles.quickButtonText}>90 dias</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>De:</Text>
            <View style={styles.dateSelector}>
              <TouchableOpacity
                style={styles.dateArrow}
                onPress={() => adjustDate('from', -1)}
              >
                <Ionicons name="chevron-back" size={20} color="#1a73e8" />
              </TouchableOpacity>
              <Text style={styles.dateValue}>{formatDateDisplay(fromDate)}</Text>
              <TouchableOpacity
                style={styles.dateArrow}
                onPress={() => adjustDate('from', 1)}
              >
                <Ionicons name="chevron-forward" size={20} color="#1a73e8" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Até:</Text>
            <View style={styles.dateSelector}>
              <TouchableOpacity
                style={styles.dateArrow}
                onPress={() => adjustDate('to', -1)}
              >
                <Ionicons name="chevron-back" size={20} color="#1a73e8" />
              </TouchableOpacity>
              <Text style={styles.dateValue}>{formatDateDisplay(toDate)}</Text>
              <TouchableOpacity
                style={styles.dateArrow}
                onPress={() => adjustDate('to', 1)}
              >
                <Ionicons name="chevron-forward" size={20} color="#1a73e8" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Formato de Exportação</Text>

          <TouchableOpacity
            style={styles.formatOption}
            onPress={() => handleExport('csv')}
            disabled={loading !== null}
          >
            <View style={styles.formatIcon}>
              <Ionicons name="document-text" size={28} color="#28a745" />
            </View>
            <View style={styles.formatInfo}>
              <Text style={styles.formatTitle}>CSV</Text>
              <Text style={styles.formatDesc}>Compatível com Excel, Google Sheets</Text>
            </View>
            {loading === 'csv' ? (
              <Text style={styles.loadingText}>A exportar...</Text>
            ) : (
              <Ionicons name="chevron-forward" size={24} color="#ccc" />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.formatOption}
            onPress={() => handleExport('xlsx')}
            disabled={loading !== null}
          >
            <View style={[styles.formatIcon, { backgroundColor: '#e8f5e9' }]}>
              <Ionicons name="grid" size={28} color="#1a73e8" />
            </View>
            <View style={styles.formatInfo}>
              <Text style={styles.formatTitle}>Excel (XLSX)</Text>
              <Text style={styles.formatDesc}>Microsoft Excel formato nativo</Text>
            </View>
            {loading === 'xlsx' ? (
              <Text style={styles.loadingText}>A exportar...</Text>
            ) : (
              <Ionicons name="chevron-forward" size={24} color="#ccc" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#1a73e8" />
          <Text style={styles.infoText}>
            O ficheiro exportado inclui: entrada, saída, horário de almoço,
            tempo trabalhado e método de registo.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  quickButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  quickButton: {
    flex: 1,
    backgroundColor: '#e3f2fd',
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  quickButtonText: {
    color: '#1a73e8',
    fontWeight: '600',
    fontSize: 13,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateLabel: {
    fontSize: 14,
    color: '#666',
    width: 40,
  },
  dateSelector: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  dateArrow: {
    padding: 4,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  formatOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  formatIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatInfo: {
    flex: 1,
    marginLeft: 12,
  },
  formatTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  formatDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  loadingText: {
    color: '#1a73e8',
    fontSize: 12,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#1a73e8',
    lineHeight: 18,
  },
});
