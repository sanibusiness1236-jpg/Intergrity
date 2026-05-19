"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";

interface Institution {
  id: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  motto?: string;
  website?: string;
  contactEmail?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, "") || "http://localhost:5000";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

interface Toast { id: string; type: "success" | "error"; message: string }

export default function BrandingPage() {
  const [inst, setInst] = useState<Institution | null>(null);
  const [form, setForm] = useState<Partial<Institution>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pushToast(type: Toast["type"], message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  async function loadInstitution() {
    try {
      const { data } = await api.get("/institutions/me");
      setInst(data.data);
      setForm(data.data);
    } catch {
      pushToast("error", "Failed to load institution");
    }
  }

  useEffect(() => { loadInstitution(); }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!inst) return;
    setIsSaving(true);
    try {
      const { data } = await api.put(`/institutions/${inst.id}`, form);
      setInst(data.data);
      pushToast("success", "Branding saved");
    } catch (err: any) {
      pushToast("error", err.response?.data?.error?.message || "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!inst || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    if (file.size > 2 * 1024 * 1024) {
      pushToast("error", "Logo must be under 2MB");
      return;
    }
    const fd = new FormData();
    fd.append("logo", file);
    setIsUploading(true);
    try {
      const { data } = await api.post(`/institutions/${inst.id}/logo`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setInst(data.data);
      setForm(data.data);
      pushToast("success", "Logo uploaded");
    } catch (err: any) {
      pushToast("error", err.response?.data?.error?.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!inst) {
    return (
      <DashboardShell>
        <div className="flex h-[60vh] items-center justify-center text-sm text-white/50">
          Loading institution…
        </div>
      </DashboardShell>
    );
  }

  const logoSrc = inst.logoUrl?.startsWith("http") ? inst.logoUrl : `${API_BASE}${inst.logoUrl}`;
  const primaryColor = form.primaryColor || "#6366f1";
  const accentColor = form.accentColor || "#a855f7";

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <AnnouncementBadge tag="Identity" message="Customize how students see your institution" />
            <GradientHeading
              title="Institution Branding"
              highlight="Tailor your"
              subtitle="Update your institution's identity — name, logo, colors and contact details — and preview how it appears across the platform."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: Form */}
          <form onSubmit={handleSave} className="lg:col-span-2">
            <GlowCard title="Profile Details" description="Public information about your institution.">
              <div className="space-y-5">
                <Field label="Institution Name" required>
                  <input
                    className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                    value={form.name || ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </Field>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Short Name">
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.shortName || ""}
                      onChange={(e) => setForm({ ...form, shortName: e.target.value })}
                      placeholder="e.g. KNUST"
                    />
                  </Field>
                  <Field label="Website">
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.website || ""}
                      onChange={(e) => setForm({ ...form, website: e.target.value })}
                      placeholder="https://..."
                    />
                  </Field>
                </div>

                <Field label="Motto">
                  <input
                    className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                    value={form.motto || ""}
                    onChange={(e) => setForm({ ...form, motto: e.target.value })}
                    placeholder="e.g. Nyansapo wosane no badwemma"
                  />
                </Field>

                <Field label="Contact Email">
                  <input
                    type="email"
                    className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                    value={form.contactEmail || ""}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  />
                </Field>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <ColorField
                    label="Primary Color"
                    hint="Used for headers, buttons, key UI accents."
                    value={form.primaryColor || "#6366f1"}
                    onChange={(v) => setForm({ ...form, primaryColor: v })}
                  />
                  <ColorField
                    label="Accent Color"
                    hint="Used for highlights and gradients."
                    value={form.accentColor || "#a855f7"}
                    onChange={(v) => setForm({ ...form, accentColor: v })}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-4">
                  <button
                    type="button"
                    onClick={() => setForm(inst)}
                    className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
                  >
                    Discard
                  </button>
                  <GlowButton type="submit" size="sm" disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save changes"}
                  </GlowButton>
                </div>
              </div>
            </GlowCard>
          </form>

          {/* Right: Logo + Preview */}
          <div className="space-y-4">
            <GlowCard title="Logo" description="PNG / JPG / SVG up to 2MB.">
              <div className="space-y-4">
                <div className="flex h-44 items-center justify-center rounded-xl border-2 border-dashed border-white/15 bg-slate-950/30">
                  {inst.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoSrc} alt="Institution logo" className="max-h-40 max-w-full object-contain" />
                  ) : (
                    <div className="text-center">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40">
                        <Icon d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </div>
                      <p className="mt-2 text-xs text-white/40">No logo uploaded</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  <Icon d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  {isUploading ? "Uploading..." : inst.logoUrl ? "Replace Logo" : "Upload Logo"}
                </button>
              </div>
            </GlowCard>

            <GlowCard title="Header Preview" description="How your branding appears in portal headers.">
              <div
                className="overflow-hidden rounded-xl border border-white/10"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                }}
              >
                <div className="flex items-center gap-3 p-4">
                  {inst.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoSrc} alt="Logo preview" className="h-10 w-10 rounded-md bg-white/95 p-1 object-contain" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/20 text-white font-bold">
                      {(form.shortName || form.name || "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{form.name || "Institution Name"}</p>
                    {form.motto && <p className="truncate text-xs text-white/80">{form.motto}</p>}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-white/70">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: primaryColor }} />
                  {primaryColor}
                </span>
                <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-white/70">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: accentColor }} />
                  {accentColor}
                </span>
              </div>
            </GlowCard>
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

function ColorField({
  label, hint, value, onChange,
}: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">{label}</label>
      <div className="flex items-center gap-2">
        <label className="relative h-11 w-14 cursor-pointer overflow-hidden rounded-lg border border-white/10">
          <div className="absolute inset-0" style={{ background: value }} />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          className="auth-input h-11 flex-1 rounded-lg px-3 font-mono text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
        />
      </div>
      <p className="text-[11px] text-white/40">{hint}</p>
    </div>
  );
}
