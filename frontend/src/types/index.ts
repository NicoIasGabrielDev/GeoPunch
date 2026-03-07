export interface User {
  id: string;
  email: string;
  name: string;
  employeeId?: string;
  role: string;
  activeWorkplaceId?: string;
  createdAt: string;
}

export interface WorkdaysConfig {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

export interface ScheduleConfig {
  startTime: string;
  endTime: string;
  marginMinutes: number;
}

export interface Workplace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  workdays: WorkdaysConfig;
  schedule?: ScheduleConfig;
  locationLocked: boolean;
  configuredAt: string;
  isActive: boolean;
  createdAt: string;
}

export interface TodayStatus {
  date: string;
  isScheduledWorkday: boolean;
  workplace: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    workdays: WorkdaysConfig;
    schedule?: ScheduleConfig;
    mapsLink: string;
  } | null;
  punchIn: {
    occurredAt: string;
    method: string;
    outsideWorkplace: boolean;
  } | null;
  punchOut: {
    occurredAt: string;
    method: string;
    outsideWorkplace: boolean;
  } | null;
  breaks: {
    startedAt: string;
    endedAt: string | null;
    durationMinutes: number;
  }[];
  grossMinutes: number;
  breakMinutes: number;
  netWorkedMinutes: number;
  netWorkedFormatted: string;
  status: 'not_started' | 'working' | 'on_break' | 'finished';
}

export interface Punch {
  id: string;
  type: string;
  occurredAt: string;
  method: string;
  outsideWorkplace: boolean;
  distance: number;
  accuracy: number;
  note?: string;
  mapsLink: string;
}

export interface DayTimesheet {
  date: string;
  workplaceName: string;
  workplaceId: string;
  isScheduledWorkday: boolean;
  punches: Punch[];
  grossMinutes: number;
  breakMinutes: number;
  netWorkedMinutes: number;
  netWorkedFormatted: string;
  status: string;
  anomalies: string[];
}

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface GeofenceEvent {
  eventId: string;
  eventType: 'ENTER' | 'EXIT';
  latitude: number;
  longitude: number;
  accuracy: number;
  deviceTime?: string;
}

export interface GeofenceSuggestion {
  action: 'START_SHIFT' | 'END_SHIFT';
  message: string;
  options?: string[];
}
