"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";

interface Student {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  studentId: string | null;
  program: string | null;
  gender: string | null;
  isActive: boolean;
}

function Badge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Edit modal
  const [editing, setEditing] = useState<Student | null>(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", studentId: "", program: "", gender: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState("");

  // Reset password modal
  const [resetting, setResetting] = useState<Student | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");

  useEffect(() => {
    api.get("/students").then(({ data }) => {
      setStudents(data.data);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = students.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.firstName.toLowerCase().includes(q) ||
      s.lastName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      (s.studentId ?? "").toLowerCase().includes(q) ||
      (s.program ?? "").toLowerCase().includes(q)
    );
  });

  function openEdit(s: Student) {
    setEditing(s);
    setEditForm({
      firstName: s.firstName,
      lastName: s.lastName,
      studentId: s.studentId ?? "",
      program: s.program ?? "",
      gender: s.gender ?? "",
    });
    setEditError("");
    setEditSuccess("");
  }

  async function saveEdit() {
    if (!editing) return;
    setEditLoading(true);
    setEditError("");
    setEditSuccess("");
    try {
      const { data } = await api.patch(`/students/${editing.id}`, editForm);
      setStudents((prev) => prev.map((s) => (s.id === editing.id ? { ...s, ...data.data } : s)));
      setEditSuccess("Student details updated.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setEditError(msg || "Failed to update student.");
    } finally {
      setEditLoading(false);
    }
  }

  async function toggleStatus(s: Student) {
    try {
      const { data } = await api.patch(`/students/${s.id}/toggle-status`);
      setStudents((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: data.data.isActive } : x)));
    } catch { /* ignore */ }
  }

  function openReset(s: Student) {
    setResetting(s);
    setNewPassword("");
    setResetError("");
    setResetSuccess("");
  }

  async function doReset() {
    if (!resetting) return;
    setResetLoading(true);
    setResetError("");
    setResetSuccess("");
    try {
      await api.post(`/students/${resetting.id}/reset-password`, { newPassword });
      setResetSuccess("Password reset successfully. The student can now sign in with the new password.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setResetError(msg || "Failed to reset password.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0d0d1a] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Students</h1>
            <p className="text-sm text-white/50">{students.length} registered student{students.length !== 1 ? "s" : ""}</p>
          </div>
          <input
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-indigo-400/60 focus:outline-none sm:w-72"
            placeholder="Search by name, email or student ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
          {loading ? (
            <div className="p-12 text-center text-sm text-white/40">Loading students…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-white/40">No students found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Student ID</th>
                  <th className="px-4 py-3">Program</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{s.firstName} {s.lastName}</td>
                    <td className="px-4 py-3 text-white/60">{s.email}</td>
                    <td className="px-4 py-3">
                      {s.studentId ? (
                        <span className="font-mono text-white/80">{s.studentId}</span>
                      ) : (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                          Not set — cannot self-reset password
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/60">{s.program ?? "—"}</td>
                    <td className="px-4 py-3"><Badge active={s.isActive} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(s)}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70 transition hover:bg-white/10"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => openReset(s)}
                          className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                        >
                          Reset Password
                        </button>
                        <button
                          onClick={() => toggleStatus(s)}
                          className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${s.isActive ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}
                        >
                          {s.isActive ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#13131f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-white">Edit Student — {editing.firstName} {editing.lastName}</h2>

            {editError && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{editError}</div>}
            {editSuccess && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{editSuccess}</div>}

            <div className="space-y-3">
              {(["firstName", "lastName", "studentId", "program"] as const).map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    {field === "studentId" ? "Student ID" : field.replace(/([A-Z])/g, " $1")}
                    {field === "studentId" && <span className="ml-2 normal-case text-amber-400">← required for password self-reset</span>}
                  </label>
                  <input
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-indigo-400/60 focus:outline-none"
                    value={editForm[field]}
                    onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })}
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">Gender</label>
                <select
                  className="w-full rounded-lg border border-white/10 bg-[#13131f] px-3 py-2 text-sm text-white focus:border-indigo-400/60 focus:outline-none"
                  value={editForm.gender}
                  onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}
                >
                  <option value="">— not specified —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 hover:bg-white/10">Cancel</button>
              <button onClick={saveEdit} disabled={editLoading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
                {editLoading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setResetting(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#13131f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold text-white">Reset Password</h2>
            <p className="mb-4 text-sm text-white/50">{resetting.firstName} {resetting.lastName} · {resetting.email}</p>

            {resetError && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{resetError}</div>}
            {resetSuccess && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{resetSuccess}</div>}

            {!resetSuccess && (
              <>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40">New Password (min 6 chars)</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-indigo-400/60 focus:outline-none"
                  placeholder="e.g. student123"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => setResetting(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 hover:bg-white/10">Cancel</button>
                  <button onClick={doReset} disabled={resetLoading || newPassword.length < 6} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
                    {resetLoading ? "Resetting…" : "Reset Password"}
                  </button>
                </div>
              </>
            )}
            {resetSuccess && (
              <button onClick={() => setResetting(null)} className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Done</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
