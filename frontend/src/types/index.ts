export interface User {
  id: string;
  email: string;
  name: string;
  employeeId?: string;
  role: string;
  workplaceId?: string;
  createdAt: string;
}

export interface Workplace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  startTime: string;
  endTime: string;
  allowedMarginMinutes: number;
  createdAt: string;
}

export interface TodayStatus {
  date: string;
  workplace: Workplace | null;
  clockIn: string | null;
  clockInMethod: string | null;
  clockOut: string | null;
  clockOutMethod: string | null;
  lunchStart: string | null;
  lunchEnd: string | null;
  grossMinutes: number;
  breakMinutes: number;
  netWorkedMinutes: number;
  netWorkedFormatted: string;
  status: 'not_started' | 'working' | 'on_lunch' | 'finished';
}

export interface DayTimesheet {
  date: string;
  workplaceName: string;
  clockIn: string | null;
  clockInMethod: string | null;
  clockOut: string | null;
  clockOutMethod: string | null;
  lunchStart: string | null;
  lunchEnd: string | null;
  grossMinutes: number;
  breakMinutes: number;
  netWorkedMinutes: number;
  netWorkedFormatted: string;
  status: string;
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
  timestamp?: string;
}
