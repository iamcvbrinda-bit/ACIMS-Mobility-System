import { Router, type IRouter } from "express";
import {
  getDbBuses,
  getDbBusById,
  getDbStopsByRoute,
  recordBusLocation,
  getLatestBusLocation,
  getRecentBusLocations,
  startTrackingSession,
  pauseTrackingSession,
  resumeTrackingSession,
  stopTrackingSession,
  getBusTrackingSession,
  isBusTrackingActive,
  verifyDriverBusAssignment,
} from "../../../../src/db/services.ts";
import { getRouteForBus } from "../services/routesData";
import {
  validateGpsCoordinate,
  evaluateFreshness,
  calculateNextStopAndEta,
  type ComputedTelemetry,
  type RouteStopInfo,
} from "../services/gpsEngine";
import { realtimeHub } from "../services/realtimeHub";
import { syncBusNotifications } from "../services/notificationEngine";

const router: IRouter = Router();

/**
 * Builds real computed telemetry for a bus using verified database GPS, route stops, and session state
 */
export async function buildBusTelemetry(busId: string): Promise<ComputedTelemetry> {
  const bus = await getDbBusById(busId);
  const busNumber = bus?.busNumber || busId.replace("bus-", "");
  const routeDef = getRouteForBus(busId);
  const routeId = bus?.routeId || routeDef?.id || `route-${busId}`;
  
  // 1. Fetch real stops from Cloud SQL
  const dbStops = await getDbStopsByRoute(routeId);
  const stops: RouteStopInfo[] =
    dbStops.length > 0
      ? dbStops.map((s, idx) => ({
          id: s.id,
          name: s.stopName,
          sequence: s.sequenceNumber,
          latitude: s.latitude,
          longitude: s.longitude,
          minutesFromPrevious: idx === 0 ? 0 : 3,
        }))
      : (routeDef?.stops || []).map((s: any, idx: number) => ({
          id: s.id || `stop-${idx}`,
          name: s.name || s.stopName || `Stop ${idx + 1}`,
          sequence: s.sequence ?? idx,
          latitude: s.latitude,
          longitude: s.longitude,
          minutesFromPrevious: s.minutesFromPrevious || (idx === 0 ? 0 : 3),
        }));

  // 2. Fetch latest verified GPS coordinate from bus_locations
  const latestLoc = await getLatestBusLocation(busId);

  // 3. Check active tracking session state
  const trackingState = await isBusTrackingActive(busId);

  // 4. Calculate centralized freshness based on driver device timestamp
  const { freshness, secondsAgo } = evaluateFreshness(
    latestLoc?.recordedAt || null,
    trackingState.status
  );

  // 5. If no location has ever been transmitted, return honest unverified/unavailable state
  if (!latestLoc) {
    const firstStop = stops[0]?.name ? `${stops[0].name} (Origin)` : "Route Origin";
    return {
      busId,
      busNumber,
      driverId: bus?.driverId || undefined,
      latitude: null as any,
      longitude: null as any,
      accuracy: null,
      speed: null,
      heading: null,
      altitude: null,
      nextStop: firstStop,
      nextStopId: stops[0]?.id || "origin",
      isAtStop: false,
      isApproachingStop: false,
      stopSequenceIndex: 0,
      etaMinutes: 0,
      formattedEta: "Unavailable (Not Tracking)",
      etaLabel: "UNAVAILABLE",
      etaConfidence: "UNAVAILABLE",
      remainingDistanceKm: 0,
      status: trackingState.isActive
        ? "Driver Active · Waiting for GPS"
        : trackingState.isPaused
        ? "Tracking Paused"
        : "NOT TRACKING · Awaiting Driver GPS",
      freshness: "UNAVAILABLE",
      isLive: false,
      trackingStatus: trackingState.status,
      recordedAt: new Date(0).toISOString(),
      receivedAt: new Date(0).toISOString(),
      networkDelayMs: 0,
      secondsAgo: Infinity,
      quality: "INVALID",
      source: "real-device-gps",
    };
  }

  // 6. Compute Next Stop and ETA using real GPS and route sequence
  const nextStopInfo = calculateNextStopAndEta(
    {
      latitude: latestLoc.latitude,
      longitude: latestLoc.longitude,
      speed: latestLoc.speed,
    },
    stops,
    freshness
  );

  const recordedDate = new Date(latestLoc.recordedAt);
  const receivedDate = new Date(latestLoc.receivedAt || latestLoc.recordedAt);
  const networkDelayMs = Math.max(0, receivedDate.getTime() - recordedDate.getTime());

  let displayStatus = nextStopInfo.statusText;
  if (trackingState.isPaused) {
    displayStatus = `Tracking Paused · Last near ${nextStopInfo.nextStop}`;
  } else if (!trackingState.isActive && freshness !== "LIVE") {
    displayStatus = `Trip Concluded · Last at ${nextStopInfo.nextStop}`;
  }

  return {
    busId,
    busNumber,
    driverId: latestLoc.driverId || bus?.driverId || undefined,
    latitude: latestLoc.latitude,
    longitude: latestLoc.longitude,
    accuracy: latestLoc.accuracy,
    speed: latestLoc.speed,
    heading: latestLoc.heading,
    altitude: latestLoc.altitude,
    nextStop: nextStopInfo.nextStop,
    nextStopId: nextStopInfo.nextStopId,
    previousStop: nextStopInfo.previousStop,
    previousStopId: nextStopInfo.previousStopId,
    isAtStop: nextStopInfo.isAtStop,
    isApproachingStop: nextStopInfo.isApproachingStop,
    stopSequenceIndex: nextStopInfo.stopSequenceIndex,
    etaMinutes: nextStopInfo.etaMinutes,
    formattedEta: nextStopInfo.formattedEta,
    etaLabel: nextStopInfo.etaLabel,
    etaConfidence: nextStopInfo.etaConfidence,
    remainingDistanceKm: nextStopInfo.remainingDistanceKm,
    status: displayStatus,
    freshness,
    isLive: freshness === "LIVE",
    trackingStatus: trackingState.status,
    recordedAt: recordedDate.toISOString(),
    receivedAt: receivedDate.toISOString(),
    networkDelayMs,
    secondsAgo,
    quality: latestLoc.accuracy && latestLoc.accuracy <= 15 ? "HIGH" : latestLoc.accuracy && latestLoc.accuracy <= 40 ? "ACCEPTABLE" : "POOR",
    source: "real-device-gps",
  };
}

// -------------------------------------------------------------
// LIST ALL BUSES
// -------------------------------------------------------------
router.get("/buses", async (_req, res) => {
  try {
    const dbBusesList = await getDbBuses();
    const results = await Promise.all(
      dbBusesList.map(async (bus) => {
        const routeDef = getRouteForBus(bus.id);
        const telemetry = await buildBusTelemetry(bus.id);

        return {
          id: bus.id,
          busNumber: bus.busNumber,
          origin: routeDef?.origin || "Central Campus",
          destination: routeDef?.destination || "City Station",
          routeLabel: routeDef?.name || "Campus Express",
          capacity: 45,
          currentLocation: { latitude: telemetry.latitude, longitude: telemetry.longitude },
          nextStop: telemetry.nextStop,
          nextStopId: telemetry.nextStopId,
          isAtStop: telemetry.isAtStop,
          etaMinutes: telemetry.etaMinutes,
          formattedEta: telemetry.formattedEta,
          etaLabel: telemetry.etaLabel,
          etaConfidence: telemetry.etaConfidence,
          remainingDistanceKm: telemetry.remainingDistanceKm,
          status: telemetry.status,
          updatedAt: telemetry.recordedAt,
          active: bus.active,
          routeId: bus.routeId || routeDef?.id || "route-bus-12",
          driverId: bus.driverId || undefined,
          locationMode: "driver-gps",
          freshness: telemetry.freshness,
          isLive: telemetry.isLive,
          networkDelayMs: telemetry.networkDelayMs,
          secondsAgo: telemetry.secondsAgo,
        };
      })
    );

    res.json(results);
  } catch (err: any) {
    console.error("Error listing buses:", err);
    res.status(500).json({ error: "Failed to list buses" });
  }
});

// -------------------------------------------------------------
// GET SINGLE BUS
// -------------------------------------------------------------
router.get("/buses/:busId", async (req, res) => {
  try {
    const { busId } = req.params;
    const bus = await getDbBusById(busId);
    if (!bus) {
      return res.status(404).json({ error: "Bus not found" });
    }

    const routeDef = getRouteForBus(bus.id);
    const telemetry = await buildBusTelemetry(bus.id);

    res.json({
      id: bus.id,
      busNumber: bus.busNumber,
      origin: routeDef?.origin || "Central Campus",
      destination: routeDef?.destination || "City Station",
      routeLabel: routeDef?.name || "Campus Express",
      capacity: 45,
      currentLocation: { latitude: telemetry.latitude, longitude: telemetry.longitude },
      nextStop: telemetry.nextStop,
      nextStopId: telemetry.nextStopId,
      isAtStop: telemetry.isAtStop,
      etaMinutes: telemetry.etaMinutes,
      formattedEta: telemetry.formattedEta,
      etaLabel: telemetry.etaLabel,
      etaConfidence: telemetry.etaConfidence,
      remainingDistanceKm: telemetry.remainingDistanceKm,
      status: telemetry.status,
      updatedAt: telemetry.recordedAt,
      active: bus.active,
      routeId: bus.routeId || routeDef?.id || "route-bus-12",
      driverId: bus.driverId || undefined,
      locationMode: "driver-gps",
      freshness: telemetry.freshness,
      isLive: telemetry.isLive,
      networkDelayMs: telemetry.networkDelayMs,
      secondsAgo: telemetry.secondsAgo,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get bus" });
  }
});

// -------------------------------------------------------------
// GET BUS LIVE LOCATION (Snapshot)
// -------------------------------------------------------------
router.get("/buses/:busId/location", async (req, res) => {
  try {
    const { busId } = req.params;
    const bus = await getDbBusById(busId);
    if (!bus) {
      return res.status(404).json({ error: "Bus not found" });
    }

    const telemetry = await buildBusTelemetry(bus.id);
    res.json(telemetry);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get bus location" });
  }
});

// -------------------------------------------------------------
// REALTIME SSE STREAM (Instant Server-Sent Events push)
// -------------------------------------------------------------
router.get("/realtime/bus/:busId", async (req, res) => {
  try {
    const { busId } = req.params;
    const bus = await getDbBusById(busId);
    if (!bus) {
      return res.status(404).json({ error: "Bus not found" });
    }

    const initialTelemetry = await buildBusTelemetry(busId);
    realtimeHub.subscribeBus(busId, res, initialTelemetry);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to connect to realtime location stream" });
  }
});

router.get("/realtime/buses", async (_req, res) => {
  try {
    const dbBusesList = await getDbBuses();
    const initialFleet = await Promise.all(
      dbBusesList.map((b) => buildBusTelemetry(b.id))
    );
    realtimeHub.subscribeAllBuses(res, initialFleet);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to connect to fleet realtime stream" });
  }
});

// -------------------------------------------------------------
// GET BUS RECENT GPS HISTORY
// -------------------------------------------------------------
router.get("/buses/:busId/history", async (req, res) => {
  try {
    const { busId } = req.params;
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
    const history = await getRecentBusLocations(busId, limit);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get location history" });
  }
});

// -------------------------------------------------------------
// GET BUS STOPS
// -------------------------------------------------------------
router.get("/buses/:busId/stops", async (req, res) => {
  try {
    const { busId } = req.params;
    const bus = await getDbBusById(busId);
    const routeId = bus?.routeId || `route-${busId}`;
    const dbStops = await getDbStopsByRoute(routeId);

    if (dbStops.length > 0) {
      const formatted = dbStops.map((s, idx) => ({
        id: s.id,
        name: s.stopName,
        sequence: s.sequenceNumber,
        latitude: s.latitude,
        longitude: s.longitude,
        pathIndex: idx * 6,
        minutesFromPrevious: idx === 0 ? 0 : 3,
      }));
      return res.json(formatted);
    }

    const routeDef = getRouteForBus(busId);
    res.json(routeDef?.stops || []);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get stops" });
  }
});

// -------------------------------------------------------------
// GET BUS ROUTE DETAILS
// -------------------------------------------------------------
router.get("/buses/:busId/route", async (req, res) => {
  try {
    const { busId } = req.params;
    const routeDef = getRouteForBus(busId);
    if (!routeDef) {
      return res.status(404).json({ error: "Route not found" });
    }

    const bus = await getDbBusById(busId);
    const routeId = bus?.routeId || routeDef.id;
    const dbStops = await getDbStopsByRoute(routeId);

    const formattedStops =
      dbStops.length > 0
        ? dbStops.map((s, idx) => ({
            id: s.id,
            name: s.stopName,
            sequence: s.sequenceNumber,
            latitude: s.latitude,
            longitude: s.longitude,
            pathIndex: idx * 6,
            minutesFromPrevious: idx === 0 ? 0 : 3,
          }))
        : routeDef.stops;

    res.json({
      ...routeDef,
      busId,
      busNumber: bus?.busNumber || routeDef.routeNumber,
      stops: formattedStops,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get route" });
  }
});

// -------------------------------------------------------------
// INGEST REAL DRIVER GPS (Single update)
// -------------------------------------------------------------
router.post("/bus/location", async (req, res) => {
  try {
    const {
      busId,
      latitude,
      longitude,
      accuracy,
      altitude,
      altitudeAccuracy,
      speed,
      heading,
      timestamp,
      driverId: bodyDriverId,
    } = req.body;

    if (!busId || typeof latitude !== "number" || typeof longitude !== "number") {
      return res.status(400).json({ error: "busId, valid latitude and longitude required" });
    }

    const bus = await getDbBusById(busId);
    if (!bus) {
      return res.status(404).json({ error: `Bus ${busId} not found` });
    }

    // 1. DRIVER AUTHORIZATION: Verify authenticated driver against assigned bus
    const driverId = req.header("x-acims-driver-id") || bodyDriverId;
    if (driverId) {
      const isAssigned = await verifyDriverBusAssignment(driverId, busId);
      if (!isAssigned && bus.driverId && bus.driverId !== driverId) {
        return res.status(403).json({
          error: `Unauthorized: Driver ${driverId} is not assigned to broadcast for bus ${bus.busNumber}`,
        });
      }
    }

    // 2. GPS QUALITY & MOVEMENT VALIDATION
    const receivedAt = new Date();
    const recordedAt = timestamp ? new Date(timestamp) : receivedAt;

    const lastLoc = await getLatestBusLocation(busId);
    const validation = validateGpsCoordinate(
      { latitude, longitude, accuracy, speed, recordedAt },
      lastLoc,
      receivedAt
    );

    if (!validation.isValid) {
      return res.status(400).json({
        error: `GPS point rejected: ${validation.rejectionReason}`,
        quality: validation.quality,
      });
    }

    // 3. PERSISTENCE IN CLOUD SQL
    const saved = await recordBusLocation({
      busId,
      driverId: driverId || bus.driverId || undefined,
      latitude,
      longitude,
      accuracy: typeof accuracy === "number" ? accuracy : null,
      altitude: typeof altitude === "number" ? altitude : null,
      altitudeAccuracy: typeof altitudeAccuracy === "number" ? altitudeAccuracy : null,
      speed: typeof speed === "number" ? speed : null,
      heading: typeof heading === "number" ? heading : null,
      recordedAt,
      receivedAt,
    });

    // 4. ENSURE TRACKING SESSION IS ACTIVE
    const trackingState = await isBusTrackingActive(busId);
    if (!trackingState.isActive) {
      await startTrackingSession(busId, driverId || bus.driverId || "driver-active");
    }

    // 5. RECALCULATE TELEMETRY
    const telemetry = await buildBusTelemetry(busId);

    // 6. REALTIME INSTANT BROADCAST TO ALL SUBSCRIBED STUDENTS & ADMIN
    realtimeHub.broadcastLocation(telemetry);

    // 7. NOTIFICATION HOOK: Check stop proximity for student alerts
    if (telemetry.isAtStop || telemetry.isApproachingStop) {
      syncBusNotifications(busId, telemetry.nextStop, telemetry.isAtStop, telemetry.isApproachingStop).catch(() => {});
    }

    res.json({
      success: true,
      telemetry,
      validation: {
        quality: validation.quality,
        networkDelayMs: validation.networkDelayMs,
      },
    });
  } catch (err: any) {
    console.error("Failed to ingest driver location:", err);
    res.status(500).json({ error: "Internal error recording GPS location" });
  }
});

// -------------------------------------------------------------
// BATCH INGEST OFFLINE-QUEUED GPS POINTS
// -------------------------------------------------------------
router.post("/bus/location/batch", async (req, res) => {
  try {
    const { busId, points } = req.body as {
      busId: string;
      points: Array<{
        latitude: number;
        longitude: number;
        accuracy?: number | null;
        altitude?: number | null;
        altitudeAccuracy?: number | null;
        speed?: number | null;
        heading?: number | null;
        timestamp: string;
        driverId?: string;
      }>;
    };

    if (!busId || !Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: "busId and points array required" });
    }

    const bus = await getDbBusById(busId);
    if (!bus) return res.status(404).json({ error: "Bus not found" });

    let insertedCount = 0;
    const receivedAt = new Date();

    // Sort chronologically by original recorded timestamp
    const sorted = [...points].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const pt of sorted) {
      const recordedAt = new Date(pt.timestamp);
      const validation = validateGpsCoordinate({
        latitude: pt.latitude,
        longitude: pt.longitude,
        accuracy: pt.accuracy,
        speed: pt.speed,
        recordedAt,
      });

      if (validation.isValid) {
        await recordBusLocation({
          busId,
          driverId: pt.driverId || bus.driverId || undefined,
          latitude: pt.latitude,
          longitude: pt.longitude,
          accuracy: pt.accuracy,
          altitude: pt.altitude,
          altitudeAccuracy: pt.altitudeAccuracy,
          speed: pt.speed,
          heading: pt.heading,
          recordedAt,
          receivedAt,
        });
        insertedCount++;
      }
    }

    const telemetry = await buildBusTelemetry(busId);
    realtimeHub.broadcastLocation(telemetry);

    res.json({
      success: true,
      insertedCount,
      totalReceived: points.length,
      currentTelemetry: telemetry,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to batch upload offline GPS coordinates" });
  }
});

// -------------------------------------------------------------
// DRIVER TRACKING SESSION CONTROLS
// -------------------------------------------------------------
router.post("/driver/session/start", async (req, res) => {
  try {
    const { busId, driverId = "driver-active" } = req.body;
    if (!busId) return res.status(400).json({ error: "busId required" });

    const bus = await getDbBusById(busId);
    if (!bus) return res.status(404).json({ error: "Bus not found" });

    // Verify driver assignment
    const isAssigned = await verifyDriverBusAssignment(driverId, busId);
    if (!isAssigned && bus.driverId && bus.driverId !== driverId) {
      return res.status(403).json({
        error: `Unauthorized: Driver ${driverId} is not assigned to bus ${bus.busNumber}`,
      });
    }

    const session = await startTrackingSession(busId, driverId);
    realtimeHub.broadcastSessionState(busId, "ACTIVE", session);
    res.json({ status: "ACTIVE", session });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to start tracking session" });
  }
});

router.post("/driver/session/pause", async (req, res) => {
  try {
    const { busId } = req.body;
    if (!busId) return res.status(400).json({ error: "busId required" });

    const session = await pauseTrackingSession(busId);
    realtimeHub.broadcastSessionState(busId, "PAUSED", session);
    res.json({ status: "PAUSED", session });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to pause tracking session" });
  }
});

router.post("/driver/session/resume", async (req, res) => {
  try {
    const { busId } = req.body;
    if (!busId) return res.status(400).json({ error: "busId required" });

    const session = await resumeTrackingSession(busId);
    realtimeHub.broadcastSessionState(busId, "ACTIVE", session);
    res.json({ status: "ACTIVE", session });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to resume tracking session" });
  }
});

router.post("/driver/session/stop", async (req, res) => {
  try {
    const { busId } = req.body;
    if (!busId) return res.status(400).json({ error: "busId required" });

    const session = await stopTrackingSession(busId);
    realtimeHub.broadcastSessionState(busId, "ENDED", session);
    res.json({ status: "ENDED", session });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to stop tracking session" });
  }
});

router.get("/driver/session/:busId", async (req, res) => {
  try {
    const { busId } = req.params;
    const session = await getBusTrackingSession(busId);
    res.json(session || { status: "IDLE", busId });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get session status" });
  }
});

export function startBusSimulation() {
  // Real GPS Architecture: Zero simulation loop.
  return null;
}

export default router;
