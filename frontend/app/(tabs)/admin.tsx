import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { workplaceApi, usersApi, seedData } from '../../src/services/api';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Workplace, User } from '../../src/types';

export default function AdminScreen() {
  const { user } = useAuth();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingWorkplace, setEditingWorkplace] = useState<Workplace | null>(null);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    latitude: '',
    longitude: '',
    radiusMeters: '150',
    startTime: '09:00',
    endTime: '18:00',
    allowedMarginMinutes: '120',
  });

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      setLoading(true);
      // First seed data to ensure admin exists
      try {
        await seedData();
      } catch (e) {
        // Ignore if already seeded
      }
      
      const [workplacesRes, usersRes] = await Promise.all([
        workplaceApi.listAll(),
        usersApi.list(),
      ]);
      setWorkplaces(workplacesRes.data);
      setUsers(usersRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const openAddModal = () => {
    setEditingWorkplace(null);
    setFormData({
      name: '',
      latitude: '',
      longitude: '',
      radiusMeters: '150',
      startTime: '09:00',
      endTime: '18:00',
      allowedMarginMinutes: '120',
    });
    setModalVisible(true);
  };

  const openEditModal = (workplace: Workplace) => {
    setEditingWorkplace(workplace);
    setFormData({
      name: workplace.name,
      latitude: workplace.latitude.toString(),
      longitude: workplace.longitude.toString(),
      radiusMeters: workplace.radiusMeters.toString(),
      startTime: workplace.startTime,
      endTime: workplace.endTime,
      allowedMarginMinutes: workplace.allowedMarginMinutes.toString(),
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const data = {
        name: formData.name,
        latitude: parseFloat(formData.latitude),
        longitude: parseFloat(formData.longitude),
        radiusMeters: parseInt(formData.radiusMeters),
        startTime: formData.startTime,
        endTime: formData.endTime,
        allowedMarginMinutes: parseInt(formData.allowedMarginMinutes),
      };

      if (editingWorkplace) {
        await workplaceApi.update(editingWorkplace.id, data);
        Alert.alert('Sucesso', 'Local de trabalho atualizado');
      } else {
        await workplaceApi.create(data);
        Alert.alert('Sucesso', 'Local de trabalho criado');
      }

      setModalVisible(false);
      loadData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Erro ao guardar';
      Alert.alert('Erro', message);
    }
  };

  const handleDelete = (workplace: Workplace) => {
    Alert.alert(
      'Confirmar',
      `Deseja eliminar "${workplace.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await workplaceApi.delete(workplace.id);
              Alert.alert('Sucesso', 'Local de trabalho eliminado');
              loadData();
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível eliminar');
            }
          },
        },
      ]
    );
  };

  const openAssignModal = (user: User) => {
    setSelectedUser(user);
    setAssignModalVisible(true);
  };

  const handleAssignWorkplace = async (workplaceId: string) => {
    if (!selectedUser) return;

    try {
      await workplaceApi.assignToUser(selectedUser.id, workplaceId);
      Alert.alert('Sucesso', 'Local de trabalho atribuído');
      setAssignModalVisible(false);
      loadData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Erro ao atribuir';
      Alert.alert('Erro', message);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noAccessContainer}>
          <Ionicons name="lock-closed" size={64} color="#ccc" />
          <Text style={styles.noAccessTitle}>Acesso Restrito</Text>
          <Text style={styles.noAccessText}>
            Esta área é apenas para administradores
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Administração</Text>
        </View>

        {/* Workplaces Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Locais de Trabalho</Text>
            <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
              <Ionicons name="add" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {workplaces.map((workplace) => (
            <View key={workplace.id} style={styles.workplaceCard}>
              <View style={styles.workplaceInfo}>
                <Text style={styles.workplaceName}>{workplace.name}</Text>
                <Text style={styles.workplaceCoords}>
                  {workplace.latitude.toFixed(4)}, {workplace.longitude.toFixed(4)}
                </Text>
                <Text style={styles.workplaceSchedule}>
                  {workplace.startTime} - {workplace.endTime} | Raio: {workplace.radiusMeters}m
                </Text>
              </View>
              <View style={styles.workplaceActions}>
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={() => openEditModal(workplace)}
                >
                  <Ionicons name="pencil" size={20} color="#1a73e8" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={() => handleDelete(workplace)}
                >
                  <Ionicons name="trash" size={20} color="#dc3545" />
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {workplaces.length === 0 && (
            <Text style={styles.emptyText}>Nenhum local de trabalho</Text>
          )}
        </View>

        {/* Users Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Funcionários</Text>

          {users.map((u) => (
            <View key={u.id} style={styles.userCard}>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{u.name}</Text>
                <Text style={styles.userEmail}>{u.email}</Text>
                <Text style={styles.userWorkplace}>
                  {u.workplaceId
                    ? workplaces.find((w) => w.id === u.workplaceId)?.name || 'Local atribuído'
                    : 'Sem local atribuído'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.assignButton}
                onPress={() => openAssignModal(u)}
              >
                <Ionicons name="location" size={20} color="#1a73e8" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Workplace Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingWorkplace ? 'Editar Local' : 'Novo Local de Trabalho'}
            </Text>

            <ScrollView style={styles.modalScroll}>
              <Input
                label="Nome"
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                placeholder="Escritório Central"
              />

              <Input
                label="Latitude"
                value={formData.latitude}
                onChangeText={(text) => setFormData({ ...formData, latitude: text })}
                keyboardType="numeric"
                placeholder="38.7223"
              />

              <Input
                label="Longitude"
                value={formData.longitude}
                onChangeText={(text) => setFormData({ ...formData, longitude: text })}
                keyboardType="numeric"
                placeholder="-9.1393"
              />

              <Input
                label="Raio (metros)"
                value={formData.radiusMeters}
                onChangeText={(text) => setFormData({ ...formData, radiusMeters: text })}
                keyboardType="numeric"
                placeholder="150"
              />

              <Input
                label="Hora de Início"
                value={formData.startTime}
                onChangeText={(text) => setFormData({ ...formData, startTime: text })}
                placeholder="09:00"
              />

              <Input
                label="Hora de Fim"
                value={formData.endTime}
                onChangeText={(text) => setFormData({ ...formData, endTime: text })}
                placeholder="18:00"
              />

              <Input
                label="Margem (minutos)"
                value={formData.allowedMarginMinutes}
                onChangeText={(text) => setFormData({ ...formData, allowedMarginMinutes: text })}
                keyboardType="numeric"
                placeholder="120"
              />
            </ScrollView>

            <View style={styles.modalButtons}>
              <Button
                title="Cancelar"
                onPress={() => setModalVisible(false)}
                variant="outline"
                style={{ flex: 1, marginRight: 8 }}
              />
              <Button
                title="Guardar"
                onPress={handleSave}
                style={{ flex: 1, marginLeft: 8 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Assign Workplace Modal */}
      <Modal visible={assignModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Atribuir Local de Trabalho</Text>
            <Text style={styles.modalSubtitle}>para {selectedUser?.name}</Text>

            <FlatList
              data={workplaces}
              keyExtractor={(item) => item.id}
              style={styles.workplaceList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.workplaceOption}
                  onPress={() => handleAssignWorkplace(item.id)}
                >
                  <Ionicons name="location" size={24} color="#1a73e8" />
                  <Text style={styles.workplaceOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />

            <Button
              title="Cancelar"
              onPress={() => setAssignModalVisible(false)}
              variant="outline"
              style={{ marginTop: 16 }}
            />
          </View>
        </View>
      </Modal>
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
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  addButton: {
    backgroundColor: '#1a73e8',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workplaceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  workplaceInfo: {
    flex: 1,
  },
  workplaceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  workplaceCoords: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  workplaceSchedule: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  workplaceActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    padding: 8,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  userEmail: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  userWorkplace: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  assignButton: {
    padding: 8,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    padding: 20,
  },
  noAccessContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noAccessTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
  },
  noAccessText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 16,
  },
  workplaceList: {
    maxHeight: 300,
  },
  workplaceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  workplaceOptionText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
  },
});
