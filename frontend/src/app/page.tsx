"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

function targetFor(role?: string) {
  switch (role) {
    case "EXAMINER":
    case "ADMIN":
      return "/examiner";
    case "STUDENT":
      return "/student";
    case "INVIGILATOR":
      return "/invigilator";
    default:
      return null;
  }
}

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user, fetchProfile } = useAuthStore();

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.replace("/login");
      return;
    }
    if (isAuthenticated && user) {
      const t = targetFor(user.role);
      if (t) router.replace(t);
      return;
    }
    let cancelled = false;
    fetchProfile().then(() => {
      if (cancelled) return;
      const fresh = useAuthStore.getState().user;
      const t = targetFor(fresh?.role);
      router.replace(t || "/login");
    });
    return () => { cancelled = true; };
  }, [isAuthenticated, user, fetchProfile, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        <h1 className="text-2xl font-bold text-white">INTEGRITY</h1>
        <p className="mt-2 text-sm text-white/50">Loading your portal…</p>
      </div>
    </main>
  );
}
