"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export interface GeofenceData {
  lat: number;
  lng: number;
  radius: number; // metres
}

interface Props {
  initial?: GeofenceData | null;
  onChange: (data: GeofenceData) => void;
}

const DEFAULT_RADIUS = 30;
const DEFAULT_CENTER = { lat: 5.6037, lng: -0.187 }; // Accra fallback

// Haversine distance in metres (client-side, for the drag handle)
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

export default function GeofenceMap({ initial, onChange }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);    // L
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const handleRef = useRef<any>(null);     // drag handle marker
  const [ready, setReady] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    initial ? { lat: initial.lat, lng: initial.lng } : null
  );
  const [radius, setRadius] = useState(initial?.radius ?? DEFAULT_RADIUS);
  const [radiusInput, setRadiusInput] = useState(String(initial?.radius ?? DEFAULT_RADIUS));
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Keep refs in sync so Leaflet event handlers see the latest state
  const pinRef = useRef(pin);
  const radiusRef = useRef(radius);
  useEffect(() => { pinRef.current = pin; }, [pin]);
  useEffect(() => { radiusRef.current = radius; }, [radius]);

  /* ── Boot Leaflet (dynamic import, no SSR) ── */
  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return;

    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current) return;

      // Fix default icon paths broken by webpack
      (L.Icon.Default as any).mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      leafletRef.current = L;
      const center = pin
        ? [pin.lat, pin.lng]
        : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

      const map = L.map(mapRef.current!, { zoomControl: true }).setView(center as any, 17);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Restore saved pin if any
      if (pin) {
        placeMarkerAndCircle(L, map, pin.lat, pin.lng, radiusRef.current);
      }

      // Click to place / move pin
      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        placeMarkerAndCircle(L, map, lat, lng, radiusRef.current);
        const next = { lat, lng };
        pinRef.current = next;
        setPin(next);
        onChange({ lat, lng, radius: radiusRef.current });
      });

      // Force a reflow so tiles align even when the container was hidden
      // (e.g. mounted inside a tab) at first render.
      requestAnimationFrame(() => map.invalidateSize());
      setTimeout(() => map.invalidateSize(), 250);

      // Also re-flow whenever the container changes size
      if (typeof ResizeObserver !== "undefined" && mapRef.current) {
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapRef.current);
        (map as any).__ro = ro;
      }

      setReady(true);
    });

    return () => {
      cancelled = true;
      const m = mapInstanceRef.current;
      (m as any)?.__ro?.disconnect?.();
      m?.remove();
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Place / update marker + circle + drag handle ── */
  function placeMarkerAndCircle(L: any, map: any, lat: number, lng: number, r: number) {
    // Remove old layers
    markerRef.current?.remove();
    circleRef.current?.remove();
    handleRef.current?.remove();

    // Pin marker
    const marker = L.marker([lat, lng]).addTo(map);
    markerRef.current = marker;

    // Geofence circle
    const circle = L.circle([lat, lng], {
      radius: r,
      color: "#6366f1",
      fillColor: "#6366f1",
      fillOpacity: 0.12,
      weight: 2,
    }).addTo(map);
    circleRef.current = circle;

    // Invisible drag handle on the east edge of the circle
    const edgeLng = lng + (r / (111320 * Math.cos((lat * Math.PI) / 180)));
    const dragIcon = L.divIcon({
      className: "",
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#6366f1;border:2px solid #fff;cursor:ew-resize;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const handle = L.marker([lat, edgeLng], { icon: dragIcon, draggable: true, zIndexOffset: 1000 }).addTo(map);
    handleRef.current = handle;

    handle.on("drag", (ev: any) => {
      const hPos = ev.target.getLatLng();
      const curPin = pinRef.current;
      if (!curPin) return;
      const newRadius = Math.max(5, Math.round(haversine(curPin.lat, curPin.lng, hPos.lat, hPos.lng)));
      radiusRef.current = newRadius;
      setRadius(newRadius);
      setRadiusInput(String(newRadius));
      circle.setRadius(newRadius);
      onChange({ lat: curPin.lat, lng: curPin.lng, radius: newRadius });
    });

    // Keep handle snapped to east edge when circle radius changes externally
    handle.on("dragend", () => {
      const curPin = pinRef.current;
      if (!curPin) return;
      const snapLng = curPin.lng + (radiusRef.current / (111320 * Math.cos((curPin.lat * Math.PI) / 180)));
      handle.setLatLng([curPin.lat, snapLng]);
    });

    map.fitBounds(circle.getBounds(), { padding: [40, 40] });
  }

  /* ── Sync radius input → map ── */
  function applyRadiusFromInput(raw: string) {
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < 5) return;
    const r = val;
    setRadius(r);
    radiusRef.current = r;
    if (pinRef.current && leafletRef.current && mapInstanceRef.current) {
      placeMarkerAndCircle(leafletRef.current, mapInstanceRef.current, pinRef.current.lat, pinRef.current.lng, r);
    }
    if (pinRef.current) onChange({ ...pinRef.current, radius: r });
  }

  /* ── Use current location ── */
  function useCurrentLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        mapInstanceRef.current?.setView([lat, lng], 17);
        placeMarkerAndCircle(leafletRef.current, mapInstanceRef.current, lat, lng, radiusRef.current);
        const next = { lat, lng };
        pinRef.current = next;
        setPin(next);
        onChange({ lat, lng, radius: radiusRef.current });
      },
      () => {}
    );
  }

  /* ── Nominatim search (free, no API key) ── */
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
      placeMarkerAndCircle(leafletRef.current, mapInstanceRef.current, lat2, lng2, radiusRef.current);
      const next = { lat: lat2, lng: lng2 };
      pinRef.current = next;
      setPin(next);
      onChange({ lat: lat2, lng: lng2, radius: radiusRef.current });
    } catch {
      setSearchError("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

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

      {/* Map container — explicit height + Leaflet-safe img reset */}
      <div
        ref={mapRef}
        className="geofence-map-host h-96 w-full overflow-hidden rounded-xl border border-white/10"
        style={{ minHeight: 384, position: "relative" }}
      />

      {/* Local style to neutralise global img/max-width rules that break Leaflet tiles */}
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
        Click anywhere on the map to drop a pin, then drag the
        <span className="mx-1 inline-block h-3 w-3 rounded-full bg-indigo-500 align-middle" />
        handle or type below to adjust the boundary radius.
      </p>

      {/* Radius control */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-white/60 shrink-0">Radius (meters)</label>
        <input
          type="number"
          min={5}
          value={radiusInput}
          onChange={(e) => setRadiusInput(e.target.value)}
          onBlur={() => applyRadiusFromInput(radiusInput)}
          onKeyDown={(e) => { if (e.key === "Enter") applyRadiusFromInput(radiusInput); }}
          className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30"
        />
        <span className="text-sm text-indigo-300 font-medium">{radius} m</span>
        {pin && (
          <span className="ml-auto text-[11px] text-white/30">
            📌 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}
