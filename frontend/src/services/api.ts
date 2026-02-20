import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://email-2.preview.emergentagent.com';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
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

export const removeToken = async (): Promise<void> => {
  try {
    if (Platform.OS === 'web') {
      localStorage.removeItem('auth_token');
    } else {
      await SecureStore.deleteItemAsync('auth_token');
    }
  } catch (error) {
    console.error('Error removing token:', error);
  }
};

// Request interceptor to add token
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

// Auth endpoints
export const authApi = {
  register: (data: { email: string; password: string; name: string; employeeId?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
};

// Workplace endpoints
export const workplaceApi = {
  getUserWorkplace: () => api.get('/workplace'),
  listAll: () => api.get('/admin/workplaces'),
  create: (data: any) => api.post('/admin/workplaces', data),
  update: (id: string, data: any) => api.put(`/admin/workplaces/${id}`, data),
  delete: (id: string) => api.delete(`/admin/workplaces/${id}`),
  assignToUser: (userId: string, workplaceId: string) =>
    api.post('/admin/assign-workplace', { userId, workplaceId }),
};

// Users endpoint (admin)
export const usersApi = {
  list: () => api.get('/admin/users'),
};

// Events endpoints
export const eventsApi = {
  processGeofence: (data: any) => api.post('/events/geofence', data),
  manualPunch: (data: { punchType: string; latitude: number; longitude: number; accuracy: number }) =>
    api.post('/punch/manual', data),
  manualBreak: (data: { breakType: string; latitude: number; longitude: number; accuracy: number }) =>
    api.post('/break/manual', data),
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

// Seed endpoint
export const seedData = () => api.post('/seed');

export default api;
