import { useEffect, useMemo, useState, useRef } from 'react';
import { 
  BusFront, 
  LocateFixed, 
  MapPin, 
  Navigation, 
  Radio, 
  Route as RouteIcon, 
  CheckCircle2, 
  Clock3, 
  AlertTriangle,
  Smartphone,
  Play,
  RotateCcw,
  Sparkles,
  Info
} from 'lucide-react';
import { divIcon } from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { 
  useListBuses, 
  getListBusesQueryKey 
} from '@workspace/api-client-react';
import { 
  EmptyState, 
  ErrorState, 
  LoadingRows, 
  PageHeading, 
  selectBus, 
  useSelectedBusId 
} from '@/components/acims-ui';
import { useNetworkStatus } from '@/hooks/use-network';
import { OfflineMobilityView } from '@/components/offline-mobility-view';
import { saveLastKnownBusSnapshot } from '@/lib/offline-storage';
import { 
  useBusRealtimeLocation, 
  sendDriverGpsUpdate, 
  type Coordinate, 
  type RouteStop 
} from '@/lib/realtime-location';
import 'leaflet/dist/leaflet.css';

/**
 * Controller to handle Follow-Bus and View-Reset within Leaflet MapContainer
 */
function MapCameraController({ 
  busPosition, 
  routeBounds, 
  followBus 
}: { 
  busPosition: [number, number] | null; 
  routeBounds: [number, number][]; 
  followBus: boolean;
}) {
  const map = useMap();
  const initialFitDone = useRef(false);

  // Initial fit to route bounds
  useEffect(() => {
    if (!initialFitDone.current && routeBounds.length > 1) {
      map.fitBounds(routeBounds, { padding: [40, 40], maxZoom: 16 });
      initialFitDone.current = true;
    }
  }, [map, routeBounds]);

  // Smooth follow camera
  useEffect(() => {
    if (followBus && busPosition) {
      map.panTo(busPosition, { animate: true, duration: 1.0 });
    }
  }, [map, busPosition, followBus]);

  return null;
}

export default function LiveMap() {
  const { isOnline } = useNetworkStatus();
  const selectedBusId = useSelectedBusId();
  const busesQuery = useListBuses({ query: { enabled: isOnline, queryKey: getListBusesQueryKey() } });

  // Fallback to bus-18 if no bus is explicitly selected
  const activeBusId = selectedBusId || 'bus-18';

  const bus = useMemo(() => {
    return busesQuery.data?.find((b) => b.id === activeBusId) ?? busesQuery.data?.[0];
  }, [busesQuery.data, activeBusId]);

  const effectiveBusId = bus?.id ?? activeBusId;

  // Realtime Location Hook
  const {
    location,
    routeDetails,
    freshness,
    isLoading: isLocationLoading,
    isRealtimeConnected,
    refresh: refreshLocation,
  } = useBusRealtimeLocation(effectiveBusId, isOnline);

  // Map state controls
  const [followBus, setFollowBus] = useState(true);
  const [driverModeOpen, setDriverModeOpen] = useState(false);
  const [gpsStatusMessage, setGpsStatusMessage] = useState<string>('');
  const [isTransmittingGps, setIsTransmittingGps] = useState(false);

  // Cache bus state for offline view
  useEffect(() => {
    if (bus) {
      saveLastKnownBusSnapshot(bus);
    }
  }, [bus]);

  const busNumber = location?.busNumber || bus?.busNumber || '18';
  const routeName = location?.routeName || routeDetails?.name || bus?.routeLabel || 'Metro Connector Feeder';
  const origin = location?.origin || routeDetails?.origin || bus?.origin || 'Metro Central Station';
  const destination = location?.destination || routeDetails?.destination || bus?.destination || 'Medical Sciences Center';

  // Path coordinates
  const path: Coordinate[] = routeDetails?.path && routeDetails.path.length > 0
    ? routeDetails.path
    : [
        { latitude: 12.9249, longitude: 80.1275 },
        { latitude: 12.9272, longitude: 80.1302 },
        { latitude: 12.9301, longitude: 80.1336 },
        { latitude: 12.9338, longitude: 80.1368 },
        { latitude: 12.9372, longitude: 80.1396 },
      ];

  // Route stops
  const stops: RouteStop[] = routeDetails?.stops && routeDetails.stops.length > 0
    ? routeDetails.stops
    : [
        { id: 'metro-central', name: 'Metro Central Station', sequence: 0, pathIndex: 0, latitude: 12.9249, longitude: 80.1275 },
        { id: 'jb-estate', name: 'JB Estate', sequence: 1, pathIndex: 6, latitude: 12.9272, longitude: 80.1302 },
        { id: 'ponnu', name: 'Ponnu', sequence: 2, pathIndex: 12, latitude: 12.9301, longitude: 80.1336 },
        { id: 'ramratna', name: 'Ramratna', sequence: 3, pathIndex: 18, latitude: 12.9338, longitude: 80.1368 },
        { id: 'medical-sciences', name: 'Medical Sciences Center', sequence: 4, pathIndex: 24, latitude: 12.9372, longitude: 80.1396 },
      ];

  // Current bus coordinate - ONLY when real live coordinates are available
  const hasLiveBusGps = Boolean(
    location &&
    location.isLive &&
    location.freshness !== 'UNAVAILABLE' &&
    typeof location.latitude === 'number' &&
    typeof location.longitude === 'number' &&
    !isNaN(location.latitude) &&
    !isNaN(location.longitude)
  );

  const busPosition: [number, number] | null = hasLiveBusGps
    ? [location.latitude, location.longitude]
    : null;

  // Traveled portion vs Remaining portion of route path
  const busPathIndex = location?.pathIndex ?? 0;
  const traveledPathCoords = useMemo(() => {
    const subset = path.slice(0, Math.min(path.length, busPathIndex + 1));
    const coords = subset.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (coords.length > 0 && busPosition) coords.push(busPosition);
    return coords;
  }, [path, busPathIndex, busPosition]);

  const remainingPathCoords = useMemo(() => {
    const subset = path.slice(Math.max(0, busPathIndex));
    const coords = subset.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (coords.length > 0 && busPosition) coords.unshift(busPosition);
    return coords;
  }, [path, busPathIndex, busPosition]);

  const fullRouteBounds = useMemo(() => {
    return path.map((p) => [p.latitude, p.longitude] as [number, number]);
  }, [path]);

  // OFFLINE MODE: clean switch to offline storage (executed after all hooks run unconditionally)
  if (!isOnline) {
    return <OfflineMobilityView initialTab="routes" selectedBusId={effectiveBusId} />;
  }

  if (busesQuery.isLoading && !bus) return <LoadingRows count={4} />;
  if (busesQuery.isError) return <ErrorState onRetry={() => void busesQuery.refetch()} />;

  // Transmit real Browser Geolocation API coordinates as Driver GPS
  const handleTransmitDeviceGps = () => {
    if (!navigator.geolocation) {
      setGpsStatusMessage('Browser does not support Geolocation.');
      return;
    }

    setIsTransmittingGps(true);
    setGpsStatusMessage('Acquiring device GPS coordinates…');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords: Coordinate = {
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        };
        const updated = await sendDriverGpsUpdate(effectiveBusId, coords);
        setIsTransmittingGps(false);
        if (updated) {
          setGpsStatusMessage(`Driver GPS sent: ${coords.latitude}, ${coords.longitude} (Mode: Driver GPS)`);
          void refreshLocation();
        } else {
          setGpsStatusMessage('Failed to ingest driver coordinates to server.');
        }
      },
      (err) => {
        setIsTransmittingGps(false);
        setGpsStatusMessage(`GPS acquisition failed: ${err.message}. (Grant permission or test along campus path)`);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const nextStopName = location?.nextStop || bus?.nextStop || stops[1]?.name || 'Next stop';
  const prevStopName = location?.previousStop || stops[0]?.name;
  const isAtStop = location?.isAtStop ?? false;
  const etaMinutes = location?.etaMinutes ?? bus?.etaMinutes ?? 4;
  const formattedEta = location?.formattedEta || (etaMinutes <= 0 ? 'Arriving now' : `approximately ${etaMinutes} min`);

  return (
    <div className="page-in space-y-6">
      {/* Page Header */}
      <PageHeading
        eyebrow="Real-Time Campus Transit"
        title="Live Bus Tracking"
        description="Continuous geographic tracking, real-time stop sequence, and dynamic remaining distance ETA from verified onboard driver GPS."
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Realtime / Stale Freshness Indicator */}
            {isRealtimeConnected && freshness.statusBadge === 'LIVE' ? (
              <div 
                data-testid="badge-status-live" 
                className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3.5 py-1.5 text-xs font-extrabold text-emerald-800 dark:text-emerald-300 shadow-xs"
              >
                <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-500" />
                <span>LIVE REALTIME</span>
                <span className="text-[10px] font-medium text-emerald-700/80 dark:text-emerald-400/80">
                  · {freshness.freshnessLabel}
                </span>
              </div>
            ) : freshness.statusBadge === 'RECENT' ? (
              <div 
                data-testid="badge-status-recent" 
                className="flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/15 px-3 py-1.5 text-xs font-extrabold text-blue-800 dark:text-blue-300"
              >
                <Clock3 size={13} className="text-blue-600 dark:text-blue-400" />
                <span>RECENT GPS</span>
                <span className="text-[10px] font-medium text-blue-700/80 dark:text-blue-400/80">
                  · {freshness.freshnessLabel}
                </span>
              </div>
            ) : freshness.statusBadge === 'STALE' ? (
              <div 
                data-testid="badge-status-stale" 
                className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-extrabold text-amber-800 dark:text-amber-300"
              >
                <Clock3 size={13} className="text-amber-600 dark:text-amber-400" />
                <span>LAST KNOWN LOCATION</span>
                <span className="text-[10px] font-medium text-amber-700/80 dark:text-amber-400/80">
                  · {freshness.freshnessLabel}
                </span>
              </div>
            ) : (
              <div 
                data-testid="badge-status-unavailable" 
                className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-extrabold text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span>AWAITING DRIVER GPS</span>
              </div>
            )}

            {/* Link to Phone B Driver Console for physical 2-phone test */}
            <Link
              href="/driver"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition"
              title="Open Driver Phone Console on Device B"
            >
              <Smartphone size={13} className="text-accent-foreground" />
              <span>Driver Console</span>
            </Link>
          </div>
        }
      />

      {/* Primary Live Card Banner */}
      <section className="rounded-[28px] border-2 border-primary/20 bg-card p-6 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-primary text-accent shadow-md">
              <BusFront size={28} strokeWidth={2.4} />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-black text-primary">
                {busNumber}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="display-font text-2xl font-black text-foreground sm:text-3xl">
                  Bus {busNumber}
                </h2>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-extrabold text-secondary-foreground">
                  {routeName}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <span>{origin}</span>
                <span className="text-border">→</span>
                <span>{destination}</span>
              </div>
            </div>
          </div>

          {/* Next Stop & Geographic ETA Card */}
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-muted/30 p-4 sm:gap-8">
            <div>
              <div className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Next stop
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-base font-extrabold text-foreground sm:text-lg">
                <MapPin size={17} className="text-accent-foreground shrink-0" />
                <span>{nextStopName}</span>
                {isAtStop && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">
                    At Stop
                  </span>
                )}
              </div>
            </div>

            <div className="border-l border-border pl-4 sm:pl-8">
              <div className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {location?.etaLabel || "ETA"}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-base font-extrabold text-primary dark:text-accent sm:text-lg">
                  {formattedEta}
                </span>
                {location?.etaConfidence && location.etaConfidence !== "UNAVAILABLE" && (
                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                    location.etaConfidence === "HIGH" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                  }`}>
                    {location.etaConfidence}
                  </span>
                )}
              </div>
            </div>

            {location?.remainingDistanceKm !== undefined && (
              <div className="hidden border-l border-border pl-4 sm:block sm:pl-8">
                <div className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Distance
                </div>
                <div className="mt-0.5 text-base font-extrabold text-foreground sm:text-lg">
                  {location.remainingDistanceKm} km
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Driver GPS Testing Panel (Transparently implements architecture flow without fake GPS) */}
      {driverModeOpen && (
        <section className="rounded-2xl border-2 border-dashed border-primary/30 bg-muted/20 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <Smartphone size={16} className="text-primary" />
              <span>Driver GPS Ingestion Bridge</span>
            </div>
            <span className="mono text-[10px] uppercase text-muted-foreground">Future Driver Flow Tester</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Test the future driver pipeline: Driver Phone → Browser Geolocation API → Backend Ingestion (`/api/bus/location`) → Realtime Map.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTransmitDeviceGps}
              disabled={isTransmittingGps}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Smartphone size={14} />
              <span>{isTransmittingGps ? 'Reading GPS…' : 'Transmit My Browser Coordinates'}</span>
            </button>

            {gpsStatusMessage && (
              <span className="text-xs font-medium text-foreground">{gpsStatusMessage}</span>
            )}
          </div>
        </section>
      )}

      {/* Map & Stop Context Layout */}
      <section className="grid gap-6 xl:grid-cols-[1.5fr_.7fr]">
        {/* Leaflet Map Engine */}
        <div className="relative min-h-[520px] overflow-hidden rounded-[28px] border border-border bg-secondary/30 p-3 sm:p-5">
          {/* Top-Left Floating Info Overlay */}
          <div className="absolute left-6 top-6 z-[500] flex flex-col gap-1 rounded-2xl border border-border bg-card/90 px-4 py-2.5 shadow-md backdrop-blur-md">
            <div className="mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Route corridor
            </div>
            <div className="flex items-center gap-2 text-sm font-black text-foreground">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-accent text-xs font-bold">
                {busNumber}
              </span>
              <span>{routeName}</span>
            </div>
          </div>

          {/* Top-Right Camera Controls */}
          <div className="absolute right-6 top-6 z-[500] flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFollowBus((prev) => !prev)}
              title={followBus ? 'Follow Bus Mode: Enabled' : 'Follow Bus Mode: Click to Enable'}
              data-testid="button-toggle-follow-bus"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold shadow-sm backdrop-blur transition ${
                followBus
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card/90 text-muted-foreground hover:bg-card'
              }`}
            >
              <LocateFixed size={14} className={followBus ? 'animate-pulse' : ''} />
              <span>{followBus ? 'Following Bus' : 'Follow Bus'}</span>
            </button>
          </div>

          {/* Map Component */}
          <MapEngineVisualizer
            stops={stops}
            traveledPath={traveledPathCoords}
            remainingPath={remainingPathCoords}
            busPosition={busPosition}
            busNumber={busNumber}
            location={location}
            routeBounds={fullRouteBounds}
            followBus={followBus}
          />

          {/* Bottom Map Legend */}
          <div className="pointer-events-none absolute bottom-5 left-5 right-5 z-[500] flex flex-wrap items-center gap-3.5 rounded-2xl border border-border bg-card/90 px-4 py-2.5 text-[11px] font-bold shadow-md backdrop-blur-md">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-6 rounded-full bg-primary" />
              <span>Remaining Route</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-6 rounded-full border border-dashed border-slate-400 bg-slate-300 dark:bg-slate-700" />
              <span>Traveled Portion</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2 border-accent-foreground bg-accent" />
              <span>Next Stop</span>
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <Radio size={13} className="text-primary dark:text-accent" />
              <span>{hasLiveBusGps ? 'Driver GPS Telemetry (Live)' : 'Real Device GPS Awaiting Broadcast'}</span>
            </span>
          </div>
        </div>

        {/* Right Sidebar: Stop Sequence & Context */}
        <div className="rounded-[28px] border border-border bg-card p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <div className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Stop Sequence
              </div>
              <h3 className="mt-1 text-xl font-extrabold text-foreground">
                {stops.length} Route Stops
              </h3>
            </div>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-extrabold text-secondary-foreground">
              {location?.status || 'Active Line'}
            </span>
          </div>

          {/* Timeline of Stops */}
          <div className="mt-6 space-y-0">
            {stops.map((stop, index) => {
              const isNext = stop.id === location?.nextStopId;
              const isPassed = (stop.pathIndex ?? index * 6) < busPathIndex && !isNext;
              const isThisStopActive = isAtStop && (location?.currentStop === stop.name || isNext);

              return (
                <div key={stop.id} data-testid={`stop-timeline-row-${stop.id}`} className="group relative flex gap-4 pb-6 last:pb-0">
                  {/* Spine connection */}
                  <div className="relative flex w-4 justify-center">
                    <span
                      className={`z-10 mt-1 h-4 w-4 rounded-full border-4 transition-all ${
                        isThisStopActive
                          ? 'border-emerald-500 bg-emerald-100 ring-4 ring-emerald-500/20'
                          : isNext
                          ? 'border-accent-foreground bg-accent ring-4 ring-accent/30'
                          : isPassed
                          ? 'border-slate-400 bg-slate-300 dark:bg-slate-700'
                          : 'border-muted bg-card'
                      }`}
                    />
                    {index < stops.length - 1 && (
                      <span className={`absolute top-4 h-full w-0.5 ${isPassed ? 'bg-slate-400 dark:bg-slate-700' : 'bg-border'}`} />
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-extrabold ${isNext ? 'text-primary dark:text-accent font-black' : isPassed ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {stop.name}
                      </span>
                      {isNext && (
                        <span className="rounded-full bg-accent/30 px-2 py-0.5 text-[10px] font-extrabold text-accent-foreground">
                          Next
                        </span>
                      )}
                      {isThisStopActive && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">
                          Bus Here
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      {isNext ? (
                        <span className="font-bold text-accent-foreground">
                          Arriving in {formattedEta}
                        </span>
                      ) : isPassed ? (
                        <span>Passed</span>
                      ) : (
                        <span>Stop #{index + 1}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Context Footer */}
          <div className="mt-6 rounded-2xl bg-muted/50 p-4 text-xs">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <Navigation size={14} className="text-primary dark:text-accent" />
              <span>Route Progress</span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Bus #{busNumber} is moving from <strong>{prevStopName}</strong> toward <strong>{nextStopName}</strong>. 
              {location?.remainingDistanceKm ? ` ~${location.remainingDistanceKm} km remaining.` : ''}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Dedicated Leaflet Map Engine
 */
function MapEngineVisualizer({
  stops,
  traveledPath,
  remainingPath,
  busPosition,
  busNumber,
  location,
  routeBounds,
  followBus,
}: {
  stops: RouteStop[];
  traveledPath: [number, number][];
  remainingPath: [number, number][];
  busPosition: [number, number] | null;
  busNumber: string;
  location: any;
  routeBounds: [number, number][];
  followBus: boolean;
}) {
  const busIcon = useMemo(() => {
    return divIcon({
      className: 'acims-bus-marker',
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          background: hsl(195, 40%, 20%);
          border: 3px solid hsl(67, 100%, 69%);
          border-radius: 14px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          color: hsl(67, 100%, 69%);
          font-family: monospace;
          font-weight: 900;
          font-size: 13px;
        ">
          #${busNumber}
          <span style="
            position: absolute;
            top: -4px;
            right: -4px;
            width: 10px;
            height: 10px;
            background: #22c55e;
            border-radius: 50%;
            border: 2px solid white;
          "></span>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
  }, [busNumber]);

  return (
    <MapContainer
      center={busPosition || (stops[0] ? [stops[0].latitude, stops[0].longitude] : [13.0084, 80.0033])}
      zoom={14}
      scrollWheelZoom={false}
      className="h-[500px] min-h-[480px] w-full rounded-[22px]"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapCameraController
        busPosition={busPosition}
        routeBounds={routeBounds}
        followBus={followBus}
      />

      {/* Traveled portion of route (muted/dashed) */}
      {traveledPath.length > 1 && (
        <Polyline
          positions={traveledPath}
          pathOptions={{
            color: '#64748b',
            weight: 5,
            opacity: 0.65,
            dashArray: '8 8',
          }}
        />
      )}

      {/* Remaining portion of route (vibrant primary) */}
      {remainingPath.length > 1 && (
        <Polyline
          positions={remainingPath}
          pathOptions={{
            color: 'hsl(195, 40%, 20%)',
            weight: 6,
            opacity: 0.95,
          }}
        />
      )}

      {/* Route Stops */}
      {stops.map((stop, idx) => {
        const isNext = stop.id === location?.nextStopId;
        const isAtThisStop = location?.isAtStop && (location?.currentStop === stop.name || isNext);

        return (
          <CircleMarker
            key={stop.id}
            center={[stop.latitude, stop.longitude]}
            radius={isThisStopActive(isAtThisStop, isNext)}
            pathOptions={{
              color: isThisStopActive
                ? '#10b981'
                : isNext
                ? 'hsl(39, 96%, 58%)'
                : 'hsl(195, 40%, 20%)',
              fillColor: isThisStopActive
                ? '#10b981'
                : isNext
                ? 'hsl(67, 100%, 69%)'
                : 'white',
              fillOpacity: 1,
              weight: isNext || isThisStopActive ? 4 : 2.5,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <div className="font-sans text-xs">
                <strong>{stop.name}</strong>
                <div>Stop #{idx + 1}</div>
                {isNext && <div className="text-amber-600 font-bold">Next Stop · {location?.formattedEta || `${location?.etaMinutes} min`}</div>}
                {isThisStopActive && <div className="text-emerald-600 font-bold">Bus Currently at Stop</div>}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}

      {/* Bus Marker - only rendered when physical driver GPS is actively transmitting */}
      {busPosition && (
        <Marker position={busPosition} icon={busIcon}>
          <Tooltip direction="top" offset={[0, -22]} permanent={false}>
            <div className="font-sans text-xs">
              <strong>Bus #{busNumber}</strong>
              <div>Heading to: {location?.destination || 'Terminal'}</div>
              <div>Next: {location?.nextStop} ({location?.formattedEta || `${location?.etaMinutes} min`})</div>
              <div className="text-[10px] text-slate-500">Source: Real Driver GPS</div>
            </div>
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}

function isThisStopActive(isAtThisStop: boolean, isNext: boolean): number {
  if (isAtThisStop) return 11;
  if (isNext) return 10;
  return 7;
}