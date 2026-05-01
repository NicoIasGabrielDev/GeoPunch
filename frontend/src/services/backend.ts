import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig, isAxiosError } from 'axios';
import { getAccessToken, getStoredAccessToken, refreshAuthSession, supabase } from '../config/supabase';
import { isScreenshotSeedEnabled } from '../config/appMode';
import { screenshotSeedService } from '../demo/screenshotSeed';
import {
  ScheduleConfig,
  WorkdaysConfig,
  Enterprise,
  EnterpriseMembership,
  EmployeeWorkplaceAssignment,
} from '../types';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BACKEND_URL && !isScreenshotSeedEnabled) {
  throw new Error('Missing EXPO_PUBLIC_BACKEND_URL. Configure it before creating a production build.');
}

const baseUrl = (BACKEND_URL ?? 'https://demo.local').replace(/\/$/, '');

if (!__DEV__ && !isScreenshotSeedEnabled) {
  try {
    const parsedBackendUrl = new URL(baseUrl);
    if (parsedBackendUrl.protocol !== 'https:') {
      throw new Error('Production backend URL must use HTTPS.');
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Invalid production backend URL.');
  }
}

const BACKEND_TIMEOUT_MS = 90000;
const BACKEND_WAKE_TIMEOUT_MS = 75000;
const BACKEND_READY_TTL_MS = 8 * 60 * 1000;
const RETRIABLE_METHODS = new Set(['get', 'head', 'options']);
const RETRIABLE_STATUS_CODES = new Set([502, 503, 504]);
const NETWORK_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK', 'ETIMEDOUT']);

const isRenderBackend = (() => {
  try {
    return new URL(baseUrl).hostname.endsWith('.onrender.com');
  } catch {
    return false;
  }
})();

const backendApi: AxiosInstance = axios.create({
  baseURL: `${baseUrl}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: BACKEND_TIMEOUT_MS,
});

const backendHealthApi = axios.create({
  baseURL: baseUrl,
  timeout: BACKEND_WAKE_TIMEOUT_MS,
  headers: { 'Cache-Control': 'no-cache' },
});

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let backendWakePromise: Promise<void> | null = null;
let backendReadyAt = 0;

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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
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

  if (!startTime || !endTime || marginMinutes === undefined) return undefined;
  return { startTime, endTime, marginMinutes };
};

const normalizeWorkdays = (
  workdays: Partial<WorkdaysConfig> | null | undefined,
  includeDefaults: boolean,
): WorkdaysConfig | undefined => {
  if (!workdays && !includeDefaults) return undefined;
  return { ...DEFAULT_WORKDAYS, ...(workdays ?? {}) };
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
  if (!config.headers) return;
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

const hasFreshBackendWake = () =>
  backendReadyAt > 0 && Date.now() - backendReadyAt < BACKEND_READY_TTL_MS;

const isRetriableRequest = (config?: InternalAxiosRequestConfig) =>
  RETRIABLE_METHODS.has((config?.method ?? 'get').toLowerCase());

const isWakeupCandidateError = (error: AxiosError) => {
  if (error.response?.status && RETRIABLE_STATUS_CODES.has(error.response.status)) return true;
  if (!error.response && error.code && NETWORK_ERROR_CODES.has(error.code)) return true;

  const message = error.message?.toLowerCase() ?? '';
  return (
    message.includes('timeout') ||
    message.includes('network error') ||
    message.includes('network failed') ||
    message.includes('network request failed') ||
    message.includes('failed to fetch')
  );
};

export const ensureBackendReady = async (force = false): Promise<void> => {
  if (isScreenshotSeedEnabled || !isRenderBackend) return;
  if (!force && hasFreshBackendWake()) return;

  if (!backendWakePromise) {
    backendWakePromise = (async () => {
      try {
        const response = await backendHealthApi.get('/api/health');
        if (response.status >= 200 && response.status < 500) {
          backendReadyAt = Date.now();
          return;
        }
      } catch (error) {
        if (isAxiosError(error) && error.response) {
          backendReadyAt = Date.now();
          return;
        }
        throw error;
      } finally {
        backendWakePromise = null;
      }
    })();
  }

  await backendWakePromise;
};

export const primeBackendConnection = (): void => {
  if (isScreenshotSeedEnabled || !isRenderBackend || hasFreshBackendWake()) return;
  void ensureBackendReady().catch((error) => {
    if (__DEV__) console.warn('⚠️ Backend wake-up failed:', error);
  });
};

backendApi.interceptors.request.use(
  async (config) => {
    try {
      let token = await withTimeout(getAccessToken(), 10000);
      if (!token) {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token ?? null;
      }
      setAuthorizationHeader(config, token);
    } catch (error) {
      console.error('❌ Error getting access token:', error);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

backendApi.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshedSession = await withTimeout(refreshAuthSession(), 10000);
        let refreshedToken = refreshedSession?.access_token ?? null;

        if (!refreshedToken) refreshedToken = await getStoredAccessToken();
        if (!refreshedToken) {
          const { data } = await supabase.auth.getSession();
          refreshedToken = data.session?.access_token ?? null;
        }

        if (refreshedToken) {
          setAuthorizationHeader(originalRequest, refreshedToken);
          return backendApi.request(originalRequest);
        }
      } catch (refreshError) {
        console.error('❌ Error refreshing session after 401:', refreshError);
      }
    }

    if (
      isRenderBackend &&
      originalRequest &&
      !originalRequest._retry &&
      isRetriableRequest(originalRequest) &&
      isWakeupCandidateError(error)
    ) {
      originalRequest._retry = true;
      try {
        await ensureBackendReady(true);
        return backendApi.request(originalRequest);
      } catch (wakeError) {
        if (__DEV__) console.error('❌ Backend wake-up retry failed:', wakeError);
      }
    }

    return Promise.reject(error);
  },
);

export const authService = {
  getMe: async () => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.getCurrentUser();
    const response = await backendApi.get('/auth/me');
    return response.data;
  },
};

export const workplaceService = {
  list: async () => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.listWorkplaces();
    const response = await backendApi.get('/workplaces');
    return response.data;
  },

  create: async (data: WorkplacePayloadInput) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.createWorkplace(data);
    const response = await backendApi.post('/workplaces', normalizeWorkplacePayload(data, {
      requireCoordinates: true,
      includeDefaultWorkdays: true,
    }));
    return response.data;
  },

  update: async (id: string, data: WorkplacePayloadInput) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.updateWorkplace(id, data);
    const response = await backendApi.put(`/workplaces/${id}`, normalizeWorkplacePayload(data, {
      requireCoordinates: false,
      includeDefaultWorkdays: false,
    }));
    return response.data;
  },

  setActive: async (id: string) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.setActiveWorkplace(id);
    const response = await backendApi.post(`/workplaces/${id}/activate`);
    return response.data;
  },

  getActive: async () => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.getActiveWorkplace();
    const response = await backendApi.get('/workplaces/active');
    return response.data;
  },
};

export const punchService = {
  create: async (data: {
    punchType: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
    latitude: number;
    longitude: number;
    accuracy: number;
    note?: string;
    method?: 'MANUAL' | 'GEOFENCE' | 'BLUETOOTH';
  }) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.createPunch(data);
    const response = await backendApi.post('/punch', {
      ...data,
      method: data.method === 'GEOFENCE' ? 'geofence_suggestion' : 'manual',
    });
    return response.data;
  },
};

export const timesheetService = {
  getTodayStatus: async () => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.getTodayStatus();
    const response = await backendApi.get('/timesheet/today');
    return response.data;
  },

  getTimesheet: async (fromDate?: string, toDate?: string) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.getTimesheet();
    const response = await backendApi.get('/timesheet', {
      params: { from_date: fromDate, to_date: toDate },
    });
    return response.data;
  },

  exportCsv: async (fromDate: string, toDate: string) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.exportCsv();
    const response = await backendApi.get('/export/timesheet.csv', {
      params: { from_date: fromDate, to_date: toDate },
      responseType: 'blob',
    });
    return response.data;
  },

  exportXlsx: async (fromDate: string, toDate: string) => {
    if (isScreenshotSeedEnabled) return screenshotSeedService.exportXlsx();
    const response = await backendApi.get('/export/timesheet.xlsx', {
      params: { from_date: fromDate, to_date: toDate },
      responseType: 'blob',
    });
    return response.data;
  },
};

export const enterpriseService = {
  bootstrap: async (data: { name: string; nif?: string }) => {
    const response = await backendApi.post<Enterprise>('/enterprise/bootstrap', data);
    return response.data;
  },

  getCurrent: async () => {
    const response = await backendApi.get<Enterprise | null>('/enterprise');
    return response.data;
  },

  listMemberships: async () => {
    const response = await backendApi.get<EnterpriseMembership[]>('/enterprise/memberships');
    return response.data;
  },

  listMyInvitations: async () => {
    const response = await backendApi.get<EnterpriseMembership[]>('/enterprise/invitations/mine');
    return response.data;
  },

  inviteByEmail: async (email: string) => {
    const response = await backendApi.post<EnterpriseMembership>('/enterprise/invitations', { email });
    return response.data;
  },

  acceptInvitation: async (membershipId: string) => {
    const response = await backendApi.post<EnterpriseMembership>(`/enterprise/memberships/${membershipId}/accept`);
    return response.data;
  },

  rejectInvitation: async (membershipId: string) => {
    const response = await backendApi.post<EnterpriseMembership>(`/enterprise/memberships/${membershipId}/reject`);
    return response.data;
  },

  removeMembership: async (membershipId: string) => {
    const response = await backendApi.delete(`/enterprise/memberships/${membershipId}`);
    return response.data;
  },

  assignWorkplace: async (employeeUserId: string, workplaceId: string) => {
    const response = await backendApi.post<EmployeeWorkplaceAssignment>('/enterprise/workplace-assignments', {
      employeeUserId,
      workplaceId,
    });
    return response.data;
  },

  removeWorkplaceAssignment: async (assignmentId: string) => {
    const response = await backendApi.delete(`/enterprise/workplace-assignments/${assignmentId}`);
    return response.data;
  },

  getEmployeeTimesheet: async (employeeUserId: string, fromDate?: string, toDate?: string) => {
    const response = await backendApi.get(`/enterprise/timesheets/${employeeUserId}`, {
      params: { from_date: fromDate, to_date: toDate },
    });
    return response.data;
  },
};

export default backendApi;
