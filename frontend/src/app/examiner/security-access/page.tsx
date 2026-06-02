"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import type { InviteLink } from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "STUDENT", label: "Student Portal" },
  { value: "EXAMINER", label: "Examiner Portal" },
  { value: "INVIGILATOR", label: "Invigilator Portal" },
];

const ROLE_COLOR: Record<string, string> = {
  STUDENT: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  EXAMINER: "bg-purple-500/15 text-purple-300 border-purple-400/30",
  INVIGILATOR: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[role] ?? "bg-white/10 text-white/60 border-white/20"}`}>
      {ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role}
    </span>
  );
}

function formatExpiry(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isExpired(iso: string) {
  return new Date(iso) < new Date();
}

interface ExaminerRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  createdAt: string;
}

// ─── main page ──────────────────────────────────────────────────────────────

export default function SecurityAccessPage() {
  const { user } = useAuthStore();

  const isSuperAdmin = user?.isSuperAdmin || user?.role === "ADMIN";

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v1M5 21h14a2 2 0 002-2v-5a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="max-w-sm text-sm text-white/50">
          This page is restricted to Super Admins only. Contact your platform administrator for access.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Security &amp; Access</h1>
          <p className="mt-1 text-sm text-white/50">
            Manage invitation links and Super Admin privileges.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Super Admin
        </span>
      </div>

      <InviteLinksPanel />
      <ExaminersPanel />
    </div>
  );
}

// ─── Invite Links panel ──────────────────────────────────────────────────────

function InviteLinksPanel() {
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [form, setForm] = useState({
    role: "STUDENT",
    expiresAt: "",
    singleUse: true,
    maxUses: 10,
    note: "",
  });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/invites");
      setInvites(data.data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);
    try {
      await api.post("/invites", {
        role: form.role,
        expiresAt: form.expiresAt,
        singleUse: form.singleUse,
        maxUses: form.singleUse ? 1 : form.maxUses,
        note: form.note,
      });
      setShowForm(false);
      setForm({ role: "STUDENT", expiresAt: "", singleUse: true, maxUses: 10, note: "" });
      await load();
    } catch (err: any) {
      setFormError(err.response?.data?.error?.message || "Failed to create invite");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this invitation link? It will no longer work.")) return;
    try {
      await api.delete(`/invites/${id}`);
      setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, isActive: false } : i)));
    } catch {
      alert("Failed to revoke");
    }
  }

  function buildLink(token: string) {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/register?token=${token}`;
  }

  function copyLink(invite: InviteLink) {
    navigator.clipboard.writeText(buildLink(invite.token));
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // default expiresAt to 7 days from now when opening the form
  function openForm() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setForm((p) => ({ ...p, expiresAt: local }));
    setShowForm(true);
  }

  return (
    <section className="glow-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Invitation Links</h2>
          <p className="mt-0.5 text-xs text-white/40">
            Generate links to invite students, invigilators, or examiners.
          </p>
        </div>
        <button
          onClick={openForm}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-medium text-white shadow shadow-indigo-500/20 transition hover:opacity-90"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Link
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-white">Create Invitation Link</h3>

          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {formError}
            </div>
          )}

          {/* Role */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-white/60">Portal / Role</label>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, role: r.value }))}
                  className={`h-10 rounded-lg border text-xs font-medium transition-all ${
                    form.role === r.value
                      ? "border-indigo-400/60 bg-indigo-500/20 text-white"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white/90"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Expiry */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-white/60">Link expires at</label>
            <input
              type="datetime-local"
              required
              value={form.expiresAt}
              onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
              className="auth-input flex h-11 w-full rounded-lg px-3 text-sm"
            />
          </div>

          {/* Usage */}
          <div className="grid gap-2">
            <label className="text-xs font-medium text-white/60">Usage limit</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, singleUse: true }))}
                className={`flex-1 h-10 rounded-lg border text-xs font-medium transition-all ${
                  form.singleUse
                    ? "border-indigo-400/60 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:text-white/90"
                }`}
              >
                Single use
              </button>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, singleUse: false }))}
                className={`flex-1 h-10 rounded-lg border text-xs font-medium transition-all ${
                  !form.singleUse
                    ? "border-indigo-400/60 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:text-white/90"
                }`}
              >
                Multi-use
              </button>
            </div>
            {!form.singleUse && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-white/50 whitespace-nowrap">Max uses:</label>
                <input
                  type="number"
                  min={2}
                  max={1000}
                  value={form.maxUses}
                  onChange={(e) => setForm((p) => ({ ...p, maxUses: parseInt(e.target.value) || 10 }))}
                  className="auth-input h-9 w-24 rounded-lg px-3 text-sm"
                />
              </div>
            )}
          </div>

          {/* Note */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-white/60">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. CS 111 Midterm cohort"
              value={form.note}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
              className="auth-input flex h-11 w-full rounded-lg px-3 text-sm"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={creating}
              className="h-10 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Generate Link"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-10 rounded-lg border border-white/15 bg-white/5 px-5 text-sm text-white/70 transition hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Invite list */}
      {loading ? (
        <div className="py-8 text-center text-sm text-white/40">Loading…</div>
      ) : invites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-white/30">
          No invitation links yet. Click <strong className="text-white/50">New Link</strong> to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {invites.map((inv) => {
            const expired = isExpired(inv.expiresAt);
            const exhausted = inv.usedCount >= inv.maxUses;
            const dead = !inv.isActive || expired || exhausted;

            return (
              <div
                key={inv.id}
                className={`rounded-xl border p-4 transition-all ${
                  dead
                    ? "border-white/8 bg-white/3 opacity-60"
                    : "border-white/12 bg-white/5"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleBadge role={inv.role} />
                      {inv.note && (
                        <span className="text-xs text-white/40 italic">{inv.note}</span>
                      )}
                      {dead && (
                        <span className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">
                          {!inv.isActive ? "Revoked" : expired ? "Expired" : "Exhausted"}
                        </span>
                      )}
                    </div>

                    {/* Token URL (truncated) */}
                    <p className="truncate max-w-xs font-mono text-[11px] text-white/30">
                      /register?token={inv.token.slice(0, 16)}…
                    </p>

                    <div className="flex flex-wrap gap-4 text-[11px] text-white/40">
                      <span>
                        Expires: <span className={expired ? "text-red-400" : "text-white/60"}>{formatExpiry(inv.expiresAt)}</span>
                      </span>
                      <span>
                        Uses: <span className="text-white/60">{inv.usedCount} / {inv.maxUses}</span>
                      </span>
                      <span>
                        Created: <span className="text-white/60">{formatExpiry(inv.createdAt)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => copyLink(inv)}
                      disabled={dead}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-medium text-white/70 transition hover:text-white disabled:pointer-events-none disabled:opacity-40"
                    >
                      {copiedId === inv.id ? (
                        <>
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                          Copy Link
                        </>
                      )}
                    </button>

                    {inv.isActive && !dead && (
                      <button
                        onClick={() => handleRevoke(inv.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-300 transition hover:bg-red-500/20"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                        </svg>
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Examiners panel ─────────────────────────────────────────────────────────

function ExaminersPanel() {
  const { user: currentUser } = useAuthStore();
  const [examiners, setExaminers] = useState<ExaminerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/invites/examiners")
      .then(({ data }) => setExaminers(data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggleSuperAdmin(id: string) {
    setToggling(id);
    try {
      const { data } = await api.patch(`/invites/users/${id}/super-admin`);
      setExaminers((prev) =>
        prev.map((e) => (e.id === id ? { ...e, isSuperAdmin: data.data.isSuperAdmin } : e))
      );
    } catch (err: any) {
      alert(err.response?.data?.error?.message || "Failed to update");
    } finally {
      setToggling(null);
    }
  }

  return (
    <section className="glow-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Examiners &amp; Admins</h2>
        <p className="mt-0.5 text-xs text-white/40">
          Grant or revoke Super Admin privileges for examiners.
        </p>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-white/40">Loading…</div>
      ) : examiners.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-white/30">
          No examiners found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs font-medium uppercase tracking-wider text-white/40">
                <th className="pb-3 pr-4">Name</th>
                <th className="pb-3 pr-4">Email</th>
                <th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4 text-center">Super Admin</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {examiners.map((ex) => {
                const isSelf = ex.id === currentUser?.id;
                return (
                  <tr key={ex.id} className="text-white/70">
                    <td className="py-3 pr-4 font-medium text-white">
                      {ex.firstName} {ex.lastName}
                      {isSelf && (
                        <span className="ml-2 rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">
                          You
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-white/50">{ex.email}</td>
                    <td className="py-3 pr-4">
                      <RoleBadge role={ex.role} />
                    </td>
                    <td className="py-3 pr-4 text-center">
                      {ex.isSuperAdmin ? (
                        <span className="inline-flex items-center gap-1 text-amber-300 text-xs font-semibold">
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          Yes
                        </span>
                      ) : (
                        <span className="text-white/25 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {!isSelf && (
                        <button
                          onClick={() => toggleSuperAdmin(ex.id)}
                          disabled={toggling === ex.id}
                          className={`h-8 rounded-lg border px-3 text-xs font-medium transition-all disabled:opacity-50 ${
                            ex.isSuperAdmin
                              ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                              : "border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                          }`}
                        >
                          {toggling === ex.id
                            ? "…"
                            : ex.isSuperAdmin
                            ? "Revoke Super Admin"
                            : "Grant Super Admin"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
