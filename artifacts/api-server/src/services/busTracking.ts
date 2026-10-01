import {
  type Coordinate,
  type RouteStop,
  type RouteDefinition,
  getRouteForBus,
  getAllRoutes,
  getRouteById,
} from "./routesData";
import { determineStopContext, formatEta, haversineDistance } from "./eta";

export type { Coordinate, RouteStop };

export type BusStop = Coordinate & {
  id: string;
  name: string;
  sequence: number;
  pathIndex: number;
  minutesFromPrevious: number;
};

export type BusLocation = Coordinate & {
  busId: string;
  nextStopId: string;
  nextStop: string;
  previousStopId?: string;
  previousStop?: string;
  currentStop?: string;
  isAtStop?: boolean;
  etaMinutes: number;
  formattedEta?: string;
  remainingDistanceKm?: number;
  status: string;
  updatedAt: Date;
  source: string; // "simulated" | "driver-gps"
  isSimulated?: boolean;
  routeId?: string;
  routeName?: string;
  busNumber?: string;
  origin?: string;
  destination?: string;
  pathIndex?: number;
};

export type Bus = {
  id: string;
  busNumber: string;
  origin: string;
  destination: string;
  routeLabel: string;
  capacity: number;
  currentLocation: Coordinate;
  nextStop: string;
  nextStopId: string;
  previousStop?: string;
  previousStopId?: string;
  isAtStop?: boolean;
  etaMinutes: number;
  formattedEta?: string;
  remainingDistanceKm?: number;
  status: string;
  updatedAt: Date;
  active: boolean;
  routeId: string;
  driverId?: string;
  locationMode: "untracked" | "driver-gps";
  pathIndex: number;
};

const fleetState: Bus[] = [
  {
    id: "bus-18",
    busNumber: "18",
    origin: "Metro Central Station",
    destination: "Medical Sciences Center",
    routeLabel: "Metro Connector Feeder",
    capacity: 50,
    currentLocation: { latitude: 12.9249, longitude: 80.1275 },
    nextStop: "Metro Central Station",
    nextStopId: "metro-central",
    previousStop: undefined,
    previousStopId: undefined,
    isAtStop: true,
    etaMinutes: 0,
    formattedEta: "Unavailable (Not Tracking)",
    remainingDistanceKm: 0,
    status: "NOT TRACKING · Awaiting Driver GPS",
    updatedAt: new Date(0),
    active: true,
    routeId: "route-bus-18",
    driverId: undefined,
    locationMode: "untracked",
    pathIndex: 0,
  },
  {
    id: "bus-12",
    busNumber: "12",
    origin: "Vandalur Transit Hub",
    destination: "Academic Quad",
    routeLabel: "Campus Loop A",
    capacity: 40,
    currentLocation: { latitude: 12.8924, longitude: 80.0812 },
    nextStop: "Vandalur Transit Hub",
    nextStopId: "vandalur",
    previousStop: undefined,
    previousStopId: undefined,
    isAtStop: true,
    etaMinutes: 0,
    formattedEta: "Unavailable (Not Tracking)",
    remainingDistanceKm: 0,
    status: "NOT TRACKING · Awaiting Driver GPS",
    updatedAt: new Date(0),
    active: true,
    routeId: "route-bus-12",
    driverId: undefined,
    locationMode: "untracked",
    pathIndex: 0,
  },
  {
    id: "bus-4b",
    busNumber: "4B",
    origin: "North Residence Complex",
    destination: "Tech & Innovation Park",
    routeLabel: "Engineering Express",
    capacity: 45,
    currentLocation: { latitude: 12.9421, longitude: 80.1245 },
    nextStop: "North Residence Complex",
    nextStopId: "north-residence",
    previousStop: undefined,
    previousStopId: undefined,
    isAtStop: true,
    etaMinutes: 0,
    formattedEta: "Unavailable (Not Tracking)",
    remainingDistanceKm: 0,
    status: "NOT TRACKING · Awaiting Driver GPS",
    updatedAt: new Date(0),
    active: true,
    routeId: "route-bus-4b",
    driverId: undefined,
    locationMode: "untracked",
    pathIndex: 0,
  },
  {
    id: "bus-7",
    busNumber: "7",
    origin: "Hostel Village",
    destination: "Central Library & Union",
    routeLabel: "North Campus Shuttle",
    capacity: 35,
    currentLocation: { latitude: 12.9145, longitude: 80.1122 },
    nextStop: "Hostel Village",
    nextStopId: "hostel-village",
    previousStop: undefined,
    previousStopId: undefined,
    isAtStop: true,
    etaMinutes: 0,
    formattedEta: "Unavailable (Not Tracking)",
    remainingDistanceKm: 0,
    status: "NOT TRACKING · Awaiting Driver GPS",
    updatedAt: new Date(0),
    active: true,
    routeId: "route-bus-7",
    driverId: undefined,
    locationMode: "untracked",
    pathIndex: 0,
  },
  {
    id: "bus-21",
    busNumber: "21",
    origin: "South Commuter Lot",
    destination: "Main Auditorium",
    routeLabel: "South Perimeter Circle",
    capacity: 30,
    currentLocation: { latitude: 12.9015, longitude: 80.0935 },
    nextStop: "South Commuter Lot",
    nextStopId: "south-lot",
    previousStop: undefined,
    previousStopId: undefined,
    isAtStop: true,
    etaMinutes: 0,
    formattedEta: "Unavailable (Not Tracking)",
    remainingDistanceKm: 0,
    status: "NOT TRACKING · Awaiting Driver GPS",
    updatedAt: new Date(0),
    active: true,
    routeId: "route-bus-21",
    driverId: undefined,
    locationMode: "untracked",
    pathIndex: 0,
  },
];

// Tracks whether each bus has received live driver GPS recently
const lastDriverGpsTime: Record<string, number> = {};

function buildDerivedLocation(bus: Bus): BusLocation {
  const route = getRouteForBus(bus.id);
  const isSimulated = bus.locationMode === "simulated";

  return {
    busId: bus.id,
    latitude: bus.currentLocation.latitude,
    longitude: bus.currentLocation.longitude,
    nextStopId: bus.nextStopId,
    nextStop: bus.nextStop,
    previousStopId: bus.previousStopId,
    previousStop: bus.previousStop,
    isAtStop: bus.isAtStop,
    etaMinutes: bus.etaMinutes,
    formattedEta: bus.formattedEta || formatEta(bus.etaMinutes),
    remainingDistanceKm: bus.remainingDistanceKm,
    status: bus.status,
    updatedAt: bus.updatedAt,
    source: isSimulated ? "simulated" : "driver-gps",
    isSimulated,
    routeId: route.id,
    routeName: route.name,
    busNumber: bus.busNumber,
    origin: bus.origin,
    destination: bus.destination,
    pathIndex: bus.pathIndex,
  };
}

export function getBuses(): Bus[] {
  return fleetState.map((bus) => ({
    ...bus,
    currentLocation: { ...bus.currentLocation },
  }));
}

export function getBus(id: string): Bus | undefined {
  const bus = fleetState.find((candidate) => candidate.id === id);
  return bus ? { ...bus, currentLocation: { ...bus.currentLocation } } : undefined;
}

export function createBusInFleet(bus: Bus): Bus {
  fleetState.push(bus);
  return { ...bus, currentLocation: { ...bus.currentLocation } };
}

export function updateBusInFleet(id: string, updates: Partial<Bus>): Bus | undefined {
  const bus = fleetState.find((candidate) => candidate.id === id);
  if (!bus) return undefined;
  Object.assign(bus, updates);
  bus.updatedAt = new Date();
  return { ...bus, currentLocation: { ...bus.currentLocation } };
}

export function deactivateBusInFleet(id: string): Bus | undefined {
  const bus = fleetState.find((candidate) => candidate.id === id);
  if (!bus) return undefined;
  bus.active = !bus.active;
  bus.status = bus.active ? "Standby" : "Inactive";
  bus.updatedAt = new Date();
  return { ...bus, currentLocation: { ...bus.currentLocation } };
}

export function getStops(busId: string): BusStop[] {
  const route = getRouteForBus(busId);
  return route.stops.map((stop) => ({
    id: stop.id,
    name: stop.name,
    sequence: stop.sequence,
    pathIndex: stop.pathIndex,
    latitude: stop.latitude,
    longitude: stop.longitude,
    minutesFromPrevious: stop.minutesFromPrevious,
  }));
}

export function getRouteDetails(busId: string) {
  const route = getRouteForBus(busId);
  return {
    routeId: route.id,
    busId,
    busNumber: route.routeNumber,
    name: route.name,
    origin: route.origin,
    destination: route.destination,
    path: route.path,
    stops: route.stops,
    totalDistanceKm: route.totalDistanceKm,
    cumulativeDistances: route.cumulativeDistances,
  };
}

export function getLocation(id: string): BusLocation | undefined {
  const bus = fleetState.find((candidate) => candidate.id === id);
  if (!bus) return undefined;
  return buildDerivedLocation(bus);
}

/**
 * Ingest Driver GPS update from driver's device or browser Geolocation API
 */
export function updateLocation(
  id: string,
  location: Coordinate,
  source = "driver-gps",
  timestamp = new Date().toISOString(),
) {
  const bus = fleetState.find((candidate) => candidate.id === id);
  if (!bus) return undefined;

  const route = getRouteForBus(id);
  const context = determineStopContext(route, location);

  bus.currentLocation = {
    latitude: Number(location.latitude.toFixed(6)),
    longitude: Number(location.longitude.toFixed(6)),
  };
  bus.nextStop = context.nextStop.name;
  bus.nextStopId = context.nextStop.id;
  bus.previousStop = context.previousStop.name;
  bus.previousStopId = context.previousStop.id;
  bus.isAtStop = context.isAtStop;
  bus.etaMinutes = context.etaToNextMinutes;
  bus.formattedEta = context.formattedEta;
  bus.remainingDistanceKm = context.remainingDistanceToNextKm;
  bus.pathIndex = context.nearestPathIndex;
  bus.locationMode = "driver-gps";
  bus.status = context.isAtStop
    ? `At Stop: ${context.currentStop?.name || context.nextStop.name}`
    : "On Time (Driver GPS)";
  bus.updatedAt = new Date(timestamp);

  lastDriverGpsTime[id] = Date.now();

  return buildDerivedLocation(bus);
}

/**
 * Real GPS Architecture: Zero simulation loop.
 * Bus locations strictly come from real physical Driver Portal GPS broadcasts.
 */
export function advanceSimulation() {
  const primaryBus = fleetState.find((b) => b.id === "bus-18") || fleetState[0];
  return buildDerivedLocation(primaryBus);
}

export function startSimulation(_onTick: () => void) {
  // No-op: simulation disabled in real-data architecture
  return () => {};
}
