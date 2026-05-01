import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { isScreenshotSeedEnabled } from '../../src/config/appMode';
import { useAuth } from '../../src/contexts/AuthContext';
import { screenshotSeedService } from '../../src/demo/screenshotSeed';
import { ensureBackendReady, workplaceService } from '../../src/services/backend';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { MapPicker } from '../../src/components/MapPicker';
import { Workplace, WorkdaysConfig } from '../../src/types';
import { getHumanReadableError } from '../../src/utils/network';

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
  const { user } = useAuth();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
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
  const isEnterpriseOwner = user?.role === 'enterprise_owner';
  const isEmployee = user?.role === 'employee';

  useFocusEffect(
    useCallback(() => {
      loadWorkplaces();
      getUserLocation();
    }, [])
  );

  const getUserLocation = async () => {
    if (isScreenshotSeedEnabled) {
      const demoLocation = screenshotSeedService.getCurrentLocation();
      setUserLocation({
        latitude: demoLocation.latitude,
        longitude: demoLocation.longitude,
      });
      return;
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } else {
        // Fallback to Lisbon, Portugal coordinates
        const defaultLocation = {
          latitude: 38.7223,
          longitude: -9.1393,
        };
        setUserLocation(defaultLocation);
      }
    } catch (error) {
      console.error('Error getting location:', error);
      // Fallback to Lisbon, Portugal coordinates on error
      const defaultLocation = {
        latitude: 38.7223,
        longitude: -9.1393,
      };
      setUserLocation(defaultLocation);
    }
  };

  const loadWorkplaces = async () => {
    try {
      setLoading(true);
      await ensureBackendReady();
      const data = await workplaceService.list();
      setWorkplaces(data ?? []);
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
    if (isEmployee) return;
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
  };

  const handleSetActive = async (workplace: Workplace) => {
    try {
      await workplaceService.setActive(workplace.id);
      Alert.alert('Sucesso', `'${workplace.name}' definido como local ativo`);
      await loadWorkplaces();
    } catch (error: any) {
      Alert.alert(
        'Erro',
        getHumanReadableError(error, {
          defaultMessage: 'Erro ao definir local ativo',
          service: 'backend',
        }),
      );
    }
  };

  const handleEditWorkplace = (workplace: Workplace) => {
    if (isEmployee) return;
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

  const handleLocationSelect = (lat: number, lng: number) => {
    if (editingWorkplace) return;
    setWizardData(prev => ({ ...prev, latitude: lat, longitude: lng }));
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
    
    if (wizardData.latitude == null || wizardData.longitude == null) {
      Alert.alert('Erro', 'Selecione a localização no mapa');
      return;
    }
    
    setSaving(true);
    try {
      const payload = editingWorkplace
        ? {
            name: wizardData.name,
            radiusMeters: wizardData.radiusMeters,
            workdays: wizardData.workdays,
            schedule: wizardData.schedule,
          }
        : {
            name: wizardData.name,
            latitude: wizardData.latitude!,
            longitude: wizardData.longitude!,
            radiusMeters: wizardData.radiusMeters,
            workdays: wizardData.workdays,
            schedule: wizardData.schedule,
          };

      if (editingWorkplace) {
        await workplaceService.update(editingWorkplace.id, payload);
        Alert.alert('Sucesso', 'Local de trabalho atualizado');
      } else {
        await workplaceService.create(payload);
        Alert.alert('Sucesso', 'Local de trabalho criado');
      }
      
      setWizardVisible(false);
    } catch (error: any) {
      const msg = getHumanReadableError(error, {
        defaultMessage: 'Erro ao guardar. Verifique a ligação e tente novamente.',
        service: 'backend',
      });
      Alert.alert('Erro', msg);
    } finally {
      setSaving(false);
      // Reload list in background — don't block the button
      loadWorkplaces().catch(() => {});
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
              Toque no mapa para posicionar o pin no local exato, ou arraste o marcador.
              {'\n'}
              <Text style={styles.warningText}>⚠️ A localização ficará BLOQUEADA após confirmar.</Text>
            </Text>

            <View style={styles.mapContainer}>
              <MapPicker
                latitude={wizardData.latitude}
                longitude={wizardData.longitude}
                radiusMeters={wizardData.radiusMeters}
                onLocationSelect={handleLocationSelect}
                editable={true}
                showUserLocation={true}
                userLatitude={userLocation?.latitude}
                userLongitude={userLocation?.longitude}
              />
            </View>

            {/* Coordinates display */}
            <View style={styles.coordsRow}>
              <Ionicons name="navigate" size={16} color="#1a73e8" />
              <Text style={styles.coordsText}>
                {wizardData.latitude?.toFixed(6) ?? '—'}, {wizardData.longitude?.toFixed(6) ?? '—'}
              </Text>
              <TouchableOpacity
                style={styles.useLocationBtn}
                onPress={() => {
                  if (userLocation) {
                    handleLocationSelect(userLocation.latitude, userLocation.longitude);
                  }
                }}
              >
                <Ionicons name="locate" size={16} color="#fff" />
                <Text style={styles.useLocationBtnText}>Usar atual</Text>
              </TouchableOpacity>
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
              onPress={() => {
                if (wizardData.latitude == null || wizardData.longitude == null) {
                  if (userLocation) {
                    setWizardData(prev => ({
                      ...prev,
                      latitude: userLocation.latitude,
                      longitude: userLocation.longitude,
                    }));
                  } else {
                    Alert.alert('Erro', 'Selecione a localização no mapa ou clique em "Usar atual"');
                    return;
                  }
                }
                setWizardStep(3);
              }}
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
              loading={saving}
              style={{ marginTop: 20 }}
            />
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.title}>{isEnterpriseOwner ? 'Locais da Empresa' : 'Locais de Trabalho'}</Text>
          <Text style={styles.headerSubtitle}>
            {isEnterpriseOwner
              ? 'Crie locais e atribua-os aos funcionários na área da empresa.'
              : isEmployee
                ? 'Use apenas os locais que lhe foram atribuídos.'
                : 'Configure os seus locais e horários.'}
          </Text>
        </View>
        {!isEmployee && (
          <TouchableOpacity style={styles.addButton} onPress={openWizard}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        )}
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
              {isEmployee
                ? 'A empresa ainda não lhe atribuiu nenhum local de trabalho.'
                : 'Adicione o seu primeiro local de trabalho para começar a registar ponto.'}
            </Text>
            {!isEmployee && (
              <Button
                title="Adicionar Local"
                onPress={openWizard}
                style={{ marginTop: 16 }}
              />
            )}
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
                {!isEnterpriseOwner && !workplace.isActive && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleSetActive(workplace)}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#28a745" />
                    <Text style={[styles.actionText, { color: '#28a745' }]}>Ativar</Text>
                  </TouchableOpacity>
                )}

                {!isEmployee && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleEditWorkplace(workplace)}
                  >
                    <Ionicons name="pencil-outline" size={20} color="#1a73e8" />
                    <Text style={[styles.actionText, { color: '#1a73e8' }]}>Editar</Text>
                  </TouchableOpacity>
                )}
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
          
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.wizardBody}
          >
            {wizardStep === 2 ? (
              <ScrollView
                contentContainerStyle={styles.locationStepScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {renderWizardStep()}
              </ScrollView>
            ) : (
              <ScrollView
                contentContainerStyle={styles.wizardStepScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {renderWizardStep()}
              </ScrollView>
            )}
          </KeyboardAvoidingView>
          
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
  headerSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
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
    paddingBottom: 32,
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
  wizardBody: {
    flex: 1,
  },
  wizardStepScrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  locationStepScrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
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
    height: 350,
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  coordsText: {
    flex: 1,
    fontSize: 13,
    color: '#666',
    marginLeft: 6,
    fontVariant: ['tabular-nums'],
  },
  useLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a73e8',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  useLocationBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
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
