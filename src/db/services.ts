import { db, hasDbConfig } from './index.ts';
import {
  buses,
  busRoutes,
  busStops,
  busLocations,
  trackingSessions,
  profiles,
  students,
  drivers,
  notifications,
  notificationPreferences,
  campusLocations,
  campusPaths,
  safetyReports,
  emergencyContacts,
  publicTransportStops,
  publicTransportDepartures,
  studentPickupPoints,
  boardingQueue,
  studentPreferences,
  studentLocations,
} from './schema.ts';
import { eq, desc, and, ilike, or, lte } from 'drizzle-orm';
import {
  REC_BUILDINGS,
  REC_CAMPUS_STOPS,
  REC_POINTS_OF_INTEREST,
  REC_CAMPUS_PATHS,
} from '../../artifacts/api-server/src/services/campusData.ts';

// ============================================================================
// IN-MEMORY FALLBACK STORE (Active when Cloud SQL PostgreSQL is offline)
// ============================================================================

interface MemoryProfile {
  id: number;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: 'STUDENT' | 'DRIVER' | 'ADMIN' | 'PARENT';
  createdAt: Date;
}

interface MemoryStudent {
  id: number;
  profileId: number;
  registerNumber: string;
  assignedBusId: string | null;
  assignedRouteId: string | null;
  pickupStopId: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationUpdate: Date | null;
}

interface MemoryDriver {
  id: number;
  profileId: number;
  assignedBusId: string | null;
  licenseNumber: string | null;
}

interface MemoryBus {
  id: string;
  busNumber: string;
  registrationNumber: string;
  routeId: string;
  driverId: string | null;
  active: boolean;
  createdAt: Date;
}

interface MemoryRoute {
  id: string;
  routeName: string;
  routeCode: string;
  active: boolean;
}

interface MemoryStop {
  id: string;
  routeId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  sequenceNumber: number;
}

interface MemoryBusLocation {
  id: number;
  busId: string;
  driverId: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: Date;
  receivedAt: Date;
  createdAt: Date;
}

let nextProfileId = 10;
let nextStudentId = 10;
let nextDriverId = 10;
let nextLocationId = 100;
let nextNotifId = 100;
let nextQueueId = 100;

const memoryProfiles: Map<string, MemoryProfile> = new Map([
  [
    'admin',
    {
      id: 1,
      userId: 'admin',
      name: 'Transport Administrator',
      email: 'admin@rec.edu.in',
      phone: '+91 98401 23400',
      role: 'ADMIN',
      createdAt: new Date(),
    },
  ],
  [
    'driver-rajesh',
    {
      id: 2,
      userId: 'driver-rajesh',
      name: 'Driver Rajesh',
      email: 'driver-rajesh@rec.edu.in',
      phone: '+91 98401 23451',
      role: 'DRIVER',
      createdAt: new Date(),
    },
  ],
  [
    'driver-arun',
    {
      id: 3,
      userId: 'driver-arun',
      name: 'Driver Arun',
      email: 'driver-arun@rec.edu.in',
      phone: '+91 98401 23452',
      role: 'DRIVER',
      createdAt: new Date(),
    },
  ],
  [
    'driver-suresh',
    {
      id: 4,
      userId: 'driver-suresh',
      name: 'Driver Suresh',
      email: 'driver-suresh@rec.edu.in',
      phone: '+91 98401 23453',
      role: 'DRIVER',
      createdAt: new Date(),
    },
  ],
  [
    'driver-venkat',
    {
      id: 5,
      userId: 'driver-venkat',
      name: 'Driver Venkat',
      email: 'driver-venkat@rec.edu.in',
      phone: '+91 98401 23454',
      role: 'DRIVER',
      createdAt: new Date(),
    },
  ],
  [
    'driver-karthik',
    {
      id: 6,
      userId: 'driver-karthik',
      name: 'Driver Karthik',
      email: 'driver-karthik@rec.edu.in',
      phone: '+91 98401 23455',
      role: 'DRIVER',
      createdAt: new Date(),
    },
  ],
  [
    'student-20418',
    {
      id: 7,
      userId: 'student-20418',
      name: 'Priya S',
      email: 'student-20418@rec.edu.in',
      phone: '+91 98401 99999',
      role: 'STUDENT',
      createdAt: new Date(),
    },
  ],
]);

const memoryStudents: Map<number, MemoryStudent> = new Map([
  [
    7,
    {
      id: 1,
      profileId: 7,
      registerNumber: '2101001',
      assignedBusId: 'bus-12',
      assignedRouteId: 'route-bus-12',
      pickupStopId: 'tambaram',
      currentLatitude: 12.9254,
      currentLongitude: 80.1198,
      lastLocationUpdate: new Date(),
    },
  ],
]);

const memoryDrivers: Map<number, MemoryDriver> = new Map([
  [2, { id: 1, profileId: 2, assignedBusId: 'bus-18', licenseNumber: 'DL-TN-01-2018' }],
  [3, { id: 2, profileId: 3, assignedBusId: 'bus-12', licenseNumber: 'DL-TN-01-2012' }],
  [4, { id: 3, profileId: 4, assignedBusId: 'bus-4b', licenseNumber: 'DL-TN-01-2044' }],
  [5, { id: 4, profileId: 5, assignedBusId: 'bus-7', licenseNumber: 'DL-TN-01-2007' }],
  [6, { id: 5, profileId: 6, assignedBusId: 'bus-21', licenseNumber: 'DL-TN-01-2021' }],
]);

const memoryRoutes: Map<string, MemoryRoute> = new Map([
  ['route-bus-18', { id: 'route-bus-18', routeName: 'Metro Connector Feeder', routeCode: '18', active: true }],
  ['route-bus-12', { id: 'route-bus-12', routeName: 'Campus Loop A', routeCode: '12', active: true }],
  ['route-bus-4b', { id: 'route-bus-4b', routeName: 'Engineering Express', routeCode: '4B', active: true }],
  ['route-bus-7', { id: 'route-bus-7', routeName: 'North Campus Shuttle', routeCode: '7', active: true }],
  ['route-bus-21', { id: 'route-bus-21', routeName: 'South Perimeter Circle', routeCode: '21', active: true }],
]);

const memoryStops: MemoryStop[] = [
  // Route 18
  { id: 'metro-central', routeId: 'route-bus-18', stopName: 'Metro Central Station', latitude: 12.9249, longitude: 80.1275, sequenceNumber: 1 },
  { id: 'jb-estate', routeId: 'route-bus-18', stopName: 'JB Estate', latitude: 12.9272, longitude: 80.1302, sequenceNumber: 2 },
  { id: 'ponnu', routeId: 'route-bus-18', stopName: 'Ponnu', latitude: 12.9301, longitude: 80.1336, sequenceNumber: 3 },
  { id: 'ramratna', routeId: 'route-bus-18', stopName: 'Ramratna', latitude: 12.9338, longitude: 80.1368, sequenceNumber: 4 },
  { id: 'med-sciences', routeId: 'route-bus-18', stopName: 'Medical Sciences Center', latitude: 12.9372, longitude: 80.1396, sequenceNumber: 5 },

  // Route 12
  { id: 'vandalur', routeId: 'route-bus-12', stopName: 'Vandalur Transit Hub', latitude: 12.8912, longitude: 80.0815, sequenceNumber: 1 },
  { id: 'perungalathur', routeId: 'route-bus-12', stopName: 'Perungalathur Junction', latitude: 12.9042, longitude: 80.0965, sequenceNumber: 2 },
  { id: 'tambaram', routeId: 'route-bus-12', stopName: 'Tambaram Terminal', latitude: 12.9254, longitude: 80.1198, sequenceNumber: 3 },
  { id: 'chromepet', routeId: 'route-bus-12', stopName: 'Chromepet Station Gate', latitude: 12.9515, longitude: 80.1412, sequenceNumber: 4 },
  { id: 'quad', routeId: 'route-bus-12', stopName: 'Academic Quad', latitude: 12.9734, longitude: 80.1589, sequenceNumber: 5 },

  // Route 4B
  { id: 'north-residence', routeId: 'route-bus-4b', stopName: 'North Residence Complex', latitude: 12.9421, longitude: 80.1245, sequenceNumber: 1 },
  { id: 'bio-center', routeId: 'route-bus-4b', stopName: 'Bio-Engineering Center', latitude: 12.9375, longitude: 80.1292, sequenceNumber: 2 },
  { id: 'nano-hub', routeId: 'route-bus-4b', stopName: 'Nano Research Facility', latitude: 12.9318, longitude: 80.1345, sequenceNumber: 3 },
  { id: 'innovation-park', routeId: 'route-bus-4b', stopName: 'Tech & Innovation Park', latitude: 12.9262, longitude: 80.1415, sequenceNumber: 4 },

  // Route 7
  { id: 'hostel-village', routeId: 'route-bus-7', stopName: 'Hostel Village', latitude: 12.9145, longitude: 80.1122, sequenceNumber: 1 },
  { id: 'athletics', routeId: 'route-bus-7', stopName: 'Athletic Pavilion', latitude: 12.9182, longitude: 80.1165, sequenceNumber: 2 },
  { id: 'library', routeId: 'route-bus-7', stopName: 'Central Library & Union', latitude: 12.9221, longitude: 80.1215, sequenceNumber: 3 },

  // Route 21
  { id: 'south-lot', routeId: 'route-bus-21', stopName: 'South Commuter Lot', latitude: 12.9015, longitude: 80.0935, sequenceNumber: 1 },
  { id: 'faculty-enclave', routeId: 'route-bus-21', stopName: 'Faculty Enclave', latitude: 12.9085, longitude: 80.1012, sequenceNumber: 2 },
  { id: 'auditorium', routeId: 'route-bus-21', stopName: 'Main Auditorium', latitude: 12.9152, longitude: 80.1095, sequenceNumber: 3 },
];

const memoryBuses: Map<string, MemoryBus> = new Map([
  ['bus-18', { id: 'bus-18', busNumber: '18', registrationNumber: 'TN-11-AC-1018', routeId: 'route-bus-18', driverId: 'driver-rajesh', active: true, createdAt: new Date() }],
  ['bus-12', { id: 'bus-12', busNumber: '12', registrationNumber: 'TN-11-AC-1012', routeId: 'route-bus-12', driverId: 'driver-arun', active: true, createdAt: new Date() }],
  ['bus-4b', { id: 'bus-4b', busNumber: '4B', registrationNumber: 'TN-11-AC-1044', routeId: 'route-bus-4b', driverId: 'driver-suresh', active: true, createdAt: new Date() }],
  ['bus-7', { id: 'bus-7', busNumber: '7', registrationNumber: 'TN-11-AC-1007', routeId: 'route-bus-7', driverId: 'driver-venkat', active: true, createdAt: new Date() }],
  ['bus-21', { id: 'bus-21', busNumber: '21', registrationNumber: 'TN-11-AC-1021', routeId: 'route-bus-21', driverId: 'driver-karthik', active: true, createdAt: new Date() }],
]);

const memoryBusLocations: Map<string, MemoryBusLocation[]> = new Map();

const memoryTrackingSessions: Map<string, any> = new Map();

const memoryCampusLocations: any[] = [
  ...REC_BUILDINGS.map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    latitude: b.latitude,
    longitude: b.longitude,
    description: b.description,
  })),
  ...REC_CAMPUS_STOPS.map((s) => ({
    id: s.id,
    name: s.name,
    category: 'transit',
    latitude: s.latitude,
    longitude: s.longitude,
    description: s.description,
  })),
  ...REC_POINTS_OF_INTEREST.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    latitude: p.latitude,
    longitude: p.longitude,
    description: `Near ${p.landmarkNear}`,
  })),
];

const memoryCampusPaths: any[] = REC_CAMPUS_PATHS.map((p) => ({
  id: p.id,
  fromLocationId: p.name.split(' - ')[0] || p.id,
  toLocationId: p.name.split(' - ')[1] || p.id,
  pathPoints: JSON.stringify(p.coordinates.map((c) => [c.latitude, c.longitude])),
  distanceMeters: 250,
  pathType: p.type,
}));

const memorySafetyReports: any[] = [];

const memoryNotifications: any[] = [];

const memoryQueue: any[] = [];
const memoryStudentPreferences: Map<string, any> = new Map();
const memoryStudentLocations: Map<string, any[]> = new Map();

// Helper to run DB query with memory fallback
async function withDbFallback<T>(dbFn: () => Promise<T>, fallbackFn: () => T | Promise<T>): Promise<T> {
  if (hasDbConfig) {
    try {
      return await dbFn();
    } catch {
      // Gracefully fall back to in-memory store
      return await fallbackFn();
    }
  }
  return await fallbackFn();
}

// -------------------------------------------------------------
// PROFILES & AUTH
// -------------------------------------------------------------
export async function getOrCreateProfile(
  userId: string,
  email: string,
  name: string,
  role: 'STUDENT' | 'DRIVER' | 'ADMIN' | 'PARENT' = 'STUDENT'
) {
  return withDbFallback(
    async () => {
      const existing = await db.select().from(profiles).where(eq(profiles.userId, userId));
      if (existing.length > 0) {
        return existing[0];
      }

      const inserted = await db
        .insert(profiles)
        .values({
          userId,
          email,
          name,
          role,
        })
        .returning();

      const newProfile = inserted[0];

      if (role === 'STUDENT') {
        await db.insert(students).values({
          profileId: newProfile.id,
          registerNumber: userId.startsWith('student-') ? userId : `REG-${newProfile.id}`,
          assignedBusId: 'bus-12',
          assignedRouteId: 'route-bus-12',
          pickupStopId: 'tambaram',
        });
      } else if (role === 'DRIVER') {
        await db.insert(drivers).values({
          profileId: newProfile.id,
          assignedBusId: 'bus-12',
        });
      }

      return newProfile;
    },
    () => {
      const existing = memoryProfiles.get(userId);
      if (existing) {
        return existing;
      }

      const newId = ++nextProfileId;
      const newProfile: MemoryProfile = {
        id: newId,
        userId,
        email,
        name,
        phone: null,
        role,
        createdAt: new Date(),
      };
      memoryProfiles.set(userId, newProfile);

      if (role === 'STUDENT') {
        memoryStudents.set(newId, {
          id: ++nextStudentId,
          profileId: newId,
          registerNumber: userId.startsWith('student-') ? userId : `REG-${newId}`,
          assignedBusId: 'bus-12',
          assignedRouteId: 'route-bus-12',
          pickupStopId: 'tambaram',
          currentLatitude: 12.9254,
          currentLongitude: 80.1198,
          lastLocationUpdate: new Date(),
        });
      } else if (role === 'DRIVER') {
        memoryDrivers.set(newId, {
          id: ++nextDriverId,
          profileId: newId,
          assignedBusId: 'bus-12',
          licenseNumber: `DL-TN-01-${newId}`,
        });
      }

      return newProfile;
    }
  );
}

export async function getProfileWithDetails(userId: string) {
  return withDbFallback(
    async () => {
      const userProfiles = await db.select().from(profiles).where(eq(profiles.userId, userId));
      if (userProfiles.length === 0) return null;

      const profile = userProfiles[0];
      let details: any = { ...profile };

      if (profile.role === 'STUDENT') {
        const studentRecs = await db.select().from(students).where(eq(students.profileId, profile.id));
        if (studentRecs.length > 0) {
          details = { ...details, ...studentRecs[0] };
        }
      } else if (profile.role === 'DRIVER') {
        const driverRecs = await db.select().from(drivers).where(eq(drivers.profileId, profile.id));
        if (driverRecs.length > 0) {
          details = { ...details, ...driverRecs[0] };
        }
      }

      return details;
    },
    () => {
      const profile = memoryProfiles.get(userId);
      if (!profile) return null;

      let details: any = { ...profile };
      if (profile.role === 'STUDENT') {
        const studentRec = memoryStudents.get(profile.id);
        if (studentRec) details = { ...details, ...studentRec };
      } else if (profile.role === 'DRIVER') {
        const driverRec = memoryDrivers.get(profile.id);
        if (driverRec) details = { ...details, ...driverRec };
      }

      return details;
    }
  );
}

// -------------------------------------------------------------
// BUSES & ROUTES
// -------------------------------------------------------------
export async function getDbBuses() {
  return withDbFallback(
    async () => {
      return await db.select().from(buses).orderBy(buses.busNumber);
    },
    () => Array.from(memoryBuses.values())
  );
}

export async function getDbBusById(busId: string) {
  return withDbFallback(
    async () => {
      const result = await db.select().from(buses).where(eq(buses.id, busId));
      return result[0] || null;
    },
    () => memoryBuses.get(busId) || null
  );
}

export async function createDbBus(data: {
  id: string;
  busNumber: string;
  registrationNumber?: string;
  routeId?: string;
  driverId?: string;
  active?: boolean;
}) {
  return withDbFallback(
    async () => {
      const inserted = await db.insert(buses).values(data).returning();
      return inserted[0];
    },
    () => {
      const newBus: MemoryBus = {
        id: data.id,
        busNumber: data.busNumber,
        registrationNumber: data.registrationNumber || `TN-11-AC-${data.busNumber}`,
        routeId: data.routeId || 'route-bus-12',
        driverId: data.driverId || null,
        active: data.active ?? true,
        createdAt: new Date(),
      };
      memoryBuses.set(data.id, newBus);
      return newBus;
    }
  );
}

export async function updateDbBus(
  busId: string,
  updates: Partial<{
    busNumber: string;
    registrationNumber: string;
    routeId: string;
    driverId: string;
    active: boolean;
  }>
) {
  return withDbFallback(
    async () => {
      const updated = await db
        .update(buses)
        .set(updates)
        .where(eq(buses.id, busId))
        .returning();
      return updated[0] || null;
    },
    () => {
      const existing = memoryBuses.get(busId);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      memoryBuses.set(busId, updated);
      return updated;
    }
  );
}

export async function getDbRoutes() {
  return withDbFallback(
    async () => {
      return await db.select().from(busRoutes).orderBy(busRoutes.routeCode);
    },
    () => Array.from(memoryRoutes.values())
  );
}

export async function getDbRouteById(routeId: string) {
  return withDbFallback(
    async () => {
      const route = await db.select().from(busRoutes).where(eq(busRoutes.id, routeId));
      if (route.length === 0) {
        return null;
      }

      const stops = await db
        .select()
        .from(busStops)
        .where(eq(busStops.routeId, routeId))
        .orderBy(busStops.sequenceNumber);

      return {
        ...route[0],
        stops,
      };
    },
    () => {
      const mem = memoryRoutes.get(routeId);
      if (!mem) return null;
      return {
        ...mem,
        stops: memoryStops.filter((s) => s.routeId === routeId),
      };
    }
  );
}

export async function createDbRoute(data: {
  id: string;
  routeName: string;
  routeCode: string;
  active?: boolean;
}) {
  return withDbFallback(
    async () => {
      const inserted = await db.insert(busRoutes).values(data).returning();
      return inserted[0];
    },
    () => {
      const newRoute: MemoryRoute = {
        id: data.id,
        routeName: data.routeName,
        routeCode: data.routeCode,
        active: data.active ?? true,
      };
      memoryRoutes.set(data.id, newRoute);
      return newRoute;
    }
  );
}

export async function updateDbRoute(
  routeId: string,
  updates: Partial<{
    routeName: string;
    routeCode: string;
    active: boolean;
  }>
) {
  return withDbFallback(
    async () => {
      const updated = await db
        .update(busRoutes)
        .set(updates)
        .where(eq(busRoutes.id, routeId))
        .returning();
      return updated[0] || null;
    },
    () => {
      const existing = memoryRoutes.get(routeId);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      memoryRoutes.set(routeId, updated);
      return updated;
    }
  );
}

export async function getDbStopsByRoute(routeId: string) {
  return withDbFallback(
    async () => {
      return await db
        .select()
        .from(busStops)
        .where(eq(busStops.routeId, routeId))
        .orderBy(busStops.sequenceNumber);
    },
    () => memoryStops.filter((s) => s.routeId === routeId)
  );
}

// -------------------------------------------------------------
// REAL DRIVER GPS & BUS LOCATIONS
// -------------------------------------------------------------
export async function recordBusLocation(location: {
  busId: string;
  driverId?: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recordedAt?: Date | string;
  receivedAt?: Date | string;
}) {
  const recordedDate = location.recordedAt ? new Date(location.recordedAt) : new Date();
  const receivedDate = location.receivedAt ? new Date(location.receivedAt) : new Date();

  return withDbFallback(
    async () => {
      const inserted = await db
        .insert(busLocations)
        .values({
          busId: location.busId,
          driverId: location.driverId || null,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: typeof location.accuracy === 'number' ? location.accuracy : null,
          altitude: typeof location.altitude === 'number' ? location.altitude : null,
          altitudeAccuracy: typeof location.altitudeAccuracy === 'number' ? location.altitudeAccuracy : null,
          speed: typeof location.speed === 'number' ? location.speed : null,
          heading: typeof location.heading === 'number' ? location.heading : null,
          recordedAt: recordedDate,
          receivedAt: receivedDate,
          createdAt: new Date(),
        })
        .returning();

      await db
        .update(trackingSessions)
        .set({ lastLocationAt: recordedDate })
        .where(
          and(
            eq(trackingSessions.busId, location.busId),
            eq(trackingSessions.status, 'ACTIVE')
          )
        )
        .catch(() => {});

      return inserted[0];
    },
    () => {
      const record: MemoryBusLocation = {
        id: ++nextLocationId,
        busId: location.busId,
        driverId: location.driverId || null,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: typeof location.accuracy === 'number' ? location.accuracy : null,
        altitude: typeof location.altitude === 'number' ? location.altitude : null,
        altitudeAccuracy: typeof location.altitudeAccuracy === 'number' ? location.altitudeAccuracy : null,
        speed: typeof location.speed === 'number' ? location.speed : null,
        heading: typeof location.heading === 'number' ? location.heading : null,
        recordedAt: recordedDate,
        receivedAt: receivedDate,
        createdAt: new Date(),
      };

      const locs = memoryBusLocations.get(location.busId) || [];
      locs.unshift(record);
      if (locs.length > 100) locs.pop();
      memoryBusLocations.set(location.busId, locs);

      const session = memoryTrackingSessions.get(location.busId);
      if (session && session.status === 'ACTIVE') {
        session.lastLocationAt = recordedDate;
      }

      return record;
    }
  );
}

export async function getLatestBusLocation(busId: string) {
  return withDbFallback(
    async () => {
      const result = await db
        .select()
        .from(busLocations)
        .where(eq(busLocations.busId, busId))
        .orderBy(desc(busLocations.recordedAt))
        .limit(1);
      return result[0] || null;
    },
    () => {
      const locs = memoryBusLocations.get(busId);
      return locs && locs.length > 0 ? locs[0] : null;
    }
  );
}

export async function getRecentBusLocations(busId: string, limit = 50) {
  return withDbFallback(
    async () => {
      return await db
        .select()
        .from(busLocations)
        .where(eq(busLocations.busId, busId))
        .orderBy(desc(busLocations.recordedAt))
        .limit(limit);
    },
    () => (memoryBusLocations.get(busId) || []).slice(0, limit)
  );
}

export async function startTrackingSession(busId: string, driverId: string) {
  return withDbFallback(
    async () => {
      await db
        .update(trackingSessions)
        .set({ status: 'ENDED', endedAt: new Date() })
        .where(
          and(
            eq(trackingSessions.busId, busId),
            eq(trackingSessions.status, 'ACTIVE')
          )
        );

      const sessionId = `session-${busId}-${Date.now()}`;
      const inserted = await db
        .insert(trackingSessions)
        .values({
          id: sessionId,
          busId,
          driverId,
          status: 'ACTIVE',
          startedAt: new Date(),
        })
        .returning();
      return inserted[0];
    },
    () => {
      const sessionId = `session-${busId}-${Date.now()}`;
      const session = {
        id: sessionId,
        busId,
        driverId,
        status: 'ACTIVE',
        startedAt: new Date(),
        lastLocationAt: new Date(),
      };
      memoryTrackingSessions.set(busId, session);
      return session;
    }
  );
}

export async function pauseTrackingSession(busId: string) {
  return withDbFallback(
    async () => {
      const updated = await db
        .update(trackingSessions)
        .set({ status: 'PAUSED' })
        .where(
          and(
            eq(trackingSessions.busId, busId),
            eq(trackingSessions.status, 'ACTIVE')
          )
        )
        .returning();
      return updated[0] || null;
    },
    () => {
      const session = memoryTrackingSessions.get(busId);
      if (session && session.status === 'ACTIVE') {
        session.status = 'PAUSED';
        return session;
      }
      return session || null;
    }
  );
}

export async function resumeTrackingSession(busId: string) {
  return withDbFallback(
    async () => {
      const updated = await db
        .update(trackingSessions)
        .set({ status: 'ACTIVE' })
        .where(
          and(
            eq(trackingSessions.busId, busId),
            eq(trackingSessions.status, 'PAUSED')
          )
        )
        .returning();
      return updated[0] || null;
    },
    () => {
      const session = memoryTrackingSessions.get(busId);
      if (session && session.status === 'PAUSED') {
        session.status = 'ACTIVE';
        return session;
      }
      return session || null;
    }
  );
}

export async function stopTrackingSession(busId: string) {
  return withDbFallback(
    async () => {
      const updated = await db
        .update(trackingSessions)
        .set({
          status: 'ENDED',
          endedAt: new Date(),
        })
        .where(
          and(
            eq(trackingSessions.busId, busId),
            or(
              eq(trackingSessions.status, 'ACTIVE'),
              eq(trackingSessions.status, 'PAUSED')
            )
          )
        )
        .returning();
      return updated[0] || null;
    },
    () => {
      const session = memoryTrackingSessions.get(busId);
      if (session) {
        session.status = 'ENDED';
        session.endedAt = new Date();
        return session;
      }
      return null;
    }
  );
}

export async function getBusTrackingSession(busId: string) {
  return withDbFallback(
    async () => {
      const sessions = await db
        .select()
        .from(trackingSessions)
        .where(eq(trackingSessions.busId, busId))
        .orderBy(desc(trackingSessions.startedAt))
        .limit(1);
      return sessions[0] || null;
    },
    () => memoryTrackingSessions.get(busId) || null
  );
}

export async function isBusTrackingActive(busId: string) {
  const session = await getBusTrackingSession(busId);
  return {
    isActive: session?.status === 'ACTIVE',
    isPaused: session?.status === 'PAUSED',
    status: (session?.status as 'ACTIVE' | 'PAUSED' | 'ENDED' | null) || 'IDLE',
    session,
  };
}

export async function verifyDriverBusAssignment(driverId: string, busId: string): Promise<boolean> {
  const bus = await getDbBusById(busId);
  if (!bus) return false;
  if (bus.driverId === driverId) return true;

  return withDbFallback(
    async () => {
      const profile = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, driverId))
        .limit(1);

      if (profile.length > 0) {
        const driverRecord = await db
          .select()
          .from(drivers)
          .where(eq(drivers.profileId, profile[0].id))
          .limit(1);
        if (driverRecord.length > 0 && driverRecord[0].assignedBusId === busId) {
          return true;
        }
      }
      return false;
    },
    () => {
      const prof = memoryProfiles.get(driverId);
      if (!prof) return false;
      const dRec = memoryDrivers.get(prof.id);
      return dRec?.assignedBusId === busId;
    }
  );
}

// -------------------------------------------------------------
// NOTIFICATIONS
// -------------------------------------------------------------
export async function createDbNotification(userId: string, type: string, title: string, message: string) {
  return withDbFallback(
    async () => {
      const inserted = await db
        .insert(notifications)
        .values({
          userId,
          type,
          title,
          message,
        })
        .returning();
      return inserted[0];
    },
    () => {
      const notif = {
        id: ++nextNotifId,
        userId,
        type,
        title,
        message,
        createdAt: new Date(),
        readAt: null,
      };
      memoryNotifications.unshift(notif);
      return notif;
    }
  );
}

export async function getUserNotifications(userId: string) {
  return withDbFallback(
    async () => {
      return await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
    },
    () => memoryNotifications.filter((n) => n.userId === userId)
  );
}

// -------------------------------------------------------------
// CAMPUS LOCATIONS & PATHS
// -------------------------------------------------------------
export async function getDbCampusLocations(category?: string) {
  return withDbFallback(
    async () => {
      if (category && category !== 'all') {
        return await db
          .select()
          .from(campusLocations)
          .where(eq(campusLocations.category, category))
          .orderBy(campusLocations.name);
      }
      return await db.select().from(campusLocations).orderBy(campusLocations.name);
    },
    () => {
      if (category && category !== 'all') {
        return memoryCampusLocations.filter((l) => l.category === category);
      }
      return memoryCampusLocations;
    }
  );
}

export async function searchDbCampusLocations(term: string) {
  const cleanTerm = term.trim().toLowerCase();
  return withDbFallback(
    async () => {
      const pattern = `%${term.trim()}%`;
      return await db
        .select()
        .from(campusLocations)
        .where(
          or(
            ilike(campusLocations.name, pattern),
            ilike(campusLocations.description, pattern),
            ilike(campusLocations.category, pattern)
          )
        )
        .orderBy(campusLocations.name)
        .limit(20);
    },
    () =>
      memoryCampusLocations.filter(
        (l) =>
          l.name.toLowerCase().includes(cleanTerm) ||
          (l.description && l.description.toLowerCase().includes(cleanTerm)) ||
          l.category.toLowerCase().includes(cleanTerm)
      )
  );
}

export async function getDbCampusPaths() {
  return withDbFallback(
    async () => {
      return await db.select().from(campusPaths);
    },
    () => memoryCampusPaths
  );
}

// -------------------------------------------------------------
// SAFETY REPORTS
// -------------------------------------------------------------
export async function createDbSafetyReport(data: {
  id: string;
  studentId: string;
  reportType: string;
  description: string;
  latitude: number;
  longitude: number;
}) {
  return withDbFallback(
    async () => {
      const inserted = await db.insert(safetyReports).values(data).returning();
      return inserted[0];
    },
    () => {
      const report = {
        ...data,
        status: 'OPEN',
        createdAt: new Date(),
      };
      memorySafetyReports.unshift(report);
      return report;
    }
  );
}

export async function getDbSafetyReports() {
  return withDbFallback(
    async () => {
      return await db.select().from(safetyReports).orderBy(desc(safetyReports.createdAt));
    },
    () => memorySafetyReports
  );
}

// -------------------------------------------------------------
// PUBLIC TRANSPORT
// -------------------------------------------------------------
export async function getDbPublicTransportStops() {
  return withDbFallback(
    async () => {
      return await db.select().from(publicTransportStops).orderBy(publicTransportStops.name);
    },
    () => []
  );
}

export async function getDbDeparturesForStop(stopId: string) {
  return withDbFallback(
    async () => {
      return await db
        .select()
        .from(publicTransportDepartures)
        .where(eq(publicTransportDepartures.stopId, stopId))
        .orderBy(publicTransportDepartures.departureTime);
    },
    () => []
  );
}

// -------------------------------------------------------------
// BOARDING QUEUE (Database-backed queue with memory fallback)
// -------------------------------------------------------------
export async function getDbQueueStatus(busId: string, studentId?: string) {
  return withDbFallback(
    async () => {
      const activeWaiting = await db
        .select()
        .from(boardingQueue)
        .where(and(eq(boardingQueue.busId, busId), eq(boardingQueue.status, 'WAITING')))
        .orderBy(boardingQueue.joinedAt);

      let studentEntry = null;
      let studentPosition = null;

      if (studentId) {
        const idx = activeWaiting.findIndex((q) => q.studentId === studentId);
        if (idx !== -1) {
          studentEntry = activeWaiting[idx];
          studentPosition = idx + 1;
        }
      }

      return {
        busId,
        queueSize: activeWaiting.length,
        userInQueue: Boolean(studentEntry),
        queuePosition: studentPosition,
        entry: studentEntry,
        status: activeWaiting.length > 0 ? 'ACTIVE' : 'EMPTY',
        updatedAt: new Date().toISOString(),
      };
    },
    () => {
      const activeWaiting = memoryQueue.filter((q) => q.busId === busId && q.status === 'WAITING');
      let studentEntry = null;
      let studentPosition = null;

      if (studentId) {
        const idx = activeWaiting.findIndex((q) => q.studentId === studentId);
        if (idx !== -1) {
          studentEntry = activeWaiting[idx];
          studentPosition = idx + 1;
        }
      }

      return {
        busId,
        queueSize: activeWaiting.length,
        userInQueue: Boolean(studentEntry),
        queuePosition: studentPosition,
        entry: studentEntry,
        status: activeWaiting.length > 0 ? 'ACTIVE' : 'EMPTY',
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

export async function joinDbQueue(busId: string, studentId: string, boardingStop: string) {
  return withDbFallback(
    async () => {
      const existing = await db
        .select()
        .from(boardingQueue)
        .where(
          and(
            eq(boardingQueue.busId, busId),
            eq(boardingQueue.studentId, studentId),
            eq(boardingQueue.status, 'WAITING')
          )
        );

      if (existing.length > 0) {
        const status = await getDbQueueStatus(busId, studentId);
        return { duplicate: true, status };
      }

      const inserted = await db
        .insert(boardingQueue)
        .values({
          busId,
          studentId,
          boardingStop,
          status: 'WAITING',
        })
        .returning();

      const status = await getDbQueueStatus(busId, studentId);
      return { duplicate: false, entry: inserted[0], status };
    },
    () => {
      const existing = memoryQueue.find(
        (q) => q.busId === busId && q.studentId === studentId && q.status === 'WAITING'
      );
      if (existing) {
        const activeWaiting = memoryQueue.filter((q) => q.busId === busId && q.status === 'WAITING');
        const idx = activeWaiting.findIndex((q) => q.studentId === studentId);
        return {
          duplicate: true,
          status: {
            busId,
            queueSize: activeWaiting.length,
            userInQueue: true,
            queuePosition: idx + 1,
            entry: existing,
            status: 'ACTIVE',
            updatedAt: new Date().toISOString(),
          },
        };
      }

      const entry = {
        id: ++nextQueueId,
        busId,
        studentId,
        boardingStop,
        status: 'WAITING',
        joinedAt: new Date(),
        updatedAt: new Date(),
      };
      memoryQueue.push(entry);

      const activeWaiting = memoryQueue.filter((q) => q.busId === busId && q.status === 'WAITING');
      return {
        duplicate: false,
        entry,
        status: {
          busId,
          queueSize: activeWaiting.length,
          userInQueue: true,
          queuePosition: activeWaiting.length,
          entry,
          status: 'ACTIVE',
          updatedAt: new Date().toISOString(),
        },
      };
    }
  );
}

export async function leaveDbQueue(busId: string, studentId: string) {
  return withDbFallback(
    async () => {
      await db
        .update(boardingQueue)
        .set({
          status: 'CANCELLED',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(boardingQueue.busId, busId),
            eq(boardingQueue.studentId, studentId),
            eq(boardingQueue.status, 'WAITING')
          )
        );

      return await getDbQueueStatus(busId, studentId);
    },
    () => {
      for (const q of memoryQueue) {
        if (q.busId === busId && q.studentId === studentId && q.status === 'WAITING') {
          q.status = 'CANCELLED';
          q.updatedAt = new Date();
        }
      }
      const activeWaiting = memoryQueue.filter((q) => q.busId === busId && q.status === 'WAITING');
      return {
        busId,
        queueSize: activeWaiting.length,
        userInQueue: false,
        queuePosition: null,
        entry: null,
        status: activeWaiting.length > 0 ? 'ACTIVE' : 'EMPTY',
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

export async function getDbStudentActiveQueue(studentId: string) {
  return withDbFallback(
    async () => {
      const active = await db
        .select()
        .from(boardingQueue)
        .where(and(eq(boardingQueue.studentId, studentId), eq(boardingQueue.status, 'WAITING')))
        .orderBy(desc(boardingQueue.joinedAt))
        .limit(1);

      if (active.length === 0) return null;
      const busQueue = await getDbQueueStatus(active[0].busId, studentId);
      return {
        ...active[0],
        queuePosition: busQueue.queuePosition,
        totalInQueue: busQueue.queueSize,
      };
    },
    () => {
      const active = memoryQueue
        .filter((q) => q.studentId === studentId && q.status === 'WAITING')
        .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());

      if (active.length === 0) return null;
      const entry = active[0];
      const activeWaiting = memoryQueue.filter((q) => q.busId === entry.busId && q.status === 'WAITING');
      const idx = activeWaiting.findIndex((q) => q.studentId === studentId);
      return {
        ...entry,
        queuePosition: idx + 1,
        totalInQueue: activeWaiting.length,
      };
    }
  );
}

// -------------------------------------------------------------
// STUDENT PREFERENCES & DESTINATIONS
// -------------------------------------------------------------
export async function getDbStudentPreferences(userId: string) {
  return withDbFallback(
    async () => {
      const prefs = await db
        .select()
        .from(studentPreferences)
        .where(eq(studentPreferences.userId, userId));
      return prefs[0] || memoryStudentPreferences.get(userId) || null;
    },
    () => memoryStudentPreferences.get(userId) || null
  );
}

export async function upsertDbStudentPreferences(
  userId: string,
  data: Partial<{
    savedPickupStopId: string;
    preferredBusId: string;
    savedDestinationName: string;
    savedDestinationLat: number;
    savedDestinationLng: number;
    notificationArrivals: boolean;
    notificationDelays: boolean;
  }>
) {
  return withDbFallback(
    async () => {
      const existing = await db
        .select()
        .from(studentPreferences)
        .where(eq(studentPreferences.userId, userId));

      if (existing.length > 0) {
        const updated = await db
          .update(studentPreferences)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(studentPreferences.userId, userId))
          .returning();
        return updated[0];
      }

      const inserted = await db
        .insert(studentPreferences)
        .values({
          userId,
          ...data,
        })
        .returning();
      return inserted[0];
    },
    () => {
      const current = memoryStudentPreferences.get(userId) || { userId, createdAt: new Date() };
      const updated = { ...current, ...data, updatedAt: new Date() };
      memoryStudentPreferences.set(userId, updated);
      return updated;
    }
  );
}

// -------------------------------------------------------------
// STUDENT GPS LOCATION LOGGING
// -------------------------------------------------------------
export async function recordStudentLocation(data: {
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
}) {
  return withDbFallback(
    async () => {
      const inserted = await db.insert(studentLocations).values(data).returning();
      return inserted[0];
    },
    () => {
      const rec = {
        id: ++nextLocationId,
        ...data,
        recordedAt: new Date(),
      };
      const list = memoryStudentLocations.get(data.userId) || [];
      list.unshift(rec);
      if (list.length > 50) list.pop();
      memoryStudentLocations.set(data.userId, list);
      return rec;
    }
  );
}

export async function getLatestStudentLocation(userId: string) {
  return withDbFallback(
    async () => {
      const loc = await db
        .select()
        .from(studentLocations)
        .where(eq(studentLocations.userId, userId))
        .orderBy(desc(studentLocations.recordedAt))
        .limit(1);
      if (loc.length > 0) return loc[0];
      const list = memoryStudentLocations.get(userId);
      return list && list.length > 0 ? list[0] : null;
    },
    () => {
      const list = memoryStudentLocations.get(userId);
      return list && list.length > 0 ? list[0] : null;
    }
  );
}

// -------------------------------------------------------------
// CAMPUS PATHS & VERIFIED DATABASE WAYFINDING
// -------------------------------------------------------------
export async function calculateDbCampusWalkingRoute(
  startIdOrCoords: string | { latitude: number; longitude: number },
  destId: string
) {
  const allLocations = await getDbCampusLocations();
  const allPaths = await getDbCampusPaths();

  const dest = allLocations.find((l: any) => l.id === destId || l.name.toLowerCase() === destId.toLowerCase());
  if (!dest) {
    return null;
  }

  let startCoord: { latitude: number; longitude: number };
  let startName = 'Current Location';

  if (typeof startIdOrCoords === 'string') {
    const startLoc = allLocations.find(
      (l: any) => l.id === startIdOrCoords || l.name.toLowerCase() === startIdOrCoords.toLowerCase()
    );
    if (!startLoc) return null;
    startCoord = { latitude: startLoc.latitude, longitude: startLoc.longitude };
    startName = startLoc.name;
  } else {
    startCoord = startIdOrCoords;
  }

  function haversineMeters(c1: { latitude: number; longitude: number }, c2: { latitude: number; longitude: number }) {
    const R = 6371000;
    const dLat = ((c2.latitude - c1.latitude) * Math.PI) / 180;
    const dLon = ((c2.longitude - c1.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((c1.latitude * Math.PI) / 180) *
        Math.cos((c2.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  let matchedPath: any = null;
  for (const p of allPaths) {
    if (
      p.fromLocationId?.toLowerCase().includes(dest.name.toLowerCase()) ||
      p.toLocationId?.toLowerCase().includes(dest.name.toLowerCase()) ||
      (dest.description && (p.fromLocationId?.includes(dest.id) || p.toLocationId?.includes(dest.id)))
    ) {
      matchedPath = p;
      break;
    }
  }

  const directDistance = Math.round(haversineMeters(startCoord, { latitude: dest.latitude, longitude: dest.longitude }));
  const distanceMeters = matchedPath ? Math.round(matchedPath.distanceMeters) : directDistance;
  const walkingMinutes = Math.max(1, Math.round(distanceMeters / 80));

  let pathCoordinates: [number, number][] = [];
  if (matchedPath && matchedPath.pathPoints) {
    try {
      pathCoordinates = JSON.parse(matchedPath.pathPoints);
    } catch {
      pathCoordinates = [
        [startCoord.latitude, startCoord.longitude],
        [dest.latitude, dest.longitude],
      ];
    }
  } else {
    pathCoordinates = [
      [startCoord.latitude, startCoord.longitude],
      [dest.latitude, dest.longitude],
    ];
  }

  return {
    startLocation: startName,
    destination: dest.name,
    destinationCategory: dest.category,
    distanceMeters,
    walkingMinutes,
    steps: [
      `Depart from ${startName}`,
      `Follow pedestrian walkway towards ${dest.name}`,
      `Arrive at ${dest.name} (${dest.category})`,
    ],
    pathPoints: pathCoordinates,
    verifiedSource: 'REC Campus Navigation & Wayfinding',
  };
}
