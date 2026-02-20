import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { workplaceApi, seedData } from '../../src/services/api';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Workplace, WorkdaysConfig } from '../../src/types';

const { width, height } = Dimensions.get('window');

interface WizardData {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  workdays: WorkdaysConfig;
  schedule: {
    startTime: string;
    endTime: string;
    marginMinutes: number;
  } | null;
}

const WORKDAY_PRESETS = {
  weekdays: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
  weekends: { monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: true, sunday: true },
  everyday: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true },
};

export default function WorkplacesScreen() {
  const router = useRouter();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [editingWorkplace, setEditingWorkplace] = useState<Workplace | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  
  const [wizardData, setWizardData] = useState<WizardData>({
    name: '',
    latitude: null,
    longitude: null,
    radiusMeters: 150,
    workdays: WORKDAY_PRESETS.weekdays,
    schedule: null,
  });
  
  const [mapRegion, setMapRegion] = useState({
    latitude: 38.7223,
    longitude: -9.1393,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  useFocusEffect(
    useCallback(() => {
      loadWorkplaces();
      getUserLocation();
    }, [])
  );

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        setMapRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const loadWorkplaces = async () => {
    try {
      setLoading(true);
      // Seed data first
      try {
        await seedData();
      } catch (e) {}
      
      const response = await workplaceApi.list();
      setWorkplaces(response.data);
    } catch (error) {
      console.error('Error loading workplaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWorkplaces();
    setRefreshing(false);
  };

  const openWizard = () => {
    setWizardData({
      name: '',
      latitude: userLocation?.latitude || null,
      longitude: userLocation?.longitude || null,
      radiusMeters: 150,
      workdays: WORKDAY_PRESETS.weekdays,
      schedule: null,
    });
    setWizardStep(1);
    setEditingWorkplace(null);
    setWizardVisible(true);
    
    if (userLocation) {
      setMapRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

  const handleSetActive = async (workplace: Workplace) => {
    try {
      await workplaceApi.setActive(workplace.id);
      Alert.alert('Sucesso', `'${workplace.name}' definido como local ativo`);
      await loadWorkplaces();
    } catch (error: any) {
      Alert.alert('Erro', error.response?.data?.detail || 'Erro ao definir local ativo');
    }
  };

  const handleEditWorkplace = (workplace: Workplace) => {
    setEditingWorkplace(workplace);
    setWizardData({
      name: workplace.name,
      latitude: workplace.latitude,
      longitude: workplace.longitude,
      radiusMeters: workplace.radiusMeters,
      workdays: workplace.workdays,
      schedule: workplace.schedule || null,
    });
    setWizardStep(3); // Skip to workdays step (can't edit location)
    setWizardVisible(true);
  };

  const handleMapPress = (e: any) => {
    if (editingWorkplace) return; // Can't change location when editing
    
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setWizardData(prev => ({ ...prev, latitude, longitude }));
  };

  const handleMapRegionChange = (region: any) => {
    if (editingWorkplace) return;
    setWizardData(prev => ({ ...prev, latitude: region.latitude, longitude: region.longitude }));
  };

  const toggleWorkday = (day: keyof WorkdaysConfig) => {
    setWizardData(prev => ({
      ...prev,
      workdays: { ...prev.workdays, [day]: !prev.workdays[day] }
    }));
  };

  const applyPreset = (preset: keyof typeof WORKDAY_PRESETS) => {
    setWizardData(prev => ({ ...prev, workdays: WORKDAY_PRESETS[preset] }));
  };

  const handleCreateWorkplace = async () => {
    if (!wizardData.name.trim()) {
      Alert.alert('Erro', 'Nome é obrigatório');
      return;
    }
    
    if (!wizardData.latitude || !wizardData.longitude) {
      Alert.alert('Erro', 'Selecione a localização no mapa');
      return;
    }
    
    try {
      if (editingWorkplace) {
        // Update only non-location fields
        await workplaceApi.update(editingWorkplace.id, {
          name: wizardData.name,
          radiusMeters: wizardData.radiusMeters,
          workdays: wizardData.workdays,
          schedule: wizardData.schedule,
        });
        Alert.alert('Sucesso', 'Local de trabalho atualizado');
      } else {
        await workplaceApi.create({
          name: wizardData.name,
          latitude: wizardData.latitude,
          longitude: wizardData.longitude,
          radiusMeters: wizardData.radiusMeters,
          workdays: wizardData.workdays,
          schedule: wizardData.schedule,
        });
        Alert.alert('Sucesso', 'Local de trabalho criado com localização bloqueada');
      }
      
      setWizardVisible(false);
      await loadWorkplaces();
    } catch (error: any) {
      Alert.alert('Erro', error.response?.data?.detail || 'Erro ao guardar');
    }
  };

  const renderWizardStep = () => {
    switch (wizardStep) {
      case 1: // Name
        return (
          <View style={styles.wizardContent}>
            <Text style={styles.wizardTitle}>Nome do Local</Text>
            <Text style={styles.wizardSubtitle}>Como quer identificar este local de trabalho?</Text>
            
            <Input
              placeholder="Ex: Escritório Principal"
              value={wizardData.name}
              onChangeText={(text) => setWizardData(prev => ({ ...prev, name: text }))}
              style={{ marginTop: 20 }}
            />
            
            <Button
              title="Continuar"
              onPress={() => setWizardStep(2)}
              disabled={!wizardData.name.trim()}
              style={{ marginTop: 20 }}
            />
          </View>
        );
        
      case 2: // Map picker
        return (
          <View style={styles.wizardContent}>
            <Text style={styles.wizardTitle}>Localização</Text>
            <Text style={styles.wizardSubtitle}>
              Mova o mapa para posicionar o pin no local exato.
              {'\n'}
              <Text style={styles.warningText}>⚠️ A localização ficará BLOQUEADA após confirmar.</Text>
            </Text>
            
            <View style={styles.mapContainer}>
              {Platform.OS === 'web' ? (
                <View style={styles.webMapFallback}>
                  <Ionicons name="map" size={48} color="#1a73e8" />
                  <Text style={styles.webMapText}>Mapa não disponível na web</Text>
                  <Text style={styles.webMapCoords}>
                    {wizardData.latitude?.toFixed(6) || userLocation?.latitude.toFixed(6)},{' '}
                    {wizardData.longitude?.toFixed(6) || userLocation?.longitude.toFixed(6)}
                  </Text>
                  <Button
                    title="Usar localização atual"
                    onPress={() => {
                      if (userLocation) {
                        setWizardData(prev => ({
                          ...prev,
                          latitude: userLocation.latitude,
                          longitude: userLocation.longitude
                        }));
                      }
                    }}
                    variant="outline"
                    size="small"
                    style={{ marginTop: 16 }}
                  />
                </View>
              ) : (
                <MapView
                  style={styles.map}
                  region={mapRegion}
                  onRegionChangeComplete={handleMapRegionChange}
                  showsUserLocation
                  showsMyLocationButton
                >
                  {wizardData.latitude && wizardData.longitude && (
                    <>
                      <Marker
                        coordinate={{
                          latitude: wizardData.latitude,
                          longitude: wizardData.longitude,
                        }}
                        draggable={!editingWorkplace}
                        onDragEnd={(e) => {
                          const { latitude, longitude } = e.nativeEvent.coordinate;
                          setWizardData(prev => ({ ...prev, latitude, longitude }));
                        }}
                      />
                      <Circle
                        center={{
                          latitude: wizardData.latitude,
                          longitude: wizardData.longitude,
                        }}
                        radius={wizardData.radiusMeters}
                        fillColor="rgba(26, 115, 232, 0.2)"
                        strokeColor="rgba(26, 115, 232, 0.8)"
                        strokeWidth={2}
                      />
                    </>
                  )}
                </MapView>
              )}
              
              {/* Center pin indicator */}
              <View style={styles.centerPin}>
                <Ionicons name="location" size={40} color="#1a73e8" />
              </View>
            </View>
            
            <View style={styles.radiusSelector}>
              <Text style={styles.radiusLabel}>Raio: {wizardData.radiusMeters}m</Text>
              <View style={styles.radiusButtons}>
                {[50, 100, 150, 200, 300].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.radiusButton,
                      wizardData.radiusMeters === r && styles.radiusButtonActive
                    ]}
                    onPress={() => setWizardData(prev => ({ ...prev, radiusMeters: r }))}
                  >
                    <Text style={[
                      styles.radiusButtonText,
                      wizardData.radiusMeters === r && styles.radiusButtonTextActive
                    ]}>{r}m</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            <Button
              title="Confirmar Localização"
              onPress={() => setWizardStep(3)}
              style={{ marginTop: 16 }}
            />
          </View>
        );
        
      case 3: // Workdays
        return (
          <View style={styles.wizardContent}>
            <Text style={styles.wizardTitle}>Dias de Trabalho</Text>
            <Text style={styles.wizardSubtitle}>Selecione os dias em que normalmente trabalha aqui</Text>
            
            <View style={styles.presetsRow}>
              <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset('weekdays')}>
                <Text style={styles.presetText}>Seg-Sex</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset('weekends')}>
                <Text style={styles.presetText}>Fins-de-semana</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset('everyday')}>
                <Text style={styles.presetText}>Todos</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.workdaysGrid}>
              {[
                { key: 'monday', label: 'Seg' },
                { key: 'tuesday', label: 'Ter' },
                { key: 'wednesday', label: 'Qua' },
                { key: 'thursday', label: 'Qui' },
                { key: 'friday', label: 'Sex' },
                { key: 'saturday', label: 'Sáb' },
                { key: 'sunday', label: 'Dom' },
              ].map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.dayButton,
                    wizardData.workdays[key as keyof WorkdaysConfig] && styles.dayButtonActive
                  ]}
                  onPress={() => toggleWorkday(key as keyof WorkdaysConfig)}
                >
                  <Text style={[
                    styles.dayButtonText,
                    wizardData.workdays[key as keyof WorkdaysConfig] && styles.dayButtonTextActive
                  ]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={styles.hintText}>
              Nota: Os dias de trabalho são informativos e ajudam na visualização. Não bloqueiam registos.
            </Text>
            
            <Button
              title="Continuar"
              onPress={() => setWizardStep(4)}
              style={{ marginTop: 20 }}
            />
          </View>
        );
        
      case 4: // Schedule (optional)
        return (
          <View style={styles.wizardContent}>
            <Text style={styles.wizardTitle}>Horário (Opcional)</Text>
            <Text style={styles.wizardSubtitle}>Configure o horário típico de trabalho</Text>
            
            <TouchableOpacity
              style={styles.scheduleToggle}
              onPress={() => setWizardData(prev => ({
                ...prev,
                schedule: prev.schedule ? null : { startTime: '09:00', endTime: '18:00', marginMinutes: 120 }
              }))}
            >
              <Ionicons
                name={wizardData.schedule ? 'checkbox' : 'square-outline'}
                size={24}
                color="#1a73e8"
              />
              <Text style={styles.scheduleToggleText}>Definir horário</Text>
            </TouchableOpacity>
            
            {wizardData.schedule && (
              <View style={styles.scheduleInputs}>
                <View style={styles.scheduleRow}>
                  <Text style={styles.scheduleLabel}>Início:</Text>
                  <Input
                    value={wizardData.schedule.startTime}
                    onChangeText={(text) => setWizardData(prev => ({
                      ...prev,
                      schedule: prev.schedule ? { ...prev.schedule, startTime: text } : null
                    }))}
                    placeholder="09:00"
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                </View>
                
                <View style={styles.scheduleRow}>
                  <Text style={styles.scheduleLabel}>Fim:</Text>
                  <Input
                    value={wizardData.schedule.endTime}
                    onChangeText={(text) => setWizardData(prev => ({
                      ...prev,
                      schedule: prev.schedule ? { ...prev.schedule, endTime: text } : null
                    }))}
                    placeholder="18:00"
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                </View>
              </View>
            )}
            
            <Text style={styles.hintText}>
              O horário é informativo e não bloqueia registos de ponto.
            </Text>
            
            <Button
              title={editingWorkplace ? "Guardar Alterações" : "Criar Local de Trabalho"}
              onPress={handleCreateWorkplace}
              style={{ marginTop: 20 }}
            />
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Locais de Trabalho</Text>
        <TouchableOpacity style={styles.addButton} onPress={openWizard}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1a73e8']} />
        }
      >
        {workplaces.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="business-outline" size={64} color="#ccc" />
            <Text style={styles.emptyTitle}>Sem locais configurados</Text>
            <Text style={styles.emptyText}>
              Adicione o seu primeiro local de trabalho para começar a registar ponto.
            </Text>
            <Button
              title="Adicionar Local"
              onPress={openWizard}
              style={{ marginTop: 16 }}
            />
          </View>
        ) : (
          workplaces.map((workplace) => (
            <View key={workplace.id} style={[
              styles.workplaceCard,
              workplace.isActive && styles.workplaceCardActive
            ]}>
              <View style={styles.workplaceHeader}>
                <View style={styles.workplaceNameRow}>
                  <Text style={styles.workplaceName}>{workplace.name}</Text>
                  {workplace.isActive && (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>ATIVO</Text>
                    </View>
                  )}
                </View>
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={12} color="#999" />
                  <Text style={styles.lockText}>Local bloqueado</Text>
                </View>
              </View>
              
              <View style={styles.workplaceDetails}>
                <View style={styles.detailRow}>
                  <Ionicons name="location" size={16} color="#666" />
                  <Text style={styles.detailText}>
                    {workplace.latitude.toFixed(4)}, {workplace.longitude.toFixed(4)}
                  </Text>
                </View>
                
                <View style={styles.detailRow}>
                  <Ionicons name="radio-button-on" size={16} color="#666" />
                  <Text style={styles.detailText}>Raio: {workplace.radiusMeters}m</Text>
                </View>
                
                <View style={styles.detailRow}>
                  <Ionicons name="calendar" size={16} color="#666" />
                  <Text style={styles.detailText}>
                    {Object.entries(workplace.workdays)
                      .filter(([_, v]) => v)
                      .map(([k]) => k.substring(0, 3))
                      .join(', ') || 'Nenhum dia'}
                  </Text>
                </View>
                
                {workplace.schedule && (
                  <View style={styles.detailRow}>
                    <Ionicons name="time" size={16} color="#666" />
                    <Text style={styles.detailText}>
                      {workplace.schedule.startTime} - {workplace.schedule.endTime}
                    </Text>
                  </View>
                )}
              </View>
              
              <View style={styles.workplaceActions}>
                {!workplace.isActive && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleSetActive(workplace)}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#28a745" />
                    <Text style={[styles.actionText, { color: '#28a745' }]}>Ativar</Text>
                  </TouchableOpacity>
                )}
                
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleEditWorkplace(workplace)}
                >
                  <Ionicons name="pencil-outline" size={20} color="#1a73e8" />
                  <Text style={[styles.actionText, { color: '#1a73e8' }]}>Editar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#1a73e8" />
          <Text style={styles.infoText}>
            A localização fica bloqueada após criar o local. Para mudar de endereço, crie um novo local de trabalho.
          </Text>
        </View>
      </ScrollView>

      {/* Wizard Modal */}
      <Modal visible={wizardVisible} animationType="slide">
        <SafeAreaView style={styles.wizardContainer}>
          <View style={styles.wizardHeader}>
            <TouchableOpacity onPress={() => setWizardVisible(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
            <Text style={styles.wizardHeaderTitle}>
              {editingWorkplace ? 'Editar Local' : 'Novo Local de Trabalho'}
            </Text>
            <View style={{ width: 28 }} />
          </View>
          
          {!editingWorkplace && (
            <View style={styles.wizardProgress}>
              {[1, 2, 3, 4].map((step) => (
                <View
                  key={step}
                  style={[
                    styles.progressDot,
                    wizardStep >= step && styles.progressDotActive
                  ]}
                />
              ))}
            </View>
          )}
          
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            {renderWizardStep()}
          </ScrollView>
          
          {wizardStep > 1 && !editingWorkplace && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setWizardStep(prev => prev - 1)}
            >
              <Ionicons name="arrow-back" size={24} color="#1a73e8" />
              <Text style={styles.backButtonText}>Voltar</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  addButton: {
    backgroundColor: '#1a73e8',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingTop: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  workplaceCard: {
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
  workplaceCardActive: {
    borderWidth: 2,
    borderColor: '#1a73e8',
  },
  workplaceHeader: {
    marginBottom: 12,
  },
  workplaceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  workplaceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  activeBadge: {
    backgroundColor: '#28a745',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  lockText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 4,
  },
  workplaceDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  detailText: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
  },
  workplaceActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#1a73e8',
    lineHeight: 18,
  },
  // Wizard styles
  wizardContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  wizardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  wizardHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  wizardProgress: {
    flexDirection: 'row',
    justifyContent: 'center',
    padding: 16,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ddd',
    marginHorizontal: 4,
  },
  progressDotActive: {
    backgroundColor: '#1a73e8',
  },
  wizardContent: {
    padding: 20,
    flex: 1,
  },
  wizardTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  wizardSubtitle: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  warningText: {
    color: '#dc3545',
    fontWeight: '500',
  },
  mapContainer: {
    height: 300,
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  map: {
    flex: 1,
  },
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -40,
  },
  webMapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  webMapText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
  },
  webMapCoords: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  radiusSelector: {
    marginTop: 16,
  },
  radiusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  radiusButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  radiusButton: {
    flex: 1,
    paddingVertical: 8,
    marginHorizontal: 2,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  radiusButtonActive: {
    backgroundColor: '#1a73e8',
  },
  radiusButtonText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  radiusButtonTextActive: {
    color: '#fff',
  },
  presetsRow: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 16,
  },
  presetButton: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#e3f2fd',
    alignItems: 'center',
  },
  presetText: {
    fontSize: 12,
    color: '#1a73e8',
    fontWeight: '600',
  },
  workdaysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  dayButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 6,
  },
  dayButtonActive: {
    backgroundColor: '#1a73e8',
  },
  dayButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  dayButtonTextActive: {
    color: '#fff',
  },
  hintText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  scheduleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginTop: 16,
  },
  scheduleToggleText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
  },
  scheduleInputs: {
    marginTop: 16,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  scheduleLabel: {
    width: 60,
    fontSize: 14,
    color: '#666',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  backButtonText: {
    fontSize: 16,
    color: '#1a73e8',
    marginLeft: 8,
  },
});
