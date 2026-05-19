"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";
import { AuthShell } from "@/components/auth/AuthShell";
import { GlowInput } from "@/components/auth/GlowInput";

const ROLES = [
  { value: "STUDENT", label: "Student" },
  { value: "EXAMINER", label: "Examiner" },
  { value: "INVIGILATOR", label: "Invigilator" },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register, isLoading } = useAuthStore();
  const [form, setForm] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "STUDENT",
    studentId: "",
    program: "",
    gender: "",
  });
  const [error, setError] = useState("");

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const user = await register(form);
      const target =
        user?.role === "STUDENT" ? "/student" :
        user?.role === "INVIGILATOR" ? "/invigilator" :
        "/examiner";
      router.replace(target);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || "Registration failed");
    }
  }

  return (
    <AuthShell
      heroTitle="Join the next generation of secure exams."
      heroSubtitle="Sign up to start writing, supervising, or administering exams with real-time AI-powered integrity protection."
      heroPoints={[
        "Three portals: examiner, student, invigilator",
        "Auto-save & seamless session recovery",
        "Beautiful analytics & grade scaling",
      ]}
    >
      <form onSubmit={handleSubmit} className="grid max-h-[80vh] gap-4 overflow-y-auto pr-1">
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Create account</h1>
          <p className="text-sm text-white/60">Get started in less than a minute</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
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

        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-white/70">I am a...</label>
          <div className="grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                type="button"
                key={r.value}
                onClick={() => update("role", r.value)}
                className={`h-10 rounded-lg border text-xs font-medium transition-all ${
                  form.role === r.value
                    ? "border-white/40 bg-white/15 text-white shadow-lg shadow-indigo-500/20"
                    : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white/90"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {form.role === "STUDENT" && (
          <div className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-white/50">Student details</p>
            <div className="grid grid-cols-2 gap-3">
              <GlowInput
                placeholder="Student ID"
                value={form.studentId}
                onChange={(e) => update("studentId", e.target.value)}
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
          className="auth-shimmer-btn group relative mt-2 inline-flex h-12 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-6 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="relative z-10">{isLoading ? "Creating account..." : "Create Account"}</span>
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
