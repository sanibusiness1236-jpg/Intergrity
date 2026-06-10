"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import { AuthShell } from "@/components/auth/AuthShell";
import { GlowInput } from "@/components/auth/GlowInput";
import api from "@/lib/api";

interface InviteInfo {
  role: string;
  expiresAt: string;
  singleUse: boolean;
  usesRemaining: number;
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "Student",
  EXAMINER: "Examiner",
  INVIGILATOR: "Invigilator",
};

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";
  const { register, isLoading } = useAuthStore();

  const [validating, setValidating] = useState(true);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [tokenError, setTokenError] = useState("");

  const [form, setForm] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    studentId: "",
    program: "",
    gender: "",
  });
  const [error, setError] = useState("");

  // Validate the invite token on load
  useEffect(() => {
    if (!token) {
      setTokenError("No invitation token found. Registration is by invitation only.");
      setValidating(false);
      return;
    }
    api
      .get(`/invites/validate/${token}`)
      .then(({ data }) => {
        setInviteInfo(data.data);
      })
      .catch((err) => {
        setTokenError(err.response?.data?.error?.message || "Invalid or expired invitation link.");
      })
      .finally(() => setValidating(false));
  }, [token]);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const user = await register({ ...form, inviteToken: token });
      const target =
        user?.role === "STUDENT" ? "/student" :
        user?.role === "INVIGILATOR" ? "/invigilator" :
        "/examiner";
      router.replace(target);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || "Registration failed");
    }
  }

  if (validating) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-white/60">
          <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <p className="text-sm">Validating invitation link…</p>
        </div>
      </AuthShell>
    );
  }

  if (tokenError) {
    return (
      <AuthShell>
        <div className="grid gap-6 py-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white">Invitation Required</h1>
            <p className="text-sm leading-relaxed text-white/60">{tokenError}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
            Registration is by invitation only. Please contact an Examiner to obtain a valid sign-up link.
          </div>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Back to Sign In
          </Link>
        </div>
      </AuthShell>
    );
  }

  const role = inviteInfo?.role ?? "";
  const isStudent = role === "STUDENT";

  return (
    <AuthShell
      heroTitle="You've been invited to join INTEGRITY."
      heroSubtitle="Complete your registration below to access your portal."
      heroPoints={[
        "Secure exam environment",
        "Real-time integrity monitoring",
        "Auto-save & seamless session recovery",
      ]}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Create account</h1>
          <p className="text-sm text-white/60">You&apos;re registering as a{" "}
            <span className="font-semibold text-indigo-300">{ROLE_LABELS[role] ?? role}</span>
          </p>
        </div>

        {/* Role badge — locked by the invitation */}
        <div className="flex items-center justify-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 p-2.5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0-1.1.9-2 2-2s2 .9 2 2v1M5 21h14a2 2 0 002-2v-5a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-indigo-200">
            Role locked by invitation: <strong>{ROLE_LABELS[role] ?? role}</strong>
          </span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <GlowInput
            placeholder="First name"
            value={form.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            required
          />
          <GlowInput
            placeholder="Last name"
            value={form.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            required
          />
        </div>

        <GlowInput
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          required
        />

        <GlowInput
          type="password"
          placeholder="Password (min 8 characters)"
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          minLength={8}
          required
        />

        {isStudent && (
          <div className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-white/50">Student details</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <GlowInput
                placeholder="Student ID (required)"
                value={form.studentId}
                onChange={(e) => update("studentId", e.target.value)}
                required
              />
              <GlowInput
                placeholder="Program"
                value={form.program}
                onChange={(e) => update("program", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs text-white/60">Gender</label>
              <select
                className="auth-input flex h-11 w-full rounded-lg px-3 text-sm"
                value={form.gender}
                onChange={(e) => update("gender", e.target.value)}
              >
                <option value="" className="bg-slate-900">Select</option>
                <option value="Male" className="bg-slate-900">Male</option>
                <option value="Female" className="bg-slate-900">Female</option>
                <option value="Other" className="bg-slate-900">Other</option>
              </select>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="auth-shimmer-btn group relative mt-2 flex h-12 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-6 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="relative z-10">{isLoading ? "Creating account…" : "Create Account"}</span>
        </button>

        <p className="text-center text-sm text-white/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-white underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
