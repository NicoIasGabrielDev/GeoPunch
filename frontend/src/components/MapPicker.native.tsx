import React, { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import type { GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';

// Try to load react-native-maps; it requires a dev-client / standalone build.
// In Expo Go the native module is missing, so we fall back to a simple UI.
let MapView: typeof import('react-native-maps').default | null = null;
let Marker: typeof import('react-native-maps').Marker | null = null;
let Circle: typeof import('react-native-maps').Circle | null = null;
type MapViewType = import('react-native-maps').default;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Circle = maps.Circle;
} catch {
  // react-native-maps native module not available (Expo Go)
}

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

/* ───────────── Fallback when native maps is unavailable ───────────── */

const MapPickerFallback: React.FC<MapPickerProps> = ({
  latitude,
  longitude,
  radiusMeters,
  onLocationSelect,
  userLatitude,
  userLongitude,
}) => {
  const handleUseCurrentLocation = () => {
    if (userLatitude && userLongitude) {
      onLocationSelect(userLatitude, userLongitude);
    }
  };

  return (
    <View style={styles.fallback}>
      <Ionicons name="map" size={48} color="#1a73e8" />
      <Text style={styles.fallbackTitle}>Mapa nativo indisponível</Text>
      <Text style={styles.fallbackHint}>
        Está a usar o Expo Go. Para o mapa interativo, use um development build.
      </Text>
      <Text style={styles.fallbackCoords}>
        {latitude?.toFixed(6) ?? '—'}, {longitude?.toFixed(6) ?? '—'}
      </Text>
      <Text style={styles.fallbackRadius}>Raio: {radiusMeters}m</Text>
      {userLatitude && userLongitude && (
        <TouchableOpacity style={styles.fallbackBtn} onPress={handleUseCurrentLocation}>
          <Ionicons name="locate" size={18} color="#fff" />
          <Text style={styles.fallbackBtnText}>Usar localização atual</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

/* ───────────── Full MapView when native module exists ───────────── */

const MapPickerNative: React.FC<MapPickerProps> = ({
  latitude,
  longitude,
  radiusMeters,
  onLocationSelect,
  editable = true,
  showUserLocation = true,
  userLatitude,
  userLongitude,
}) => {
  const mapRef = useRef<MapViewType | null>(null);
  const placesRef = useRef<GooglePlacesAutocompleteRef | null>(null);

  const centreLat = latitude ?? userLatitude ?? 38.7223;
  const centreLng = longitude ?? userLongitude ?? -9.1393;

  useEffect(() => {
    if (!latitude && !longitude && userLatitude && userLongitude && mapRef.current) {
      (mapRef.current as MapViewType).animateToRegion(
        {
          latitude: userLatitude,
          longitude: userLongitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        600,
      );
    }
  }, [userLatitude, userLongitude, latitude, longitude]);

  const handlePlaceSelect = (data: unknown, details: { geometry: { location: { lat: number; lng: number } } } | null) => {
    if (details?.geometry?.location) {
      const { lat, lng } = details.geometry.location;
      onLocationSelect(lat, lng);

      // Limpa o campo para permitir nova pesquisa
      placesRef.current?.clear();
      
      // Anima o mapa para o novo local
      if (mapRef.current) {
        (mapRef.current as MapViewType).animateToRegion(
          {
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          600,
        );
      }
    }
  };

  const hasPin = latitude !== null && longitude !== null;

  const MV = MapView!;
  const MK = Marker!;
  const CR = Circle!;

  const GOOGLE_PLACES_API_KEY =
    process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';

  return (
    <View style={styles.container}>
      <GooglePlacesAutocomplete
        ref={placesRef}
        placeholder="Pesquisar endereço..."
        onPress={handlePlaceSelect}
        query={{
          key: GOOGLE_PLACES_API_KEY,
          language: 'pt-PT',
        }}
        fetchDetails={true}
        enablePoweredByContainer={false}
        debounce={300}
        minLength={2}
        keyboardShouldPersistTaps="handled"
        textInputProps={{
          autoCorrect: false,
          autoCapitalize: 'none',
          clearButtonMode: 'while-editing',
        }}
        styles={{
          container: styles.searchContainer,
          textInput: styles.searchInput,
          listView: styles.searchListView,
          row: styles.searchRow,
          description: styles.searchDescription,
        }}
      />
      <MV
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: centreLat,
          longitude: centreLng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={showUserLocation}
        showsMyLocationButton={showUserLocation}
        onPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
          if (!editable) return;
          const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
          onLocationSelect(lat, lng);
        }}
      >
        {hasPin && (
          <>
            <MK
              coordinate={{ latitude: latitude!, longitude: longitude! }}
              draggable={editable}
              onDragEnd={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
                if (!editable) return;
                const { latitude: lat, longitude: lng } = e.nativeEvent.coordinate;
                onLocationSelect(lat, lng);
              }}
              title="Local de trabalho"
              description={`Raio: ${radiusMeters}m`}
            />
            <CR
              center={{ latitude: latitude!, longitude: longitude! }}
              radius={radiusMeters}
              fillColor="rgba(26, 115, 232, 0.15)"
              strokeColor="rgba(26, 115, 232, 0.8)"
              strokeWidth={2}
            />
          </>
        )}
      </MV>
    </View>
  );
};

/* ───────────── Exported component – picks the right implementation ───────────── */

export const MapPicker: React.FC<MapPickerProps> = (props) => {
  const [nativeAvailable] = useState(() => MapView !== null);

  if (!nativeAvailable) {
    return <MapPickerFallback {...props} />;
  }
  return <MapPickerNative {...props} />;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  searchContainer: {
    position: 'absolute',
    width: '90%',
    top: 10,
    left: '5%',
    right: '5%',
    zIndex: 1,
  },
  searchInput: {
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  searchListView: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  searchRow: {
    padding: 13,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchDescription: {
    fontSize: 14,
    color: '#333',
  },
  map: {
    flex: 1,
    minHeight: 300,
  },
  fallback: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f0f4ff',
    borderRadius: 12,
  },
  fallbackTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
  },
  fallbackHint: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  fallbackCoords: {
    fontSize: 14,
    color: '#1a73e8',
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },
  fallbackRadius: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    fontWeight: '600',
  },
  fallbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a73e8',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  fallbackBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
});

export default MapPicker;
