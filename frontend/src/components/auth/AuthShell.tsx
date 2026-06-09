"use client";

import * as React from "react";
import { useEffect, useState } from "react";

interface AuthShellProps {
  children: React.ReactNode;
  heroTitle?: string;
  heroSubtitle?: string;
  heroPoints?: string[];
}

const BG_VIDEO_SRC =
  "https://cdn.pixabay.com/video/2023/10/03/183086-870459409_large.mp4";

export function AuthShell({
  children,
  heroTitle = "Examinations, secured by AI.",
  heroSubtitle = "INTEGRITY uses graph neural networks to surface cheating patterns no human invigilator could catch in real-time.",
  heroPoints = [
    "Vanilla GCN, H2GCN, FAGCN & GraphSAGE",
    "Tab, paste, USB & multi-device detection",
    "Per-venue risk scoring in real-time",
  ],
}: AuthShellProps) {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);
  const [videoOk, setVideoOk] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setMouse({ x: 300, y: 300 }), 100);
    return () => clearTimeout(t);
  }, []);

  function handleMouseMove(e: React.MouseEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <main className="relative flex min-h-screen items-start justify-center overflow-x-hidden overflow-y-auto bg-slate-950 p-3 py-6 sm:p-6 sm:py-10">
      {videoOk && (
        <video
          autoPlay
          muted
          loop
          playsInline
          onError={() => setVideoOk(false)}
          className="pointer-events-none fixed inset-0 z-0 h-full w-full object-cover opacity-30 blur-2xl"
          style={{ filter: "blur(28px) saturate(140%)" }}
        >
          <source src={BG_VIDEO_SRC} type="video/mp4" />
        </video>
      )}

      <div className="pointer-events-none fixed inset-0 z-[1]">
        <div className="auth-blob absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-indigo-500/40 via-purple-500/30 to-pink-500/20 blur-3xl" />
        <div className="auth-blob-delayed absolute -bottom-32 -right-32 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-cyan-500/30 via-blue-500/30 to-indigo-500/30 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-950/20 to-slate-950/60" />
      </div>

      <div className="relative z-10 flex w-full max-w-5xl overflow-hidden rounded-2xl auth-card sm:rounded-3xl my-auto">
        <section
          className="relative flex w-full flex-col justify-center px-5 py-8 sm:px-8 sm:py-10 md:px-12 lg:w-1/2"
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <div
            className={`pointer-events-none absolute h-[420px] w-[420px] rounded-full bg-gradient-to-r from-purple-400/25 via-blue-400/25 to-pink-400/25 blur-3xl transition-opacity duration-300 ${
              hovering ? "opacity-100" : "opacity-0"
            }`}
            style={{
              transform: `translate(${mouse.x - 210}px, ${mouse.y - 210}px)`,
              transition: "transform 0.12s ease-out, opacity 0.3s",
            }}
          />
          <div className="relative z-10">{children}</div>
        </section>

        <aside className="relative hidden w-1/2 overflow-hidden border-l border-white/10 lg:block">
          {videoOk && (
            <video
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover opacity-60"
            >
              <source src={BG_VIDEO_SRC} type="video/mp4" />
            </video>
          )}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/80 via-slate-900/70 to-purple-900/80" />
          <div className="relative z-10 flex h-full flex-col justify-between p-10">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="text-lg font-bold tracking-wider text-white">INTEGRITY</span>
            </div>

            <div className="space-y-6">
              <h2 className="text-3xl font-bold leading-tight text-white md:text-4xl">{heroTitle}</h2>
              <p className="text-sm leading-relaxed text-white/70">{heroSubtitle}</p>
              <ul className="space-y-2.5">
                {heroPoints.map((p) => (
                  <li key={p} className="flex items-center gap-2.5 text-sm text-white/80">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10">
                      <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-xs text-white/40">
              &copy; {new Date().getFullYear()} INTEGRITY Exam Platform
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
