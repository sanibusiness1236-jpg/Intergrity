/**
 * useOnlineStatus — real-time online/offline/syncing detection.
 *
 * Combines:
 *   • navigator.onLine (initial state)
 *   • window.online / window.offline events
 *   • syncQueue status subscription (adds "syncing" state)
 *
 * Returns one of:  "online" | "offline" | "syncing"
 */

"use client";

import { useEffect, useState } from "react";
import { onSyncStatus, SyncStatus } from "@/lib/syncQueue";

export type OnlineState = "online" | "offline" | "syncing";

export function useOnlineStatus(): OnlineState {
  const [state, setState] = useState<OnlineState>(() => {
    if (typeof window === "undefined") return "online";
    return navigator.onLine ? "online" : "offline";
  });

  useEffect(() => {
    const handleOnline  = () => setState("online");
    const handleOffline = () => setState("offline");

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    // Subscribe to the syncQueue for more granular "syncing" feedback
    const unsub = onSyncStatus((status: SyncStatus) => {
      setState(status.kind === "syncing" ? "syncing" : status.kind === "offline" ? "offline" : "online");
    });

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsub();
    };
  }, []);

  return state;
}
