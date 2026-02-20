import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Use environment variable - required for deployment
const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!API_URL) {
  console.warn('EXPO_PUBLIC_BACKEND_URL not set - API calls may fail');
}

const api = axios.create({
  baseURL: `${API_URL || ''}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Token storage functions
export const getToken = async (): Promise<string | null> => {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem('auth_token');
    }
    return await SecureStore.getItemAsync('auth_token');
  } catch {
    return null;
  }
};

export const setToken = async (token: string): Promise<void> => {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem('auth_token', token);
    } else {
      await SecureStore.setItemAsync('auth_token', token);
    }
  } catch (error) {
    console.error('Error saving token:', error);
  }
};

export const getRefreshToken = async (): Promise<string | null> => {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem('refresh_token');
    }
    return await SecureStore.getItemAsync('refresh_token');
  } catch {
    return null;
  }
};

export const setRefreshToken = async (token: string): Promise<void> => {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem('refresh_token', token);
    } else {
      await SecureStore.setItemAsync('refresh_token', token);
    }
  } catch (error) {
    console.error('Error saving refresh token:', error);
  }
};

export const removeToken = async (): Promise<void> => {
  try {
    if (Platform.OS === 'web') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
    } else {
      await SecureStore.deleteItemAsync('auth_token');
      await SecureStore.deleteItemAsync('refresh_token');
    }
  } catch (error) {
    console.error('Error removing token:', error);
  }
};

// Request interceptor
api.interceptors.request.use(
  async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
          const response = await axios.post(`${API_URL}/api/auth/refresh`, {
            refresh_token: refreshToken
          });
          
          const { access_token, refresh_token: newRefreshToken } = response.data;
          await setToken(access_token);
          await setRefreshToken(newRefreshToken);
          
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        await removeToken();
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authApi = {
  register: (data: { email: string; password: string; name: string; employeeId?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
};

// Workplace endpoints (user-owned)
export const workplaceApi = {
  list: () => api.get('/workplaces'),
  create: (data: any) => api.post('/workplaces', data),
  update: (id: string, data: any) => api.put(`/workplaces/${id}`, data),
  setActive: (id: string) => api.post(`/workplaces/${id}/activate`),
  getActive: () => api.get('/workplaces/active'),
  // Legacy
  getUserWorkplace: () => api.get('/workplace'),
  // Admin endpoints (legacy - kept for backwards compatibility)
  listAll: () => api.get('/admin/workplaces'),
  delete: (id: string) => api.delete(`/admin/workplaces/${id}`),
  assignToUser: (userId: string, workplaceId: string) => 
    api.post('/admin/assign-workplace', { user_id: userId, workplace_id: workplaceId }),
};

// Users endpoints (admin)
export const usersApi = {
  list: () => api.get('/admin/users'),
};

// Punch endpoints
export const punchApi = {
  create: (data: {
    punchType: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    note?: string;
    method?: string;
  }) => api.post('/punch', data),
  // Legacy endpoints
  manualPunch: (data: any) => api.post('/punch/manual', data),
  manualBreak: (data: any) => api.post('/break/manual', data),
};

// Events endpoints
export const eventsApi = {
  processGeofence: (data: any) => api.post('/events/geofence', data),
  // Legacy compatibility
  manualPunch: (data: any) => punchApi.create({
    ...data,
    punchType: data.punchType === 'CLOCK_IN' ? 'IN' : data.punchType === 'CLOCK_OUT' ? 'OUT' : data.punchType
  }),
  manualBreak: (data: any) => punchApi.create({
    ...data,
    punchType: data.breakType === 'LUNCH_START' ? 'BREAK_START' : data.breakType === 'LUNCH_END' ? 'BREAK_END' : data.breakType
  }),
};

// Timesheet endpoints
export const timesheetApi = {
  getTimesheet: (fromDate?: string, toDate?: string) =>
    api.get('/timesheet', { params: { from_date: fromDate, to_date: toDate } }),
  getTodayStatus: () => api.get('/timesheet/today'),
  exportCsv: (fromDate: string, toDate: string) =>
    api.get('/export/timesheet.csv', {
      params: { from_date: fromDate, to_date: toDate },
      responseType: 'blob',
    }),
  exportXlsx: (fromDate: string, toDate: string) =>
    api.get('/export/timesheet.xlsx', {
      params: { from_date: fromDate, to_date: toDate },
      responseType: 'blob',
    }),
};

// Geocoding
export const geocodeApi = {
  reverse: (lat: number, lng: number) => api.get('/geocode/reverse', { params: { lat, lng } }),
};

// Seed endpoint
export const seedData = () => api.post('/seed');

export default api;
