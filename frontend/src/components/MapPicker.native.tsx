import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';

interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onRegionChange: (lat: number, lng: number) => void;
  editable?: boolean;
  showUserLocation?: boolean;
}

export const MapPicker: React.FC<MapPickerProps> = ({ 
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
    <MapView
      style={styles.map}
      initialRegion={{
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }}
      onRegionChangeComplete={(region) => {
        if (editable) {
          onRegionChange(region.latitude, region.longitude);
        }
      }}
      showsUserLocation={showUserLocation}
      showsMyLocationButton={showUserLocation}
    >
      <Marker
        coordinate={{ latitude: lat, longitude: lng }}
        draggable={editable}
        onDragEnd={(e) => {
          if (editable) {
            const { latitude: newLat, longitude: newLng } = e.nativeEvent.coordinate;
            onRegionChange(newLat, newLng);
          }
        }}
      />
      <Circle
        center={{ latitude: lat, longitude: lng }}
        radius={radiusMeters}
        fillColor="rgba(26, 115, 232, 0.2)"
        strokeColor="rgba(26, 115, 232, 0.8)"
        strokeWidth={2}
      />
    </MapView>
  );
};

const styles = StyleSheet.create({
  map: {
    flex: 1,
    minHeight: 300,
  },
});

export default MapPicker;
