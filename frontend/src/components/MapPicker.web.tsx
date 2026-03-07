import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onLocationSelect: (lat: number, lng: number) => void;
  editable?: boolean;
  showUserLocation?: boolean;
  userLatitude?: number;
  userLongitude?: number;
}

// Web-only implementation - no map, just coordinates display
export const MapPicker: React.FC<MapPickerProps> = ({
  latitude,
  longitude,
  radiusMeters,
}) => {
  return (
    <View style={styles.webMapFallback}>
      <Ionicons name="map" size={48} color="#1a73e8" />
      <Text style={styles.webMapText}>Mapa não disponível na web</Text>
      <Text style={styles.webMapCoords}>
        {latitude?.toFixed(6) ?? '0.000000'}, {longitude?.toFixed(6) ?? '0.000000'}
      </Text>
      <Text style={styles.webMapHint}>
        Use a aplicação móvel para selecionar a localização no mapa
      </Text>
      <Text style={styles.radiusInfo}>
        Raio: {radiusMeters}m
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  webMapFallback: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
  },
  webMapText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
  },
  webMapCoords: {
    fontSize: 14,
    color: '#1a73e8',
    marginTop: 8,
    fontFamily: 'monospace',
  },
  webMapHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
  radiusInfo: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    fontWeight: '600',
  },
});

export default MapPicker;
