import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { Button } from '../../src/components/Button';
import { enterpriseService } from '../../src/services/backend';
import { EnterpriseMembership } from '../../src/types';
import { getHumanReadableError } from '../../src/utils/network';

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();
  const [pendingInvitations, setPendingInvitations] = useState<EnterpriseMembership[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    if (user?.role === 'enterprise_owner') {
      setPendingInvitations([]);
      return;
    }

    try {
      const data = await enterpriseService.listMyInvitations();
      setPendingInvitations(data ?? []);
    } catch (error) {
      console.error('Error loading invitations:', error);
    }
  }, [user?.role]);

  useFocusEffect(
    useCallback(() => {
      loadInvitations();
    }, [loadInvitations]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    await loadInvitations();
    setRefreshing(false);
  };

  const handleInvitationAction = async (membershipId: string, action: 'accept' | 'reject') => {
    setActionLoading(`${action}-${membershipId}`);
    try {
      if (action === 'accept') {
        await enterpriseService.acceptInvitation(membershipId);
      } else {
        await enterpriseService.rejectInvitation(membershipId);
      }

      setPendingInvitations((current) =>
        current.filter((invitation) => invitation.id !== membershipId),
      );

      try {
        await refreshUser();
        await loadInvitations();
      } catch (syncError) {
        console.error('Invitation post-action sync failed:', syncError);
      }

      Alert.alert(
        'Sucesso',
        action === 'accept'
          ? 'Convite aceite com sucesso.'
          : 'Convite rejeitado com sucesso.',
      );
    } catch (error) {
      Alert.alert('Erro', getHumanReadableError(error, {
        defaultMessage: 'Não foi possível processar o convite.',
        service: 'backend',
      }));
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = () => {
    Alert.alert('Terminar sessão', 'Tem a certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout();
          } catch (error) {
            console.error('Logout error (ignored):', error);
          }
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const roleLabel = user?.role === 'enterprise_owner'
    ? 'Conta empresa'
    : user?.role === 'employee'
      ? 'Funcionário associado'
      : 'Conta normal';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />}
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Ionicons name={user?.role === 'enterprise_owner' ? 'business' : 'person'} size={48} color="#fff" />
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleLabel}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Informações da Conta</Text>

          <View style={styles.infoRow}>
            <Ionicons name="person-circle" size={20} color="#666" />
            <Text style={styles.infoLabel}>Tipo de conta</Text>
            <Text style={styles.infoValue}>{user?.accountType === 'enterprise' ? 'Empresa' : 'Normal'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="briefcase" size={20} color="#666" />
            <Text style={styles.infoLabel}>Função</Text>
            <Text style={styles.infoValue}>{roleLabel}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="business" size={20} color="#666" />
            <Text style={styles.infoLabel}>Empresa associada</Text>
            <Text style={styles.infoValue}>{user?.enterpriseName || 'Nenhuma'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="id-card" size={20} color="#666" />
            <Text style={styles.infoLabel}>ID Funcionário</Text>
            <Text style={styles.infoValue}>{user?.employeeId || 'Não definido'}</Text>
          </View>
        </View>

        {pendingInvitations.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Convites Pendentes</Text>
            {pendingInvitations.map((invitation) => (
              <View key={invitation.id} style={styles.invitationCard}>
                <Text style={styles.invitationEmail}>{invitation.email}</Text>
                <Text style={styles.invitationMeta}>Convite recebido em {new Date(invitation.createdAt).toLocaleDateString('pt-PT')}</Text>
                <View style={styles.invitationActions}>
                  <Button
                    title="Aceitar"
                    onPress={() => handleInvitationAction(invitation.id, 'accept')}
                    loading={actionLoading === `accept-${invitation.id}`}
                    size="small"
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Rejeitar"
                    onPress={() => handleInvitationAction(invitation.id, 'reject')}
                    loading={actionLoading === `reject-${invitation.id}`}
                    variant="outline"
                    size="small"
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color="#1a73e8" />
          <Text style={styles.infoBoxText}>
            Os dados de localização são usados apenas para registo de ponto e gestão operacional.
          </Text>
        </View>

        <Button
          title="Terminar Sessão"
          onPress={handleLogout}
          variant="danger"
          style={styles.logoutButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  header: { alignItems: 'center', marginBottom: 24, paddingTop: 16 },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  name: { fontSize: 24, fontWeight: '700', color: '#333' },
  email: { fontSize: 14, color: '#666', marginTop: 4 },
  roleBadge: {
    backgroundColor: '#1a73e8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 10,
  },
  roleBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  infoLabel: { flex: 1, fontSize: 14, color: '#666', marginLeft: 12 },
  infoValue: { fontSize: 14, fontWeight: '500', color: '#333' },
  invitationCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  invitationEmail: { fontSize: 15, fontWeight: '700', color: '#111827' },
  invitationMeta: { fontSize: 12, color: '#6b7280', marginTop: 6 },
  invitationActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  infoBoxText: { flex: 1, marginLeft: 8, fontSize: 13, color: '#1a73e8', lineHeight: 18 },
  logoutButton: { marginTop: 8 },
});
