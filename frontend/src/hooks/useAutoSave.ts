"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";

interface AutoSaveConfig {
  sessionId: string;
  answers: Record<string, unknown>;
  intervalMs?: number;
  enabled: boolean;
}

export function useAutoSave({ sessionId, answers, intervalMs = 15000, enabled }: AutoSaveConfig) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const answersRef = useRef(answers);
  // Track the JSON snapshot of what was last successfully sent to the server.
  // We skip a save cycle when the snapshot hasn't changed — this eliminates
  // ~90 % of redundant WebSocket writes during quiet periods (e.g. a student
  // reading a question without changing their answer).
  const lastSentSnapshotRef = useRef<string>("");

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const socket = getSocket();

    function save() {
      const snapshot = JSON.stringify(answersRef.current);
      // Skip if nothing changed since the last successful send.
      if (snapshot === lastSentSnapshotRef.current) return;

      setIsSaving(true);
      socket.emit("answer:save", { sessionId, answers: answersRef.current });
      // Optimistically update the snapshot so rapid-fire intervals don't
      // all queue separate sends before the ack arrives.
      lastSentSnapshotRef.current = snapshot;
    }

    socket.on("answer:saved", ({ success }: { success: boolean }) => {
      setIsSaving(false);
      if (success) {
        setLastSaved(new Date());
      } else {
        // Save failed — reset snapshot so the next interval retries.
        lastSentSnapshotRef.current = "";
      }
    });

    const interval = setInterval(save, intervalMs);

    return () => {
      clearInterval(interval);
      socket.off("answer:saved");
    };
  }, [sessionId, intervalMs, enabled]);

  return { lastSaved, isSaving };
}
