"use client";

/**
 * OfflineIndicator — floating status pill shown during exam sessions.
 *
 * Displays one of three states:
 *   ● Online          — green pill, visible for 3 s after reconnect then fades
 *   ● Offline         — amber pill, stays visible
 *   ● Syncing...      — indigo pill with spinner, visible while flushing queue
 */

import { useEffect, useRef, useState } from "react";
import { useOnlineStatus }              from "@/hooks/useOnlineStatus";

export function OfflineIndicator() {
  const status  = useOnlineStatus();
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === "offline" || status === "syncing") {
      // Always show when offline or syncing
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
    } else {
      // Online: show briefly then auto-hide
      setVisible(true);
      hideTimer.current = setTimeout(() => setVisible(false), 3_500);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [status]);

  if (!visible) return null;

  const configs = {
    online: {
      bg:   "bg-emerald-500/90",
      ring: "ring-emerald-400/30",
      text: "Online",
      dot:  "bg-emerald-300",
      spin: false,
    },
    offline: {
      bg:   "bg-amber-500/90",
      ring: "ring-amber-400/30",
      text: "Offline – answers saved locally",
      dot:  "bg-amber-300",
      spin: false,
    },
    syncing: {
      bg:   "bg-indigo-500/90",
      ring: "ring-indigo-400/30",
      text: "Syncing...",
      dot:  "bg-indigo-300",
      spin: true,
    },
  };

  const cfg = configs[status];

  return (
    <div
      className={`
        fixed bottom-5 right-5 z-[9999]
        flex items-center gap-2
        px-3.5 py-2 rounded-full
        text-white text-xs font-semibold
        shadow-lg ring-1
        transition-all duration-500
        ${cfg.bg} ${cfg.ring}
      `}
      role="status"
      aria-live="polite"
    >
      {cfg.spin ? (
        <span className="w-2.5 h-2.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      ) : (
        <span className={`w-2 h-2 rounded-full ${cfg.dot} animate-pulse`} />
      )}
      {cfg.text}
    </div>
  );
}
