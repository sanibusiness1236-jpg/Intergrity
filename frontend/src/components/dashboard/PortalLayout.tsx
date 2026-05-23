"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";
import api, { getAccessToken, clearAuthTokens } from "@/lib/api";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface PortalLayoutProps {
  children: React.ReactNode;
  portalName: string;
  navItems: NavItem[];
  allowedRoles: string[];
}

interface InstitutionBrand {
  name?: string;
  shortName?: string;
  logoUrl?: string;
  primaryColor?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, "") || "http://localhost:5000";

const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export function PortalLayout({ children, portalName, navItems, allowedRoles }: PortalLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout, fetchProfile } = useAuthStore();
  const [brand, setBrand] = useState<InstitutionBrand | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.push("/login");
      return;
    }
    if (!isAuthenticated) fetchProfile();
  }, [isAuthenticated, fetchProfile, router]);

  useEffect(() => {
    if (isAuthenticated && user && !allowedRoles.includes(user.role)) {
      // Wrong role for this portal — clear stale session and bounce to login
      // with a friendly explanation. This avoids the infinite redirect loop
      // that happened when localStorage tokens were shared across tabs.
      clearAuthTokens();
      logout();
      router.replace("/login?reason=role-mismatch");
    }
  }, [isAuthenticated, user, router, allowedRoles, logout]);

  useEffect(() => {
    if (isAuthenticated) {
      api.get("/institutions/me").then((r) => setBrand(r.data.data)).catch(() => {});
    }
  }, [isAuthenticated]);

  const logoSrc = brand?.logoUrl?.startsWith("http") ? brand.logoUrl : brand?.logoUrl ? `${API_BASE}${brand.logoUrl}` : null;
  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}`.toUpperCase();
  const avatarUrl = (user as any)?.avatarUrl;

  return (
    <div className="flex min-h-screen dashboard-bg text-white">
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-white/5 bg-slate-950/80 backdrop-blur-xl transition-all duration-300",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <div className="border-b border-white/5 p-4">
          <Link href={navItems[0]?.href || "/"} className="flex items-center gap-3">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="Logo" className="h-9 w-9 shrink-0 rounded-lg object-contain ring-1 ring-white/10" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 ring-1 ring-white/20">
                <Svg d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" size={20} />
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{brand?.shortName || "INTEGRITY"}</p>
                <p className="truncate text-[10px] uppercase tracking-wider text-white/40">{portalName}</p>
              </div>
            )}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-white/10 text-white shadow-inner shadow-white/5"
                    : "text-white/55 hover:bg-white/5 hover:text-white",
                  collapsed && "justify-center",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-400 to-purple-500" />
                )}
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/5 p-3">
          {/* Clickable user block */}
          <button
            onClick={() => setShowProfile(true)}
            title="Edit profile"
            className={cn(
              "mb-3 flex w-full items-center gap-3 rounded-lg p-2 transition hover:bg-white/5",
              collapsed && "justify-center"
            )}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Avatar" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-indigo-400/40" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white">
                {initials || "?"}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-white">{user?.firstName} {user?.lastName}</p>
                <p className="truncate text-xs text-white/40">{user?.email}</p>
              </div>
            )}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="flex h-8 flex-1 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
              title={collapsed ? "Expand" : "Collapse"}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className={collapsed ? "rotate-180" : ""}>
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => { logout(); router.push("/login"); }}
              className="flex h-8 flex-1 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/60 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
              title="Sign out"
            >
              <Svg d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden p-6 md:p-10">{children}</main>

      {/* Profile modal */}
      {showProfile && (
        <ProfileModal
          user={user}
          onClose={() => setShowProfile(false)}
          onUpdate={fetchProfile}
        />
      )}
    </div>
  );
}

/* ============================================================ */
/* Profile Modal                                               */
/* ============================================================ */

function ProfileModal({
  user,
  onClose,
  onUpdate,
}: {
  user: any;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl || null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/users/me", { firstName, lastName });
      showToast("success", "Profile updated");
      onUpdate();
    } catch {
      showToast("error", "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const { data } = await api.post("/users/me/avatar", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAvatarPreview(data.data.avatarUrl);
      showToast("success", "Profile picture updated");
      onUpdate();
    } catch {
      showToast("error", "Failed to upload picture");
      setAvatarPreview(user?.avatarUrl || null);
    } finally {
      setUploadingAvatar(false);
    }
  }

  const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Edit Profile</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-white/40 hover:bg-white/5 hover:text-white">
            <Svg d="M18 6L6 18M6 6l12 12" />
          </button>
        </div>

        {/* Avatar */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative">
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarPreview}
                alt="Avatar"
                className="h-20 w-20 rounded-full object-cover ring-4 ring-indigo-400/30"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-bold text-white ring-4 ring-indigo-400/20">
                {initials || "?"}
              </div>
            )}
            {uploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                <svg className="h-6 w-6 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingAvatar}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            {uploadingAvatar ? "Uploading..." : "Change photo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">First Name</label>
              <input
                className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Last Name</label>
              <input
                className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Email</label>
            <input
              className="auth-input h-11 w-full rounded-lg px-3 text-sm opacity-50"
              value={user?.email || ""}
              disabled
              readOnly
            />
            <p className="text-[10px] text-white/30">Email cannot be changed.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Role</label>
            <div className="flex h-11 items-center rounded-lg border border-white/5 bg-white/[0.02] px-3 text-sm text-white/50">
              {user?.role}
            </div>
          </div>

          {toast && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${
              toast.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}>
              {toast.msg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-xs font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
