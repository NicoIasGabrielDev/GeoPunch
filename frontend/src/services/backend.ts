import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getStoredAccessToken, refreshAuthSession, supabase } from '../config/supabase';
import { ScheduleConfig, WorkdaysConfig } from '../types';

// Get backend URL from environment
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BACKEND_URL) {
  throw new Error('Missing EXPO_PUBLIC_BACKEND_URL. Configure it before creating a production build.');
}

// Remove trailing slash if present to avoid double slashes
const baseUrl = BACKEND_URL.replace(/\/$/, '');

// Create axios instance for backend API
const backendApi: AxiosInstance = axios.create({
  baseURL: `${baseUrl}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000,
});

/** Race a promise against a timeout; resolves null on timeout */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

type WorkplacePayloadInput = {
  name: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  radiusMeters?: number | string | null;
  workdays?: Partial<WorkdaysConfig> | null;
  schedule?: Partial<ScheduleConfig> | null;
  startTime?: string;
  endTime?: string;
  allowedMarginMinutes?: number | string | null;
  marginMinutes?: number | string | null;
};

const DEFAULT_WORKDAYS: WorkdaysConfig = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

const toOptionalNumber = (value: number | string | null | undefined): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const toOptionalInteger = (value: number | string | null | undefined): number | undefined => {
  const parsed = toOptionalNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
};

const normalizeSchedule = (data: WorkplacePayloadInput): ScheduleConfig | undefined => {
  const startTime = data.schedule?.startTime ?? data.startTime;
  const endTime = data.schedule?.endTime ?? data.endTime;
  const marginMinutes = toOptionalInteger(
    data.schedule?.marginMinutes ?? data.marginMinutes ?? data.allowedMarginMinutes,
  );

  if (!startTime || !endTime || marginMinutes === undefined) {
    return undefined;
  }

  return {
    startTime,
    endTime,
    marginMinutes,
  };
};

const normalizeWorkdays = (
  workdays: Partial<WorkdaysConfig> | null | undefined,
  includeDefaults: boolean,
): WorkdaysConfig | undefined => {
  if (!workdays && !includeDefaults) {
    return undefined;
  }

  return {
    ...DEFAULT_WORKDAYS,
    ...(workdays ?? {}),
  };
};

const normalizeWorkplacePayload = (
  data: WorkplacePayloadInput,
  options: { requireCoordinates: boolean; includeDefaultWorkdays: boolean },
) => {
  const latitude = toOptionalNumber(data.latitude);
  const longitude = toOptionalNumber(data.longitude);
  const radiusMeters = toOptionalInteger(data.radiusMeters) ?? 150;
  const workdays = normalizeWorkdays(data.workdays, options.includeDefaultWorkdays);
  const schedule = normalizeSchedule(data);

  if (options.requireCoordinates && (latitude === undefined || longitude === undefined)) {
    throw new Error('Localizacao invalida para o local de trabalho');
  }

  return {
    name: data.name.trim(),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    radiusMeters,
    ...(workdays ? { workdays } : {}),
    ...(schedule ? { schedule } : {}),
  };
};

const setAuthorizationHeader = (config: InternalAxiosRequestConfig, token: string | null) => {
  if (!config.headers) {
    return;
  }

  if (token) {
    if (typeof config.headers.set === 'function') {
      config.headers.set('Authorization', `Bearer ${token}`);
      return;
    }

    config.headers.Authorization = `Bearer ${token}`;
    return;
  }

  if (typeof config.headers.delete === 'function') {
    config.headers.delete('Authorization');
    return;
  }

  delete config.headers.Authorization;
};

// Request interceptor to add Supabase JWT token
backendApi.interceptors.request.use(
  async (config) => {
    try {
      let token = await withTimeout(getAccessToken(), 10000);

      // Fallback: read session directly from Supabase SDK if primary path failed
      if (!token) {
        console.warn('⚠️ getAccessToken() returned null, trying direct Supabase session');
        try {
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token ?? null;
        } catch {
          // ignore — will proceed without token
        }
      }

      if (__DEV__ && !token) {
        console.warn('⚠️ No auth token available for request:', config.url);
      }

      setAuthorizationHeader(config, token);
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
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try refreshing via Supabase SDK
        const refreshedSession = await withTimeout(refreshAuthSession(), 10000);
        let refreshedToken = refreshedSession?.access_token ?? null;

        // Fallback: read stored token if refresh didn't return a new one
        if (!refreshedToken) {
          refreshedToken = await getStoredAccessToken();
        }

        // Last resort: try direct Supabase session
        if (!refreshedToken) {
          try {
            const { data } = await supabase.auth.getSession();
            refreshedToken = data.session?.access_token ?? null;
          } catch {
            // ignore
          }
        }

        if (refreshedToken) {
          setAuthorizationHeader(originalRequest, refreshedToken);
          return backendApi.request(originalRequest);
        }
      } catch (refreshError) {
        console.error('❌ Error refreshing session after 401:', refreshError);
      }
    }

    if (__DEV__) {
      console.error('❌ Request failed:', error.config?.url, '- Status:', error.response?.status);
      console.error('❌ Error:', error.response?.data || error.message);
    }
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
  create: async (data: WorkplacePayloadInput) => {
    const response = await backendApi.post('/workplaces', normalizeWorkplacePayload(data, {
      requireCoordinates: true,
      includeDefaultWorkdays: true,
    }));
    return response.data;
  },

  /**
   * Update an existing workplace
   */
  update: async (id: string, data: WorkplacePayloadInput) => {
    const response = await backendApi.put(`/workplaces/${id}`, normalizeWorkplacePayload(data, {
      requireCoordinates: false,
      includeDefaultWorkdays: false,
    }));
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
