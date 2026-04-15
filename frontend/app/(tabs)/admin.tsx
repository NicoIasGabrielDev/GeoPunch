import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import {
  ensureBackendReady,
  enterpriseService,
  workplaceService,
} from '../../src/services/backend';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { DayTimesheet, EnterpriseMembership, Workplace } from '../../src/types';
import { getHumanReadableError } from '../../src/utils/network';

export default function AdminScreen() {
  const { user, refreshUser } = useAuth();
  const [memberships, setMemberships] = useState<EnterpriseMembership[]>([]);
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedMember, setSelectedMember] = useState<EnterpriseMembership | null>(null);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [timesheetModalVisible, setTimesheetModalVisible] = useState(false);
  const [memberTimesheet, setMemberTimesheet] = useState<DayTimesheet[]>([]);

  const loadData = useCallback(async () => {
    try {
      await ensureBackendReady();
      const [membershipData, workplaceData] = await Promise.all([
        enterpriseService.listMemberships(),
        workplaceService.list(),
      ]);
      setMemberships(membershipData ?? []);
      setWorkplaces((workplaceData ?? []).filter((item: Workplace) => item.contextType === 'enterprise'));
    } catch (error) {
      console.error('Error loading enterprise data:', error);
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Não foi possível carregar a área da empresa.',
        service: 'backend',
      }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user?.role === 'enterprise_owner') {
        loadData();
      }
    }, [loadData, user?.role]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    await loadData();
    setRefreshing(false);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setSaving(true);
    try {
      await enterpriseService.inviteByEmail(inviteEmail.trim().toLowerCase());
      setInviteEmail('');
      await loadData();
      Alert.alert('Sucesso', 'Convite enviado com sucesso.');
    } catch (error) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Não foi possível enviar o convite.',
        service: 'backend',
      }));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (membership: EnterpriseMembership) => {
    Alert.alert('Remover associação', `Deseja remover ${membership.email} da empresa?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          try {
            await enterpriseService.removeMembership(membership.id);
            await loadData();
          } catch (error) {
            Alert.alert('Erro', getHumanReadableError(error, {
              defaultMessage: 'Não foi possível remover o funcionário.',
              service: 'backend',
            }));
          }
        },
      },
    ]);
  };

  const openAssignModal = (membership: EnterpriseMembership) => {
    setSelectedMember(membership);
    setAssignModalVisible(true);
  };

  const handleAssignWorkplace = async (workplaceId: string) => {
    if (!selectedMember?.userId) return;
    setSaving(true);
    try {
      await enterpriseService.assignWorkplace(selectedMember.userId, workplaceId);
      await loadData();
    } catch (error) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Não foi possível atribuir o local.',
        service: 'backend',
      }));
    } finally {
      setSaving(false);
    }
  };

  const openTimesheetModal = async (membership: EnterpriseMembership) => {
    if (!membership.userId) return;
    setSelectedMember(membership);
    setTimesheetModalVisible(true);
    try {
      const data = await enterpriseService.getEmployeeTimesheet(membership.userId);
      setMemberTimesheet(data ?? []);
    } catch (error) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Não foi possível carregar os registos do funcionário.',
        service: 'backend',
      }));
    }
  };

  if (user?.role !== 'enterprise_owner') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noAccessContainer}>
          <Ionicons name="lock-closed" size={64} color="#ccc" />
          <Text style={styles.noAccessTitle}>Acesso Restrito</Text>
          <Text style={styles.noAccessText}>Esta área é apenas para contas empresa.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const acceptedMembers = memberships.filter((item) => item.status === 'accepted');
  const pendingMembers = memberships.filter((item) => item.status === 'pending');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Empresa</Text>
          <Text style={styles.subtitle}>{user.enterpriseName || 'Gestão de equipa e locais'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Convidar Funcionário</Text>
          <Input
            label="Email"
            placeholder="funcionario@email.com"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Button title="Enviar Convite" onPress={handleInvite} loading={saving} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Convites Pendentes</Text>
          {pendingMembers.length === 0 ? (
            <Text style={styles.mutedText}>Sem convites pendentes.</Text>
          ) : (
            pendingMembers.map((membership) => (
              <View key={membership.id} style={styles.memberCard}>
                <Text style={styles.memberName}>{membership.email}</Text>
                <Text style={styles.memberMeta}>Pendente</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Funcionários Associados</Text>
          {acceptedMembers.length === 0 ? (
            <Text style={styles.mutedText}>Ainda não existem funcionários associados.</Text>
          ) : (
            acceptedMembers.map((membership) => (
              <View key={membership.id} style={styles.memberCard}>
                <Text style={styles.memberName}>{membership.userName || membership.email}</Text>
                <Text style={styles.memberMeta}>{membership.email}</Text>
                <Text style={styles.memberMeta}>
                  Locais atribuídos: {membership.assignedWorkplaceIds.length}
                </Text>
                <View style={styles.memberActions}>
                  <Button title="Atribuir Locais" onPress={() => openAssignModal(membership)} size="small" style={{ flex: 1 }} />
                  <Button title="Ver Registos" onPress={() => openTimesheetModal(membership)} size="small" variant="outline" style={{ flex: 1 }} />
                </View>
                <Button
                  title="Remover"
                  onPress={() => handleRemoveMember(membership)}
                  size="small"
                  variant="danger"
                  style={{ marginTop: 10 }}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={assignModalVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setAssignModalVisible(false)}>
              <Ionicons name="close" size={28} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Atribuir Locais</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalSubtitle}>{selectedMember?.userName || selectedMember?.email}</Text>
            {workplaces.map((workplace) => {
              const alreadyAssigned = !!selectedMember?.assignedWorkplaceIds.includes(workplace.id);
              return (
                <View key={workplace.id} style={styles.workplaceAssignCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.workplaceAssignName}>{workplace.name}</Text>
                    <Text style={styles.workplaceAssignMeta}>Raio: {workplace.radiusMeters}m</Text>
                  </View>
                  <Button
                    title={alreadyAssigned ? 'Atribuído' : 'Atribuir'}
                    onPress={() => handleAssignWorkplace(workplace.id)}
                    disabled={alreadyAssigned || saving}
                    loading={saving && !alreadyAssigned}
                    size="small"
                    variant={alreadyAssigned ? 'secondary' : 'primary'}
                  />
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={timesheetModalVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setTimesheetModalVisible(false)}>
              <Ionicons name="close" size={28} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Registos do Funcionário</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalSubtitle}>{selectedMember?.userName || selectedMember?.email}</Text>
            {memberTimesheet.length === 0 ? (
              <Text style={styles.mutedText}>Sem registos disponíveis.</Text>
            ) : (
              memberTimesheet.map((day) => (
                <View key={`${day.date}-${day.workplaceId}`} style={styles.timesheetCard}>
                  <Text style={styles.timesheetDate}>{new Date(day.date).toLocaleDateString('pt-PT')}</Text>
                  <Text style={styles.timesheetWorkplace}>{day.workplaceName}</Text>
                  <Text style={styles.timesheetMeta}>Trabalhado: {day.netWorkedFormatted}</Text>
                  <Text style={styles.timesheetMeta}>Estado: {day.status}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16 },
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  mutedText: { fontSize: 14, color: '#6b7280' },
  memberCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  memberName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  memberMeta: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  memberActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  noAccessContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  noAccessTitle: { fontSize: 22, fontWeight: '700', color: '#333', marginTop: 16 },
  noAccessText: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 8 },
  modalContainer: { flex: 1, backgroundColor: '#f5f5f5' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  modalContent: { padding: 16 },
  modalSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  workplaceAssignCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  workplaceAssignName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  workplaceAssignMeta: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  timesheetCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  timesheetDate: { fontSize: 14, fontWeight: '700', color: '#111827' },
  timesheetWorkplace: { fontSize: 13, color: '#374151', marginTop: 4 },
  timesheetMeta: { fontSize: 12, color: '#6b7280', marginTop: 4 },
});
