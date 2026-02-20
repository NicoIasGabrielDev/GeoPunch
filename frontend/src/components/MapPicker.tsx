import React from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onRegionChange: (lat: number, lng: number) => void;
  editable?: boolean;
  showUserLocation?: boolean;
}

// Web fallback component
const WebMapFallback: React.FC<MapPickerProps> = ({ 
  latitude, 
  longitude, 
  radiusMeters,
  onRegionChange 
}) => {
  return (
    <View style={styles.webMapFallback}>
      <Ionicons name="map" size={48} color="#1a73e8" />
      <Text style={styles.webMapText}>Mapa não disponível na web</Text>
      <Text style={styles.webMapCoords}>
        {latitude?.toFixed(6) || '0.000000'}, {longitude?.toFixed(6) || '0.000000'}
      </Text>
      <Text style={styles.webMapHint}>
        Use a aplicação móvel para selecionar a localização no mapa
      </Text>
    </View>
  );
};

// Native map component wrapper
let NativeMapView: React.FC<MapPickerProps> | null = null;

// Only load native maps on non-web platforms
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Maps = require('react-native-maps');
    const RNMapView = Maps.default;
    const RNMarker = Maps.Marker;
    const RNCircle = Maps.Circle;

    NativeMapView = ({ 
      latitude, 
      longitude, 
      radiusMeters, 
      onRegionChange, 
      editable = true,
      showUserLocation = true 
    }) => {
      const lat = latitude || 38.7223;
      const lng = longitude || -9.1393;
      
      return (
        <RNMapView
          style={styles.map}
          initialRegion={{
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          onRegionChangeComplete={(region: any) => {
            if (editable) {
              onRegionChange(region.latitude, region.longitude);
            }
          }}
          showsUserLocation={showUserLocation}
          showsMyLocationButton={showUserLocation}
        >
          <RNMarker
            coordinate={{ latitude: lat, longitude: lng }}
            draggable={editable}
            onDragEnd={(e: any) => {
              if (editable) {
                const { latitude: newLat, longitude: newLng } = e.nativeEvent.coordinate;
                onRegionChange(newLat, newLng);
              }
            }}
          />
          <RNCircle
            center={{ latitude: lat, longitude: lng }}
            radius={radiusMeters}
            fillColor="rgba(26, 115, 232, 0.2)"
            strokeColor="rgba(26, 115, 232, 0.8)"
            strokeWidth={2}
          />
        </RNMapView>
      );
    };
  } catch (error) {
    console.log('react-native-maps not available:', error);
  }
}

export const MapPicker: React.FC<MapPickerProps> = (props) => {
  if (Platform.OS === 'web' || !NativeMapView) {
    return <WebMapFallback {...props} />;
  }

  return <NativeMapView {...props} />;
};

const styles = StyleSheet.create({
  map: {
    flex: 1,
    minHeight: 300,
  },
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
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  webMapHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
});

export default MapPicker;
