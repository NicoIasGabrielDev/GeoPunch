import axios, { AxiosInstance, AxiosError } from 'axios';
import { getAccessToken } from '../config/supabase';

// Get backend URL from environment
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Remove trailing slash if present to avoid double slashes
const baseUrl = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';

// Create axios instance for backend API
const backendApi: AxiosInstance = axios.create({
  baseURL: `${baseUrl}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor to add Supabase JWT token
backendApi.interceptors.request.use(
  async (config) => {
    try {
      const token = await getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('❌ Error getting access token:', error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
backendApi.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    console.error('❌ Request failed:', error.config?.url, '- Status:', error.response?.status);
    console.error('❌ Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// ============================================================================
// BACKEND API SERVICES
// ============================================================================

/**
 * Auth Services
 * Get current user profile from backend
 */
export const authService = {
  /**
   * Register user in backend
   * Called after Supabase registration to create user in backend database
   */
  register: async (data: { email: string; password: string; name: string; employeeId?: string }) => {
    const response = await backendApi.post('/auth/register', data);
    return response.data;
  },

  /**
   * Get current user profile
   * Backend validates the Supabase JWT and returns user data
   */
  getMe: async () => {
    const response = await backendApi.get('/auth/me');
    return response.data;
  },
};

/**
 * Workplace Services
 * Manage user workplaces
 */
export const workplaceService = {
  /**
   * List all workplaces for current user
   */
  list: async () => {
    const response = await backendApi.get('/workplaces');
    return response.data;
  },

  /**
   * Create a new workplace
   */
  create: async (data: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    workdays: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
    schedule?: {
      startTime: string;
      endTime: string;
      marginMinutes: number;
    };
    locationLocked?: boolean;
  }) => {
    const response = await backendApi.post('/workplaces', data);
    return response.data;
  },

  /**
   * Update an existing workplace
   */
  update: async (id: string, data: any) => {
    const response = await backendApi.put(`/workplaces/${id}`, data);
    return response.data;
  },

  /**
   * Set a workplace as active
   */
  setActive: async (id: string) => {
    const response = await backendApi.post(`/workplaces/${id}/activate`);
    return response.data;
  },

  /**
   * Get the active workplace
   */
  getActive: async () => {
    const response = await backendApi.get('/workplaces/active');
    return response.data;
  },
};

/**
 * Punch Services
 * Record clock in/out events
 */
export const punchService = {
  /**
   * Create a new punch record
   */
  create: async (data: {
    punchType: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
    latitude: number;
    longitude: number;
    accuracy: number;
    note?: string;
    method?: 'MANUAL' | 'GEOFENCE' | 'BLUETOOTH';
  }) => {
    const response = await backendApi.post('/punch', data);
    return response.data;
  },
};

/**
 * Timesheet Services
 * Get timesheet data and status
 */
export const timesheetService = {
  /**
   * Get today's status (current state, last punch, etc.)
   */
  getTodayStatus: async () => {
    const response = await backendApi.get('/timesheet/today');
    return response.data;
  },

  /**
   * Get timesheet for a date range
   */
  getTimesheet: async (fromDate?: string, toDate?: string) => {
    const response = await backendApi.get('/timesheet', {
      params: { from_date: fromDate, to_date: toDate },
    });
    return response.data;
  },

  /**
   * Export timesheet as CSV
   */
  exportCsv: async (fromDate: string, toDate: string) => {
    const response = await backendApi.get('/export/timesheet.csv', {
      params: { from_date: fromDate, to_date: toDate },
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Export timesheet as XLSX
   */
  exportXlsx: async (fromDate: string, toDate: string) => {
    const response = await backendApi.get('/export/timesheet.xlsx', {
      params: { from_date: fromDate, to_date: toDate },
      responseType: 'blob',
    });
    return response.data;
  },
};

/**
 * Admin Services
 * Admin-only endpoints
 */
export const adminService = {
  /**
   * List all users (admin only)
   */
  listUsers: async () => {
    const response = await backendApi.get('/admin/users');
    return response.data;
  },

  /**
   * List all workplaces (admin only)
   */
  listWorkplaces: async () => {
    const response = await backendApi.get('/admin/workplaces');
    return response.data;
  },

  /**
   * Delete a workplace (admin only)
   */
  deleteWorkplace: async (id: string) => {
    const response = await backendApi.delete(`/admin/workplaces/${id}`);
    return response.data;
  },

  /**
   * Assign workplace to user (admin only)
   */
  assignWorkplace: async (userId: string, workplaceId: string) => {
    const response = await backendApi.post('/admin/assign-workplace', {
      user_id: userId,
      workplace_id: workplaceId,
    });
    return response.data;
  },
};

export default backendApi;
