import { Platform } from 'react-native';
import { DayTimesheet, LocationData, TodayStatus, User, Workplace } from '../types';

type PunchType = 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
type PunchMethod = 'MANUAL' | 'GEOFENCE' | 'BLUETOOTH';

type DemoState = {
  currentUser: User;
  currentLocation: LocationData;
  workplaces: Workplace[];
  users: User[];
  history: DayTimesheet[];
  todayStatus: TodayStatus;
};

type CreateWorkplaceInput = {
  name: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  radiusMeters?: number | string | null;
  workdays?: Partial<Workplace['workdays']> | null;
  schedule?: Partial<NonNullable<Workplace['schedule']>> | null;
};

type UpdateWorkplaceInput = {
  name?: string;
  radiusMeters?: number | string | null;
  workdays?: Partial<Workplace['workdays']> | null;
  schedule?: Partial<NonNullable<Workplace['schedule']>> | null;
};

type DemoPunchPayload = {
  punchType: PunchType;
  latitude: number;
  longitude: number;
  accuracy: number;
  note?: string;
  method?: PunchMethod;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const currentDateKey = () => new Date().toISOString().split('T')[0];

const atTime = (dateKey: string, time: string) => `${dateKey}T${time}:00.000Z`;

const WORKDAYS = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
} as const;

const buildInitialState = (): DemoState => {
  const today = currentDateKey();
  const todayPunchIn = atTime(today, '08:57');

  const workplaces: Workplace[] = [
    {
      id: 'wp-hq',
      name: 'Sede Lisboa',
      latitude: 38.7223,
      longitude: -9.1393,
      radiusMeters: 150,
      workdays: { ...WORKDAYS },
      schedule: {
        startTime: '09:00',
        endTime: '18:00',
        marginMinutes: 15,
      },
      locationLocked: true,
      configuredAt: '2026-03-10T09:00:00.000Z',
      isActive: true,
      createdAt: '2026-03-10T09:00:00.000Z',
      contextType: 'personal',
    },
    {
      id: 'wp-porto',
      name: 'Hub Porto',
      latitude: 41.1496,
      longitude: -8.6109,
      radiusMeters: 120,
      workdays: { ...WORKDAYS },
      schedule: {
        startTime: '08:30',
        endTime: '17:30',
        marginMinutes: 20,
      },
      locationLocked: true,
      configuredAt: '2026-03-11T09:00:00.000Z',
      isActive: false,
      createdAt: '2026-03-11T09:00:00.000Z',
      contextType: 'personal',
    },
    {
      id: 'wp-coimbra',
      name: 'Cliente Coimbra',
      latitude: 40.2033,
      longitude: -8.4103,
      radiusMeters: 100,
      workdays: { ...WORKDAYS, friday: false },
      schedule: {
        startTime: '10:00',
        endTime: '19:00',
        marginMinutes: 10,
      },
      locationLocked: true,
      configuredAt: '2026-03-14T09:00:00.000Z',
      isActive: false,
      createdAt: '2026-03-14T09:00:00.000Z',
      contextType: 'personal',
    },
  ];

  const currentUser: User = {
    id: 'user-demo-01',
    email: 'demo@geopunch.app',
    name: 'Mariana Costa',
    employeeId: 'GP-001',
    role: 'employee',
    accountType: 'personal',
    activeWorkplaceId: 'wp-hq',
    createdAt: '2025-11-05T10:30:00.000Z',
  };

  const users: User[] = [
    currentUser,
    {
      id: 'user-demo-02',
      email: 'ricardo.silva@geopunch.app',
      name: 'Ricardo Silva',
      employeeId: 'GP-014',
      role: 'employee',
      accountType: 'personal',
      activeWorkplaceId: 'wp-porto',
      createdAt: '2026-01-10T09:15:00.000Z',
    },
    {
      id: 'user-demo-03',
      email: 'ines.rocha@geopunch.app',
      name: 'Ines Rocha',
      employeeId: 'GP-021',
      role: 'employee',
      accountType: 'personal',
      activeWorkplaceId: 'wp-hq',
      createdAt: '2026-01-22T08:40:00.000Z',
    },
    {
      id: 'user-demo-04',
      email: 'pedro.lopes@geopunch.app',
      name: 'Pedro Lopes',
      employeeId: 'GP-035',
      role: 'employee',
      accountType: 'personal',
      activeWorkplaceId: undefined,
      createdAt: '2026-02-03T11:10:00.000Z',
    },
  ];

  const history: DayTimesheet[] = [
    {
      date: '2026-04-02',
      workplaceName: 'Sede Lisboa',
      workplaceId: 'wp-hq',
      isScheduledWorkday: true,
      punches: [
        {
          id: 'p-0402-in',
          type: 'IN',
          occurredAt: '2026-04-02T08:59:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 18,
          accuracy: 9,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
        {
          id: 'p-0402-break-start',
          type: 'BREAK_START',
          occurredAt: '2026-04-02T12:33:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 20,
          accuracy: 8,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
        {
          id: 'p-0402-break-end',
          type: 'BREAK_END',
          occurredAt: '2026-04-02T13:16:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 24,
          accuracy: 7,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
        {
          id: 'p-0402-out',
          type: 'OUT',
          occurredAt: '2026-04-02T18:08:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 22,
          accuracy: 8,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
      ],
      grossMinutes: 549,
      breakMinutes: 43,
      netWorkedMinutes: 506,
      netWorkedFormatted: '8h 26m',
      status: 'finished',
      anomalies: [],
    },
    {
      date: '2026-04-01',
      workplaceName: 'Sede Lisboa',
      workplaceId: 'wp-hq',
      isScheduledWorkday: true,
      punches: [
        {
          id: 'p-0401-in',
          type: 'IN',
          occurredAt: '2026-04-01T09:04:00.000Z',
          method: 'GEOFENCE',
          outsideWorkplace: false,
          distance: 10,
          accuracy: 5,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
        {
          id: 'p-0401-break-start',
          type: 'BREAK_START',
          occurredAt: '2026-04-01T12:41:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 15,
          accuracy: 6,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
        {
          id: 'p-0401-break-end',
          type: 'BREAK_END',
          occurredAt: '2026-04-01T13:25:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 17,
          accuracy: 6,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
        {
          id: 'p-0401-out',
          type: 'OUT',
          occurredAt: '2026-04-01T18:03:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 12,
          accuracy: 7,
          mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
        },
      ],
      grossMinutes: 539,
      breakMinutes: 44,
      netWorkedMinutes: 495,
      netWorkedFormatted: '8h 15m',
      status: 'finished',
      anomalies: [],
    },
    {
      date: '2026-03-31',
      workplaceName: 'Hub Porto',
      workplaceId: 'wp-porto',
      isScheduledWorkday: true,
      punches: [
        {
          id: 'p-0331-in',
          type: 'IN',
          occurredAt: '2026-03-31T08:31:00.000Z',
          method: 'GEOFENCE',
          outsideWorkplace: false,
          distance: 8,
          accuracy: 5,
          mapsLink: 'https://maps.google.com/?q=41.1496,-8.6109',
        },
        {
          id: 'p-0331-out',
          type: 'OUT',
          occurredAt: '2026-03-31T17:28:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 14,
          accuracy: 8,
          mapsLink: 'https://maps.google.com/?q=41.1496,-8.6109',
        },
      ],
      grossMinutes: 537,
      breakMinutes: 0,
      netWorkedMinutes: 537,
      netWorkedFormatted: '8h 57m',
      status: 'finished',
      anomalies: [],
    },
    {
      date: '2026-03-28',
      workplaceName: 'Cliente Coimbra',
      workplaceId: 'wp-coimbra',
      isScheduledWorkday: true,
      punches: [
        {
          id: 'p-0328-in',
          type: 'IN',
          occurredAt: '2026-03-28T10:02:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 25,
          accuracy: 10,
          mapsLink: 'https://maps.google.com/?q=40.2033,-8.4103',
        },
        {
          id: 'p-0328-break-start',
          type: 'BREAK_START',
          occurredAt: '2026-03-28T13:07:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 30,
          accuracy: 12,
          mapsLink: 'https://maps.google.com/?q=40.2033,-8.4103',
        },
        {
          id: 'p-0328-break-end',
          type: 'BREAK_END',
          occurredAt: '2026-03-28T13:52:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 28,
          accuracy: 11,
          mapsLink: 'https://maps.google.com/?q=40.2033,-8.4103',
        },
        {
          id: 'p-0328-out',
          type: 'OUT',
          occurredAt: '2026-03-28T19:04:00.000Z',
          method: 'MANUAL',
          outsideWorkplace: false,
          distance: 31,
          accuracy: 9,
          mapsLink: 'https://maps.google.com/?q=40.2033,-8.4103',
        },
      ],
      grossMinutes: 542,
      breakMinutes: 45,
      netWorkedMinutes: 497,
      netWorkedFormatted: '8h 17m',
      status: 'finished',
      anomalies: ['Ligacao fraca durante o registo de saida'],
    },
  ];

  const todayStatus: TodayStatus = {
    date: today,
    isScheduledWorkday: true,
    workplace: {
      id: 'wp-hq',
      name: 'Sede Lisboa',
      latitude: 38.7223,
      longitude: -9.1393,
      radiusMeters: 150,
      workdays: { ...WORKDAYS },
      schedule: {
        startTime: '09:00',
        endTime: '18:00',
        marginMinutes: 15,
      },
      mapsLink: 'https://maps.google.com/?q=38.7223,-9.1393',
    },
    punchIn: {
      occurredAt: todayPunchIn,
      method: 'MANUAL',
      outsideWorkplace: false,
    },
    punchOut: null,
    breaks: [],
    grossMinutes: 217,
    breakMinutes: 0,
    netWorkedMinutes: 217,
    netWorkedFormatted: '3h 37m',
    status: 'working',
  };

  return {
    currentUser,
    currentLocation: {
      latitude: 38.7226,
      longitude: -9.139,
      accuracy: 8,
    },
    workplaces,
    users,
    history,
    todayStatus,
  };
};

let state = buildInitialState();

const getActiveWorkplace = (): Workplace | null =>
  state.workplaces.find((workplace) => workplace.isActive) ?? null;

const getTodayTimesheet = (): DayTimesheet => {
  const workplace = getActiveWorkplace();
  const punches = [];

  if (state.todayStatus.punchIn) {
    punches.push({
      id: `today-in-${state.todayStatus.date}`,
      type: 'IN',
      occurredAt: state.todayStatus.punchIn.occurredAt,
      method: state.todayStatus.punchIn.method,
      outsideWorkplace: state.todayStatus.punchIn.outsideWorkplace,
      distance: 21,
      accuracy: state.currentLocation.accuracy,
      mapsLink: state.todayStatus.workplace?.mapsLink ?? 'https://maps.google.com',
    });
  }

  state.todayStatus.breaks.forEach((breakEntry, index) => {
    punches.push({
      id: `today-break-start-${index}`,
      type: 'BREAK_START',
      occurredAt: breakEntry.startedAt,
      method: 'MANUAL',
      outsideWorkplace: false,
      distance: 18,
      accuracy: state.currentLocation.accuracy,
      mapsLink: state.todayStatus.workplace?.mapsLink ?? 'https://maps.google.com',
    });

    if (breakEntry.endedAt) {
      punches.push({
        id: `today-break-end-${index}`,
        type: 'BREAK_END',
        occurredAt: breakEntry.endedAt,
        method: 'MANUAL',
        outsideWorkplace: false,
        distance: 18,
        accuracy: state.currentLocation.accuracy,
        mapsLink: state.todayStatus.workplace?.mapsLink ?? 'https://maps.google.com',
      });
    }
  });

  if (state.todayStatus.punchOut) {
    punches.push({
      id: `today-out-${state.todayStatus.date}`,
      type: 'OUT',
      occurredAt: state.todayStatus.punchOut.occurredAt,
      method: state.todayStatus.punchOut.method,
      outsideWorkplace: state.todayStatus.punchOut.outsideWorkplace,
      distance: 24,
      accuracy: state.currentLocation.accuracy,
      mapsLink: state.todayStatus.workplace?.mapsLink ?? 'https://maps.google.com',
    });
  }

  return {
    date: state.todayStatus.date,
    workplaceName: workplace?.name ?? 'Sem local atribuido',
    workplaceId: workplace?.id ?? 'no-workplace',
    isScheduledWorkday: state.todayStatus.isScheduledWorkday,
    punches,
    grossMinutes: state.todayStatus.grossMinutes,
    breakMinutes: state.todayStatus.breakMinutes,
    netWorkedMinutes: state.todayStatus.netWorkedMinutes,
    netWorkedFormatted: state.todayStatus.netWorkedFormatted,
    status: state.todayStatus.status,
    anomalies: [],
  };
};

const formatMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

const normalizeWorkdays = (workdays?: Partial<Workplace['workdays']> | null): Workplace['workdays'] => ({
  ...WORKDAYS,
  ...(workdays ?? {}),
});

const normalizeSchedule = (
  schedule?: Partial<NonNullable<Workplace['schedule']>> | null,
): Workplace['schedule'] => {
  if (!schedule) {
    return undefined;
  }

  return {
    startTime: schedule.startTime ?? '09:00',
    endTime: schedule.endTime ?? '18:00',
    marginMinutes: schedule.marginMinutes ?? 15,
  };
};

const syncCurrentUser = () => {
  state.currentUser.activeWorkplaceId = getActiveWorkplace()?.id;
  state.users = state.users.map((user) =>
    user.id === state.currentUser.id ? { ...user, activeWorkplaceId: state.currentUser.activeWorkplaceId } : user,
  );
};

const updateTodayMetrics = (referenceDate = new Date()) => {
  const punchIn = state.todayStatus.punchIn
    ? new Date(state.todayStatus.punchIn.occurredAt).getTime()
    : null;
  const punchOut = state.todayStatus.punchOut
    ? new Date(state.todayStatus.punchOut.occurredAt).getTime()
    : referenceDate.getTime();

  const breakMinutes = state.todayStatus.breaks.reduce((total, breakEntry) => {
    if (!breakEntry.endedAt) {
      return total;
    }

    const startedAt = new Date(breakEntry.startedAt).getTime();
    const endedAt = new Date(breakEntry.endedAt).getTime();
    return total + Math.max(0, Math.round((endedAt - startedAt) / 60000));
  }, 0);

  const grossMinutes =
    punchIn === null ? 0 : Math.max(0, Math.round((punchOut - punchIn) / 60000));
  const netWorkedMinutes = Math.max(0, grossMinutes - breakMinutes);

  state.todayStatus.grossMinutes = grossMinutes;
  state.todayStatus.breakMinutes = breakMinutes;
  state.todayStatus.netWorkedMinutes = netWorkedMinutes;
  state.todayStatus.netWorkedFormatted = formatMinutes(netWorkedMinutes);
};

const updateTodayStatusForPunch = (payload: DemoPunchPayload) => {
  const occurredAt = new Date().toISOString();
  const method = payload.method ?? 'MANUAL';
  const activeWorkplace = getActiveWorkplace();
  const mapsLink = activeWorkplace
    ? `https://maps.google.com/?q=${activeWorkplace.latitude},${activeWorkplace.longitude}`
    : 'https://maps.google.com';

  state.currentLocation = {
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracy: payload.accuracy,
  };

  switch (payload.punchType) {
    case 'IN':
      state.todayStatus.punchIn = {
        occurredAt,
        method,
        outsideWorkplace: false,
      };
      state.todayStatus.punchOut = null;
      state.todayStatus.breaks = [];
      state.todayStatus.status = 'working';
      break;
    case 'OUT':
      state.todayStatus.punchOut = {
        occurredAt,
        method,
        outsideWorkplace: false,
      };
      state.todayStatus.status = 'finished';
      break;
    case 'BREAK_START':
      state.todayStatus.breaks.push({
        startedAt: occurredAt,
        endedAt: null,
        durationMinutes: 0,
      });
      state.todayStatus.status = 'on_break';
      break;
    case 'BREAK_END': {
      const openBreak = [...state.todayStatus.breaks].reverse().find((breakEntry) => breakEntry.endedAt === null);
      if (openBreak) {
        openBreak.endedAt = occurredAt;
        openBreak.durationMinutes = Math.max(
          0,
          Math.round((new Date(occurredAt).getTime() - new Date(openBreak.startedAt).getTime()) / 60000),
        );
      }
      state.todayStatus.status = 'working';
      break;
    }
  }

  updateTodayMetrics(new Date(occurredAt));
  state.todayStatus.workplace = activeWorkplace
    ? {
        id: activeWorkplace.id,
        name: activeWorkplace.name,
        latitude: activeWorkplace.latitude,
        longitude: activeWorkplace.longitude,
        radiusMeters: activeWorkplace.radiusMeters,
        workdays: activeWorkplace.workdays,
        schedule: activeWorkplace.schedule,
        mapsLink,
      }
    : null;
};

const buildCsv = (entries: DayTimesheet[]): string => {
  const header = 'date,workplace,status,netWorked\n';
  const lines = entries.map((entry) =>
    [entry.date, entry.workplaceName, entry.status, entry.netWorkedFormatted].join(','),
  );

  return `${header}${lines.join('\n')}`;
};

const toBlob = (content: string, type: string) => {
  if (typeof Blob !== 'undefined') {
    return new Blob([content], { type });
  }

  return content;
};

export const screenshotSeedService = {
  isEnabled: true,
  reset() {
    state = buildInitialState();
  },
  getCurrentUser(): User {
    syncCurrentUser();
    return clone(state.currentUser);
  },
  async login(email: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) {
      state.currentUser.email = normalizedEmail;
    }
    syncCurrentUser();
    return clone(state.currentUser);
  },
  async register(email: string, name: string, employeeId?: string): Promise<User> {
    state.currentUser = {
      ...state.currentUser,
      email,
      name,
      employeeId,
    };
    syncCurrentUser();
    return clone(state.currentUser);
  },
  async logout(): Promise<void> {
    state = buildInitialState();
  },
  async getTodayStatus(): Promise<TodayStatus> {
    updateTodayMetrics();
    return clone(state.todayStatus);
  },
  async getTimesheet(): Promise<DayTimesheet[]> {
    const entries = [getTodayTimesheet(), ...state.history];
    return clone(entries);
  },
  async listWorkplaces(): Promise<Workplace[]> {
    return clone(state.workplaces);
  },
  async getActiveWorkplace(): Promise<Workplace | null> {
    return clone(getActiveWorkplace());
  },
  async createWorkplace(data: CreateWorkplaceInput): Promise<Workplace> {
    const workplace: Workplace = {
      id: `wp-${Date.now()}`,
      name: data.name.trim(),
      latitude: Number(data.latitude ?? state.currentLocation.latitude),
      longitude: Number(data.longitude ?? state.currentLocation.longitude),
      radiusMeters: Number(data.radiusMeters ?? 150),
      workdays: normalizeWorkdays(data.workdays),
      schedule: normalizeSchedule(data.schedule),
      locationLocked: true,
      configuredAt: new Date().toISOString(),
      isActive: false,
      createdAt: new Date().toISOString(),
      contextType: 'personal',
    };

    state.workplaces.unshift(workplace);
    return clone(workplace);
  },
  async updateWorkplace(id: string, data: UpdateWorkplaceInput): Promise<Workplace> {
    state.workplaces = state.workplaces.map((workplace) =>
      workplace.id === id
        ? {
            ...workplace,
            ...(data.name ? { name: data.name.trim() } : {}),
            ...(data.radiusMeters !== undefined && data.radiusMeters !== null
              ? { radiusMeters: Number(data.radiusMeters) }
              : {}),
            ...(data.workdays ? { workdays: normalizeWorkdays(data.workdays) } : {}),
            ...(data.schedule !== undefined ? { schedule: normalizeSchedule(data.schedule) } : {}),
          }
        : workplace,
    );

    const updated = state.workplaces.find((workplace) => workplace.id === id);
    if (!updated) {
      throw new Error('Local de trabalho nao encontrado');
    }

    return clone(updated);
  },
  async setActiveWorkplace(id: string): Promise<{ success: boolean }> {
    state.workplaces = state.workplaces.map((workplace) => ({
      ...workplace,
      isActive: workplace.id === id,
    }));
    syncCurrentUser();
    return { success: true };
  },
  async createPunch(payload: DemoPunchPayload): Promise<{ success: boolean }> {
    updateTodayStatusForPunch(payload);
    return { success: true };
  },
  async exportCsv() {
    return toBlob(buildCsv(await this.getTimesheet()), 'text/csv');
  },
  async exportXlsx() {
    const content = buildCsv(await this.getTimesheet());
    return toBlob(content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  },
  async listUsers(): Promise<User[]> {
    syncCurrentUser();
    return clone(state.users);
  },
  async listAdminWorkplaces(): Promise<Workplace[]> {
    return clone(state.workplaces);
  },
  async deleteWorkplace(id: string): Promise<{ success: boolean }> {
    state.workplaces = state.workplaces.filter((workplace) => workplace.id !== id);
    if (!state.workplaces.some((workplace) => workplace.isActive) && state.workplaces.length > 0) {
      state.workplaces[0].isActive = true;
    }
    syncCurrentUser();
    return { success: true };
  },
  async assignWorkplace(userId: string, workplaceId: string): Promise<{ success: boolean }> {
    state.users = state.users.map((user) =>
      user.id === userId ? { ...user, activeWorkplaceId: workplaceId } : user,
    );
    if (state.currentUser.id === userId) {
      state.currentUser.activeWorkplaceId = workplaceId;
    }
    return { success: true };
  },
  getCurrentLocation(): LocationData {
    return clone(state.currentLocation);
  },
  getMapsLink(): string {
    const activeWorkplace = getActiveWorkplace();
    if (!activeWorkplace) {
      return 'https://maps.google.com';
    }

    return `https://maps.google.com/?q=${activeWorkplace.latitude},${activeWorkplace.longitude}`;
  },
  getPlatformLabel(): string {
    return Platform.OS;
  },
};
