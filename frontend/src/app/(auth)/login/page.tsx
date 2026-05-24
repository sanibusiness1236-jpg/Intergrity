"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import { AuthShell } from "@/components/auth/AuthShell";
import { GlowInput } from "@/components/auth/GlowInput";

const EmailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams?.get("reason");
  const { login, isLoading } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const notice =
    reason === "role-mismatch"
      ? "Your session was changed in another tab. Please sign in again to continue."
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const user = await login(email, password);
      const target =
        user?.role === "STUDENT" ? "/student" :
        user?.role === "INVIGILATOR" ? "/invigilator" :
        "/examiner";
      router.replace(target);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || "Login failed");
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="grid gap-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Welcome back</h1>
          <p className="text-sm text-white/60">Sign in to your INTEGRITY account</p>
        </div>

        <div className="flex items-center justify-center gap-3">
          {[
            <svg key="g" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1H12.18v3.83h5.5c-.25 1.46-1.78 4.3-5.5 4.3c-3.31 0-6-2.74-6-6.13S8.87 6.97 12.18 6.97c1.88 0 3.13.8 3.85 1.48l2.63-2.53c-1.69-1.58-3.88-2.54-6.48-2.54C6.92 3.38 2.5 7.8 2.5 13.1s4.42 9.72 9.68 9.72c5.59 0 9.3-3.93 9.3-9.46c0-.63-.07-1.13-.13-1.26"/></svg>,
            <svg key="i" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 0 2.5a1.25 1.25 0 0 1 0-2.5M12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6a3 3 0 0 0 0-6"/></svg>,
            <svg key="m" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M6.94 5a2 2 0 1 1-4-.002a2 2 0 0 1 4 .002M7 8.48H3V21h4zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91z"/></svg>,
          ].map((icon, i) => (
            <button
              key={i}
              type="button"
              className="group relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/5 text-white/70 transition-all hover:scale-110 hover:border-white/30 hover:text-white"
              aria-label="SSO login (coming soon)"
            >
              <span className="absolute inset-0 origin-bottom scale-y-0 bg-gradient-to-t from-indigo-500/40 to-purple-500/40 transition-transform duration-500 group-hover:scale-y-100" />
              <span className="relative z-10">{icon}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs text-white/40">
          <div className="h-px flex-1 bg-white/10" />
          <span>or use your account</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {notice && !error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          <GlowInput
            type="email"
            placeholder="you@university.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            icon={<EmailIcon />}
          />
          <GlowInput
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            icon={<LockIcon />}
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-white/60 hover:text-white/80">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-indigo-500" />
            Remember me
          </label>
          <a href="#" className="text-white/60 transition-colors hover:text-white">
            Forgot password?
          </a>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="auth-shimmer-btn group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-6 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="relative z-10">{isLoading ? "Signing in..." : "Sign In"}</span>
        </button>

        <p className="text-center text-sm text-white/60">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-white underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
