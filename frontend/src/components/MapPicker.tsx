// This file exists so TypeScript can resolve the MapPicker import.
// At runtime, Metro uses MapPicker.native.tsx (mobile) or MapPicker.web.tsx (web).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onLocationSelect: (lat: number, lng: number) => void;
  editable?: boolean;
  showUserLocation?: boolean;
  userLatitude?: number;
  userLongitude?: number;
}

// Fallback – only used if neither .native nor .web is resolved
export const MapPicker: React.FC<MapPickerProps> = ({
  latitude,
  longitude,
  radiusMeters,
}) => {
  return (
    <View style={styles.fallback}>
      <Text style={styles.text}>
        {latitude?.toFixed(6) ?? '—'}, {longitude?.toFixed(6) ?? '—'}
      </Text>
      <Text style={styles.sub}>Raio: {radiusMeters}m</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
  },
  text: { fontSize: 14, color: '#666' },
  sub: { fontSize: 12, color: '#999', marginTop: 4 },
});

export default MapPicker;
