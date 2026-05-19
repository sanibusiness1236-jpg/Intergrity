"use client";

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { DashboardShell, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import type { Venue, InvigilatorReport } from "@/types";

const SEVERITY_TONE: Record<string, string> = {
  critical: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  info: "border-blue-500/40 bg-blue-500/15 text-blue-200",
  low: "border-white/15 bg-white/5 text-white/70",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-rose-400",
  warning: "bg-amber-400",
  info: "bg-blue-400",
  low: "bg-white/40",
};

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [reports, setReports] = useState<InvigilatorReport[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/invigilator/venues").then(({ data }) => setVenues(data.data || [])).catch(() => {}),
      api.get("/invigilator/reports").then(({ data }) => setReports(data.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const filteredReports = useMemo(
    () => selectedVenue ? reports.filter((r) => r.venueId === selectedVenue) : reports,
    [reports, selectedVenue]
  );

  const stats = useMemo(() => {
    const critical = reports.filter((r) => r.severity === "critical").length;
    const warning = reports.filter((r) => r.severity === "warning").length;
    const totalCapacity = venues.reduce((s, v) => s + (v.capacity || 0), 0);
    return { venues: venues.length, critical, warning, totalCapacity };
  }, [venues, reports]);

  const selectedVenueObj = venues.find((v) => v.id === selectedVenue);

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <AnnouncementBadge tag="Field Ops" message="Manage venues and incident reports" />
            <GradientHeading
              title="Venue Management"
              highlight="On-site"
              subtitle="Monitor exam venues, capacity, and review incident reports across your assigned locations."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Venues" value={stats.venues} accent="indigo" icon={<Icon d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />} />
          <StatCard label="Total Capacity" value={stats.totalCapacity} accent="blue" icon={<Icon d="M17 20h5v-2a3 3 0 00-3-3h-2m-3-3a4 4 0 11-8 0 4 4 0 018 0z" />} />
          <StatCard label="Critical Reports" value={stats.critical} accent="rose" icon={<Icon d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} />
          <StatCard label="Warnings" value={stats.warning} accent="amber" icon={<Icon d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />} />
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Venues</h2>
            {selectedVenue && (
              <button
                onClick={() => setSelectedVenue(null)}
                className="text-xs text-white/60 hover:text-white"
              >
                Clear filter
              </button>
            )}
          </div>

          {loading && venues.length === 0 ? (
            <GlowCard className="text-center text-sm text-white/40">Loading venues…</GlowCard>
          ) : venues.length === 0 ? (
            <GlowCard className="text-center text-sm text-white/50">No venues assigned yet.</GlowCard>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {venues.map((v) => {
                const active = selectedVenue === v.id;
                const venueReports = reports.filter((r) => r.venueId === v.id);
                const venueCritical = venueReports.filter((r) => r.severity === "critical").length;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVenue(active ? null : v.id)}
                    className={`group relative overflow-hidden rounded-xl border p-5 text-left transition-all hover:-translate-y-0.5 ${
                      active
                        ? "border-indigo-400/50 bg-indigo-500/10 shadow-lg shadow-indigo-500/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5"
                    }`}
                  >
                    <div className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-500/20 to-transparent blur-2xl transition-opacity ${
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                    }`} />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                          <Icon d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" size={18} />
                        </div>
                        {venueCritical > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                            {venueCritical}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-3 text-base font-semibold text-white">{v.name}</h3>
                      <p className="mt-1 text-xs text-white/50">
                        Capacity: <span className="text-white">{v.capacity}</span>
                      </p>
                      <div className="mt-3 flex items-center gap-3 text-[11px] text-white/40">
                        <span>{venueReports.length} report{venueReports.length !== 1 ? "s" : ""}</span>
                        {active && <span className="text-indigo-300">· filtering</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">
              Incident Reports
              {selectedVenueObj && (
                <span className="ml-2 text-sm font-normal text-white/50">— {selectedVenueObj.name}</span>
              )}
            </h2>
            <span className="text-xs text-white/40">{filteredReports.length} total</span>
          </div>

          {filteredReports.length === 0 ? (
            <GlowCard className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40">
                <Icon d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={22} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">All clear</h3>
              <p className="mt-1 text-sm text-white/50">No incident reports in this view.</p>
            </GlowCard>
          ) : (
            <div className="space-y-2">
              {filteredReports.map((r) => {
                const tone = SEVERITY_TONE[r.severity] || SEVERITY_TONE.low;
                const dot = SEVERITY_DOT[r.severity] || SEVERITY_DOT.low;
                return (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20 hover:bg-white/[0.04]"
                  >
                    <span className={`mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white">{r.content}</p>
                      <p className="mt-1 text-[11px] text-white/40">
                        {new Date(r.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
                      {r.severity}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
