import * as Location from 'expo-location';
import { Platform } from 'react-native';

export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (value: number): number => (value * Math.PI) / 180;

export const requestLocationPermissions = async (): Promise<boolean> => {
  try {
    // Request foreground permission first
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== 'granted') {
      return false;
    }

    // For mobile, also request background permission
    if (Platform.OS !== 'web') {
      try {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        if (backgroundStatus !== 'granted') {
            // Still return true - app can work without background location
          }
      } catch {
        // Background permission might not be available in Expo Go
      }
    }

    return true;
  } catch (error: any) {
    console.error('Error requesting location permissions:', error);
    
    // Check if this is the Expo Go Info.plist error
    if (error?.message?.includes('NSLocation') || error?.message?.includes('Info.plist')) {
      // This happens in Expo Go - permissions work in development/production builds
      return false;
    }
    
    return false;
  }
};

export const getCurrentLocation = async (): Promise<Location.LocationObject | null> => {
  try {
    // First check if we can even use location services
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      return null;
    }

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const granted = await requestLocationPermissions();
      if (!granted) return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return location;
  } catch (error: any) {
    console.error('Error getting current location:', error);
    
    if (error?.message?.includes('NSLocation') || error?.message?.includes('Info.plist')) {
      // Handle Expo Go limitation gracefully
    }
    
    return null;
  }
};

export const formatTime = (dateString: string | null): string => {
  if (!dateString) return '--:--';
  const date = new Date(dateString);
  return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};

export const generateEventId = (): string => {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
