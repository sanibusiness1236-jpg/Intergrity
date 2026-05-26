"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

// Single zone definition (kept as `GeofenceData` for backward-compatibility
// with the previous single-zone callers).
export interface GeofenceData {
  lat: number;
  lng: number;
  radius: number; // metres
}

export interface GeofenceZone extends GeofenceData {
  id: string;       // local-only, used by React keys
  name?: string;    // optional examiner-given label e.g. "Hall A"
}

interface Props {
  /** Pre-existing zones to seed the map with. */
  initialZones?: GeofenceZone[] | null;
  /** Legacy single-zone seed (kept so old callers still work). */
  initial?: GeofenceData | null;
  /** Fires whenever the zones list changes. */
  onZonesChange?: (zones: GeofenceZone[]) => void;
  /** Legacy callback for the first/active zone. */
  onChange?: (data: GeofenceData) => void;
}

const DEFAULT_RADIUS = 30;
const DEFAULT_CENTER = { lat: 5.6037, lng: -0.187 }; // Accra fallback

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Haversine distance in metres (client-side, for the drag handle).
function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ZONE_COLOURS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7", "#f97316"];

export default function GeofenceMap({
  initial,
  initialZones,
  onChange,
  onZonesChange,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layersRef = useRef<Record<string, { marker: any; circle: any; handle: any }>>({});
  const [ready, setReady] = useState(false);

  // Seed the zones array from either prop. We hold zones in state so the
  // list panel can render them.
  const initialState: GeofenceZone[] = (() => {
    if (Array.isArray(initialZones) && initialZones.length > 0) {
      return initialZones.map((z) => ({ ...z, id: z.id || uid() }));
    }
    if (initial) return [{ id: uid(), ...initial }];
    return [];
  })();

  const [zones, setZones] = useState<GeofenceZone[]>(initialState);
  const [activeId, setActiveId] = useState<string | null>(initialState[0]?.id || null);
  const [activeRadiusInput, setActiveRadiusInput] = useState<string>(
    initialState[0] ? String(initialState[0].radius) : String(DEFAULT_RADIUS)
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Refs that need to be visible inside Leaflet event handlers.
  const zonesRef = useRef(zones);
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Notify parent on every change.
  useEffect(() => {
    onZonesChange?.(zones);
    if (onChange && zones[0]) onChange({ lat: zones[0].lat, lng: zones[0].lng, radius: zones[0].radius });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  function updateZone(id: string, patch: Partial<GeofenceZone>) {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  }

  function activeZone(): GeofenceZone | null {
    const id = activeIdRef.current;
    return zonesRef.current.find((z) => z.id === id) || null;
  }

  /* ── Boot Leaflet (dynamic import, no SSR) ── */
  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;

    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L.Icon.Default as any).mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      leafletRef.current = L;

      const center = zones[0]
        ? [zones[0].lat, zones[0].lng]
        : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = L.map(mapRef.current!, { zoomControl: true }).setView(center as any, 17);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Render any pre-existing zones
      zones.forEach((z, i) => renderZone(L, map, z, i));
      if (zones.length > 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bounds = L.featureGroup(zones.map((z) => layersRef.current[z.id]?.circle).filter(Boolean) as any).getBounds();
        map.fitBounds(bounds, { padding: [40, 40] });
      } else if (zones.length === 1) {
        map.fitBounds(layersRef.current[zones[0].id].circle.getBounds(), { padding: [40, 40] });
      }

      // Map click → move / create the active zone
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        const current = activeZone();

        if (current) {
          // Move the active zone's centre
          updateZone(current.id, { lat, lng });
          // also update layers immediately
          renderZone(L, map, { ...current, lat, lng }, indexOfZone(current.id));
        } else {
          // No active zone — create the first one
          const fresh: GeofenceZone = {
            id: uid(),
            name: `Zone 1`,
            lat,
            lng,
            radius: DEFAULT_RADIUS,
          };
          setZones((prev) => [...prev, fresh]);
          setActiveId(fresh.id);
          setActiveRadiusInput(String(DEFAULT_RADIUS));
          renderZone(L, map, fresh, 0);
        }
      });

      requestAnimationFrame(() => map.invalidateSize());
      setTimeout(() => map.invalidateSize(), 250);

      if (typeof ResizeObserver !== "undefined" && mapRef.current) {
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapRef.current);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any).__ro = ro;
      }

      setReady(true);
    });

    return () => {
      cancelled = true;
      const m = mapInstanceRef.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m as any)?.__ro?.disconnect?.();
      m?.remove();
      mapInstanceRef.current = null;
      layersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function indexOfZone(id: string) {
    return zonesRef.current.findIndex((z) => z.id === id);
  }

  /* ── Render or refresh one zone's layers (marker + circle + handle) ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderZone(L: any, map: any, zone: GeofenceZone, indexHint: number) {
    const existing = layersRef.current[zone.id];
    if (existing) {
      existing.marker?.remove();
      existing.circle?.remove();
      existing.handle?.remove();
    }

    const colour = ZONE_COLOURS[indexHint % ZONE_COLOURS.length];

    const marker = L.marker([zone.lat, zone.lng]).addTo(map);
    marker.bindTooltip(zone.name || `Zone ${indexHint + 1}`, { permanent: false, direction: "top" });

    const circle = L.circle([zone.lat, zone.lng], {
      radius: zone.radius,
      color: colour,
      fillColor: colour,
      fillOpacity: 0.12,
      weight: 2,
    }).addTo(map);

    // Drag handle on the east edge
    const edgeLng = zone.lng + (zone.radius / (111320 * Math.cos((zone.lat * Math.PI) / 180)));
    const dragIcon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${colour};border:2px solid #fff;cursor:ew-resize;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const handle = L.marker([zone.lat, edgeLng], { icon: dragIcon, draggable: true, zIndexOffset: 1000 }).addTo(map);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle.on("drag", (ev: any) => {
      const hPos = ev.target.getLatLng();
      const z = zonesRef.current.find((x) => x.id === zone.id);
      if (!z) return;
      const newRadius = Math.max(5, Math.round(haversine(z.lat, z.lng, hPos.lat, hPos.lng)));
      circle.setRadius(newRadius);
      updateZone(z.id, { radius: newRadius });
      if (activeIdRef.current === z.id) setActiveRadiusInput(String(newRadius));
    });
    handle.on("dragend", () => {
      const z = zonesRef.current.find((x) => x.id === zone.id);
      if (!z) return;
      const snapLng = z.lng + (z.radius / (111320 * Math.cos((z.lat * Math.PI) / 180)));
      handle.setLatLng([z.lat, snapLng]);
    });

    // Click marker to make it the active zone
    marker.on("click", () => {
      setActiveId(zone.id);
      const fresh = zonesRef.current.find((x) => x.id === zone.id);
      if (fresh) setActiveRadiusInput(String(fresh.radius));
    });

    layersRef.current[zone.id] = { marker, circle, handle };
  }

  /* ── React → Leaflet sync: when zones change in state, redraw any
        zone whose stored radius/position differs from its layer. ── */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;
    zones.forEach((z, i) => {
      const layer = layersRef.current[z.id];
      if (!layer) {
        renderZone(L, map, z, i);
        return;
      }
      const c = layer.circle.getLatLng();
      if (c.lat !== z.lat || c.lng !== z.lng || layer.circle.getRadius() !== z.radius) {
        renderZone(L, map, z, i);
      }
    });
    // Remove orphaned layers (zones deleted from state)
    Object.keys(layersRef.current).forEach((id) => {
      if (!zones.find((z) => z.id === id)) {
        const layer = layersRef.current[id];
        layer.marker?.remove();
        layer.circle?.remove();
        layer.handle?.remove();
        delete layersRef.current[id];
      }
    });
  }, [zones]);

  function applyRadiusFromInput(raw: string) {
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < 5) return;
    if (!activeId) return;
    updateZone(activeId, { radius: val });
  }

  function addNewZone() {
    const map = mapInstanceRef.current;
    const centre = map?.getCenter?.();
    const lat = centre?.lat ?? DEFAULT_CENTER.lat;
    const lng = centre?.lng ?? DEFAULT_CENTER.lng;
    const fresh: GeofenceZone = {
      id: uid(),
      name: `Zone ${zones.length + 1}`,
      lat,
      lng,
      radius: DEFAULT_RADIUS,
    };
    setZones((prev) => [...prev, fresh]);
    setActiveId(fresh.id);
    setActiveRadiusInput(String(DEFAULT_RADIUS));
  }

  function removeZone(id: string) {
    setZones((prev) => prev.filter((z) => z.id !== id));
    if (activeId === id) {
      const remaining = zonesRef.current.filter((z) => z.id !== id);
      const next = remaining[0];
      setActiveId(next?.id || null);
      setActiveRadiusInput(next ? String(next.radius) : String(DEFAULT_RADIUS));
    }
  }

  function selectZone(id: string) {
    setActiveId(id);
    const z = zones.find((x) => x.id === id);
    if (z) {
      setActiveRadiusInput(String(z.radius));
      mapInstanceRef.current?.setView([z.lat, z.lng], 17);
    }
  }

  function renameZone(id: string, name: string) {
    updateZone(id, { name });
    // refresh the tooltip
    const layer = layersRef.current[id];
    if (layer?.marker) {
      layer.marker.unbindTooltip();
      layer.marker.bindTooltip(name || "Zone", { permanent: false, direction: "top" });
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude;
        const lng = coords.longitude;
        mapInstanceRef.current?.setView([lat, lng], 17);
        if (activeId) {
          updateZone(activeId, { lat, lng });
        } else {
          const fresh: GeofenceZone = {
            id: uid(),
            name: `Zone ${zones.length + 1}`,
            lat,
            lng,
            radius: DEFAULT_RADIUS,
          };
          setZones((prev) => [...prev, fresh]);
          setActiveId(fresh.id);
          setActiveRadiusInput(String(DEFAULT_RADIUS));
        }
      },
      () => {}
    );
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const results = await res.json();
      if (!results.length) { setSearchError("Location not found. Try a different search."); return; }
      const { lat, lon } = results[0];
      const lat2 = parseFloat(lat);
      const lng2 = parseFloat(lon);
      mapInstanceRef.current?.setView([lat2, lng2], 17);
      if (activeId) {
        updateZone(activeId, { lat: lat2, lng: lng2 });
      } else {
        const fresh: GeofenceZone = {
          id: uid(),
          name: searchQuery.slice(0, 30) || `Zone ${zones.length + 1}`,
          lat: lat2,
          lng: lng2,
          radius: DEFAULT_RADIUS,
        };
        setZones((prev) => [...prev, fresh]);
        setActiveId(fresh.id);
        setActiveRadiusInput(String(DEFAULT_RADIUS));
      }
    } catch {
      setSearchError("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  const active = zones.find((z) => z.id === activeId) || null;

  return (
    <div className="space-y-3">
      {/* Search + Use current location */}
      <div className="flex gap-2">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for a building or address…"
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 transition hover:bg-white/10 disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
        </form>
        <button
          type="button"
          onClick={useCurrentLocation}
          className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-300 transition hover:bg-indigo-500/20"
          title="Use my current location"
        >
          📍 My Location
        </button>
      </div>

      {searchError && (
        <p className="text-xs text-rose-400">{searchError}</p>
      )}

      {/* Map */}
      <div
        ref={mapRef}
        className="geofence-map-host h-96 w-full overflow-hidden rounded-xl border border-white/10"
        style={{ minHeight: 384, position: "relative" }}
      />

      <style jsx global>{`
        .geofence-map-host .leaflet-tile,
        .geofence-map-host .leaflet-marker-icon,
        .geofence-map-host .leaflet-marker-shadow {
          max-width: none !important;
          max-height: none !important;
        }
        .geofence-map-host .leaflet-container {
          background: #0f172a;
          width: 100%;
          height: 100%;
        }
      `}</style>

      {!ready && (
        <p className="text-center text-xs text-white/40">Loading map…</p>
      )}

      {/* Hint */}
      <p className="text-[11px] text-white/40">
        Click the map to {active ? "move the active zone's centre" : "drop your first pin"}, drag a
        coloured handle to resize, or hit
        <span className="mx-1 rounded border border-white/10 bg-white/5 px-1 text-white/60">+ Add another zone</span>
        to cover a second venue.
      </p>

      {/* Zones list */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">
            Location boundaries
            <span className="ml-2 text-xs font-normal text-white/40">
              ({zones.length} zone{zones.length === 1 ? "" : "s"})
            </span>
          </h4>
          <button
            type="button"
            onClick={addNewZone}
            className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
          >
            + Add another zone
          </button>
        </div>

        {zones.length === 0 ? (
          <p className="py-4 text-center text-xs text-white/40">
            No zones yet. Click anywhere on the map to drop your first pin, or use
            <span className="mx-1">📍 My Location</span>.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {zones.map((z, i) => {
              const colour = ZONE_COLOURS[i % ZONE_COLOURS.length];
              const isActive = z.id === activeId;
              return (
                <li
                  key={z.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
                    isActive ? "border-indigo-400/40 bg-indigo-500/10" : "border-white/5 bg-white/[0.02] hover:bg-white/5"
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-white/30"
                    style={{ background: colour }}
                  />
                  <button
                    type="button"
                    onClick={() => selectZone(z.id)}
                    className="text-xs font-medium text-white/80 hover:underline"
                    title="Select this zone (click map to move its centre)"
                  >
                    {isActive ? "●" : "○"}
                  </button>
                  <input
                    value={z.name || ""}
                    onChange={(e) => renameZone(z.id, e.target.value)}
                    placeholder={`Zone ${i + 1}`}
                    className="w-32 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder-white/30 focus:border-indigo-500/40 focus:outline-none"
                  />
                  <span className="text-[11px] text-white/40">
                    {z.lat.toFixed(5)}, {z.lng.toFixed(5)}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="text-[11px] text-white/50">radius</span>
                    <input
                      type="number"
                      min={5}
                      value={z.radius}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 5) updateZone(z.id, { radius: v });
                        if (isActive) setActiveRadiusInput(e.target.value);
                      }}
                      className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white focus:border-indigo-500/40 focus:outline-none"
                    />
                    <span className="text-[11px] text-white/40">m</span>
                    <button
                      type="button"
                      onClick={() => removeZone(z.id)}
                      title="Remove this zone"
                      className="rounded p-1 text-rose-300/70 hover:bg-rose-500/15 hover:text-rose-300"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Active zone radius shortcut (keyboard-friendly) */}
      {active && (
        <div className="flex items-center gap-3">
          <label className="shrink-0 text-sm text-white/60">
            Active radius ({active.name || `Zone ${indexOfZone(active.id) + 1}`}):
          </label>
          <input
            type="number"
            min={5}
            value={activeRadiusInput}
            onChange={(e) => setActiveRadiusInput(e.target.value)}
            onBlur={() => applyRadiusFromInput(activeRadiusInput)}
            onKeyDown={(e) => { if (e.key === "Enter") applyRadiusFromInput(activeRadiusInput); }}
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30"
          />
          <span className="text-sm font-medium text-indigo-300">{active.radius} m</span>
        </div>
      )}
    </div>
  );
}
