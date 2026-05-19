"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";

interface ActiveSession {
  id: string;
  examId: string;
  ipAddress?: string;
  userAgent?: string;
  startedAt?: string;
  student: { id: string; firstName: string; lastName: string; studentId?: string };
  exam: { id: string; title: string; courseCode: string };
  seatingAssignment?: { seatX: number; seatY: number; seatLabel?: string; venue?: { id: string; name: string } };
}

interface Venue { id: string; name: string; capacity: number }

interface Toast { id: string; type: "success" | "error"; message: string }

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export default function RelocatePage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null);
  const [form, setForm] = useState({ newIpAddress: "", venueId: "", newSeatX: 0, newSeatY: 0, newSeatLabel: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(type: Toast["type"], message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  async function loadData() {
    setIsLoading(true);
    try {
      const [sessRes, venRes] = await Promise.all([
        api.get("/sessions/active"),
        api.get("/invigilator/venues"),
      ]);
      setSessions(sessRes.data.data || []);
      setVenues(venRes.data.data || []);
    } catch {
      pushToast("error", "Failed to load active sessions");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function openRelocate(session: ActiveSession) {
    setSelectedSession(session);
    setForm({
      newIpAddress: session.ipAddress || "",
      venueId: session.seatingAssignment?.venue?.id || "",
      newSeatX: session.seatingAssignment?.seatX || 0,
      newSeatY: session.seatingAssignment?.seatY || 0,
      newSeatLabel: session.seatingAssignment?.seatLabel || "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSession) return;
    setSubmitting(true);
    try {
      await api.patch(`/sessions/${selectedSession.id}/relocate`, form);
      pushToast("success", `Relocated ${selectedSession.student.firstName} ${selectedSession.student.lastName}`);
      setSelectedSession(null);
      await loadData();
    } catch (err: any) {
      pushToast("error", err.response?.data?.error?.message || "Relocation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <AnnouncementBadge tag="Live ops" message="Active session reassignment tool" tone="warning" />
            <GradientHeading
              title="Student Relocation"
              highlight="Active"
              subtitle="Move an in-progress exam session to a different computer, IP address, or seat without disrupting the student's work."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Active sessions" value={sessions.length} accent="emerald" icon={<Icon d="M12 8v4l3 3M12 2a10 10 0 100 20 10 10 0 000-20z" />} />
          <StatCard label="Venues available" value={venues.length} accent="indigo" icon={<Icon d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />} />
          <StatCard label="Seated" value={sessions.filter((s) => s.seatingAssignment).length} accent="blue" icon={<Icon d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} />
          <StatCard label="Unassigned" value={sessions.filter((s) => !s.seatingAssignment).length} accent="amber" icon={<Icon d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* Sessions list */}
          <div>
            <h2 className="mb-4 text-lg font-semibold text-white">Active Exam Sessions</h2>
            {isLoading ? (
              <GlowCard className="text-center text-sm text-white/40">Loading...</GlowCard>
            ) : sessions.length === 0 ? (
              <GlowCard className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40">
                  <Icon d="M12 8v4l3 3M12 2a10 10 0 100 20 10 10 0 000-20z" size={22} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">No live sessions</h3>
                <p className="mt-1 text-sm text-white/50">There are no active exam sessions right now.</p>
              </GlowCard>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => {
                  const active = selectedSession?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      className={`group rounded-xl border p-4 transition ${
                        active
                          ? "border-indigo-400/50 bg-indigo-500/10 shadow-lg shadow-indigo-500/10"
                          : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                          <span className="relative flex">
                            <span className="absolute inset-0 h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-white">
                            {s.student.firstName} {s.student.lastName}
                            {s.student.studentId && (
                              <span className="ml-2 font-mono text-xs text-white/40">{s.student.studentId}</span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-white/50">
                            <span className="font-mono text-indigo-300">{s.exam.courseCode}</span> · {s.exam.title}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            {s.ipAddress && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/60">
                                <Icon d="M5 12h14M12 5l7 7-7 7" size={10} />
                                IP: <span className="font-mono">{s.ipAddress}</span>
                              </span>
                            )}
                            {s.seatingAssignment?.venue && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-200">
                                <Icon d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" size={10} />
                                {s.seatingAssignment.venue.name}
                              </span>
                            )}
                            {s.seatingAssignment?.seatLabel && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-purple-200">
                                Seat {s.seatingAssignment.seatLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => openRelocate(s)}
                          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                            active
                              ? "bg-indigo-500/30 text-indigo-100"
                              : "bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg hover:shadow-purple-500/30"
                          }`}
                        >
                          {active ? "Selected" : "Relocate →"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Relocation form */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <h2 className="mb-4 text-lg font-semibold text-white">Relocation Form</h2>
            {selectedSession ? (
              <GlowCard
                title={
                  <span className="flex items-center gap-2">
                    {selectedSession.student.firstName} {selectedSession.student.lastName}
                  </span>
                }
                description={`${selectedSession.exam.courseCode} · ${selectedSession.exam.title}`}
                action={
                  <button
                    onClick={() => setSelectedSession(null)}
                    className="rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white"
                  >
                    <Icon d="M18 6L6 18M6 6l12 12" />
                  </button>
                }
              >
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Field label="New IP Address">
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 font-mono text-sm"
                      value={form.newIpAddress}
                      onChange={(e) => setForm({ ...form, newIpAddress: e.target.value })}
                      placeholder="e.g. 192.168.1.100"
                    />
                  </Field>
                  <Field label="Venue" required>
                    <select
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.venueId}
                      onChange={(e) => setForm({ ...form, venueId: e.target.value })}
                      required
                    >
                      <option value="" className="bg-slate-900">Select venue...</option>
                      {venues.map((v) => (
                        <option key={v.id} value={v.id} className="bg-slate-900">
                          {v.name} · cap {v.capacity}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Seat X">
                      <input
                        type="number"
                        step="0.01"
                        className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                        value={form.newSeatX}
                        onChange={(e) => setForm({ ...form, newSeatX: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                    <Field label="Seat Y">
                      <input
                        type="number"
                        step="0.01"
                        className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                        value={form.newSeatY}
                        onChange={(e) => setForm({ ...form, newSeatY: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                  </div>
                  <Field label="Seat Label">
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.newSeatLabel}
                      onChange={(e) => setForm({ ...form, newSeatLabel: e.target.value })}
                      placeholder="e.g. A12"
                    />
                  </Field>
                  <div className="flex gap-2 border-t border-white/5 pt-3">
                    <GlowButton type="submit" size="sm" className="flex-1" disabled={submitting}>
                      {submitting ? "Saving..." : "Confirm Relocation"}
                    </GlowButton>
                    <button
                      type="button"
                      onClick={() => setSelectedSession(null)}
                      className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </GlowCard>
            ) : (
              <GlowCard className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40">
                  <Icon d="M11 17l-5-5m0 0l5-5m-5 5h12" size={22} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">Pick a session</h3>
                <p className="mt-1 text-sm text-white/50">
                  Select an active session on the left to begin relocating.
                </p>
              </GlowCard>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
              t.type === "success" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" :
              "border-rose-500/40 bg-rose-500/15 text-rose-200"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
    </div>
  );
}
