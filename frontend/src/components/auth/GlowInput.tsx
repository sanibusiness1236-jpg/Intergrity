"use client";

import * as React from "react";
import { useState } from "react";

interface GlowInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
  containerClassName?: string;
}

export function GlowInput({ label, icon, containerClassName, className, ...rest }: GlowInputProps) {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);

  function handleMouseMove(e: React.MouseEvent<HTMLInputElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div className={`w-full min-w-0 ${containerClassName ?? ""}`}>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-white/70">{label}</label>
      )}
      <div className="relative w-full">
        <input
          {...rest}
          className={`auth-input peer relative z-10 h-12 w-full rounded-lg px-4 text-sm font-light drop-shadow-sm transition-all duration-200 ease-in-out ${
            icon ? "pr-11" : ""
          } ${className ?? ""}`}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        />
        {hovering && (
          <>
            <div
              className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-[2px] overflow-hidden rounded-t-lg"
              style={{
                background: `radial-gradient(36px circle at ${mouse.x}px 0px, rgba(255,255,255,0.95) 0%, transparent 70%)`,
              }}
            />
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-[2px] overflow-hidden rounded-b-lg"
              style={{
                background: `radial-gradient(36px circle at ${mouse.x}px 2px, rgba(255,255,255,0.95) 0%, transparent 70%)`,
              }}
            />
          </>
        )}
        {icon && (
          <div className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2 text-white/50">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
