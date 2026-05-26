"use client";

import { useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";

interface AntiCheatConfig {
  sessionId: string;
  enabled: boolean;
}

interface FlagCounts {
  tab_switch: number;
  paste: number;
  blur: number;
  usb: number;
}

/**
 * Browser anti-cheat detection that reports live signals through the
 * websocket so the Live Session monitor can render them in real time.
 *
 * Flag types we emit (must match Prisma's FlagType enum on the server):
 *   TAB_SWITCH    – student switched tab / minimised (visibilitychange).
 *                   metadata.seconds = how long they were away.
 *   WINDOW_BLUR   – browser window lost focus while the tab itself stayed
 *                   visible (e.g. minimise, alt-tab to another app).
 *   PASTE_EVENT   – student pasted content into the exam.
 *   USB_DETECTED  – any USB / HID / media-device change detected.
 *                   metadata.source identifies which API fired.
 * MULTI_DEVICE is detected SERVER-SIDE (socket presence), not here.
 */
export function useAntiCheat({ sessionId, enabled }: AntiCheatConfig) {
  const flagCountRef = useRef<FlagCounts>({ tab_switch: 0, paste: 0, blur: 0, usb: 0 });

  const reportFlag = useCallback(
    (flagType: string, metadata?: Record<string, unknown>) => {
      const socket = getSocket();
      socket.emit("flag:report", { sessionId, flagType, metadata });
    },
    [sessionId],
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;

    /* ── Announce presence so server can detect multi-device login ── */
    const socket = getSocket();
    socket.emit("presence:join", { sessionId });

    /* ── 1 & 2. UNIFIED TIME-AWAY TRACKER ─────────────────────────
     *
     * Single "isAway" guard prevents duplicate counting when multiple
     * events fire at the same time (e.g. visibilitychange + blur both fire
     * when the student switches to another app on some browsers).
     *
     * Flow:
     *   departure  → markAway()   — sets isAway=true, records timestamp
     *   return     → markReturn() — calculates elapsed seconds, emits flag
     *
     * visibilitychange (hidden/visible) handles tab switches.
     * window blur/focus handles window minimize / alt-tab to another app.
     * Both call the same helpers; the isAway flag ensures only one
     * departure is counted per physical "leave" event.
     * ──────────────────────────────────────────────────────────── */
    let isAway = false;
    let awayStart: number | null = null;
    // "tab" = visibilitychange triggered; "blur" = window.blur triggered
    let awaySource: "tab" | "blur" = "tab";

    function markAway(source: "tab" | "blur") {
      if (isAway) return;          // already counting — ignore duplicate event
      isAway = true;
      awayStart = Date.now();
      awaySource = source;
    }

    function markReturn() {
      if (!isAway) return;         // not currently away — spurious focus/show event
      const seconds =
        awayStart !== null
          ? Math.max(1, Math.round((Date.now() - awayStart) / 1000))
          : 1;
      isAway = false;
      awayStart = null;
      flagCountRef.current.tab_switch++;
      reportFlag("TAB_SWITCH", {
        count: flagCountRef.current.tab_switch,
        seconds,
        source: awaySource,          // "tab" or "blur" for server-side analysis
        returned_at: new Date().toISOString(),
      });
    }

    // document.visibilitychange — fires when the tab is hidden/shown
    // (switching tabs, opening a new tab, phone lock screen, etc.)
    function onVisibilityChange() {
      if (document.hidden) {
        markAway("tab");
      } else {
        markReturn();
      }
    }

    // window.blur — fires when the WINDOW loses focus while the tab itself
    // may still be "visible" (minimize, alt-tab to another app).
    // We emit a WINDOW_BLUR flag ONLY when visibilitychange has NOT already
    // started the away timer (i.e. !isAway at the moment blur fires).
    // Then we always call markAway so the time is still accumulated.
    function onWindowBlur() {
      if (!isAway) {
        flagCountRef.current.blur++;
        reportFlag("WINDOW_BLUR", {
          count: flagCountRef.current.blur,
          reason: "window_lost_focus",
        });
      }
      markAway("blur");   // no-op if visibilitychange already set isAway=true
    }

    // window.focus — fires when the window regains focus (un-minimize, click back)
    function onWindowFocus() {
      markReturn();        // no-op if visibilitychange already cleared isAway
    }

    /* ── 3. PASTE ─────────────────────────────────────────────── */
    function onPaste(e: ClipboardEvent) {
      e.preventDefault();
      flagCountRef.current.paste++;
      const pasted = e.clipboardData?.getData("text") ?? "";
      reportFlag("PASTE_EVENT", {
        count: flagCountRef.current.paste,
        length: pasted.length,
      });
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    /* ── 4. USB / HID DEVICE DETECTION ────────────────────────────
     *
     * Logic:
     *   1. At exam start, enumerate and store the BASELINE device list.
     *   2. On every subsequent check, compare against that baseline.
     *   3. Only flag devices that are NEW (not in the baseline).
     *   4. Track already-reported devices so the same plug-in is never
     *      counted twice (no duplicates even if the event fires several
     *      times for one physical connection).
     *   5. Use event-driven `devicechange` where available; fall back to
     *      polling every 8 seconds on older browsers.
     *   6. WebUSB `connect` events also go through the same guard.
     *
     * Each flag carries a structured event log:
     *   { event, timestamp, device_name, device_id, device_type, count }
     * ────────────────────────────────────────────────────────────── */

    interface UsbDeviceInfo {
      device_id: string;
      device_name: string;
      device_type: string;
    }

    // Set of device IDs present when the exam session started (safe, ignored)
    const baselineIds = new Set<string>();
    // Set of device IDs we have already emitted a flag for (no duplicates)
    const reportedIds = new Set<string>();

    // References kept for cleanup
    let deviceChangeFn: (() => Promise<void>) | null = null;
    let usbPollTimer: ReturnType<typeof setInterval> | null = null;

    async function enumerateDevices(): Promise<UsbDeviceInfo[]> {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        return devs.map((d) => ({
          device_id: d.deviceId || `${d.kind}-${d.label || "unknown"}`,
          device_name: d.label || `${d.kind} device`,
          device_type: d.kind,  // "audioinput" | "audiooutput" | "videoinput"
        }));
      } catch {
        return [];
      }
    }

    // Compares `current` list against baseline+reported; emits a flag for
    // every genuinely new device that has never been reported before.
    function processDevices(current: UsbDeviceInfo[]) {
      for (const device of current) {
        if (baselineIds.has(device.device_id)) continue; // existed at exam start
        if (reportedIds.has(device.device_id)) continue; // already flagged
        reportedIds.add(device.device_id);
        flagCountRef.current.usb++;
        reportFlag("USB_DETECTED", {
          event: "USB_DEVICE_DETECTED",
          timestamp: new Date().toISOString(),
          device_name: device.device_name,
          device_id: device.device_id,
          device_type: device.device_type,
          count: flagCountRef.current.usb,
        });
      }
    }

    // Async initialisation: capture baseline, then start monitoring
    (async () => {
      const initial = await enumerateDevices();
      initial.forEach((d) => baselineIds.add(d.device_id));

      async function checkDevices() {
        const current = await enumerateDevices();
        processDevices(current);
      }

      deviceChangeFn = checkDevices;

      if (navigator.mediaDevices?.addEventListener) {
        // Event-driven path — fires as soon as a device is plugged in/out
        navigator.mediaDevices.addEventListener("devicechange", checkDevices);
      } else {
        // Fallback: low-frequency polling (no heavy background loop)
        usbPollTimer = setInterval(checkDevices, 8_000);
      }
    })();

    // 4b. WebUSB — catches USB peripherals that have been granted permission
    //     (many lab/exam USB devices use WebUSB). Only NEW connections are
    //     flagged; the initial getDevices() scan is intentionally skipped
    //     so that devices already plugged in before the exam are not flagged.
    const usbApi = (navigator as Navigator & { usb?: USB }).usb;
    function onUsbConnect(event: Event) {
      const device = (event as USBConnectionEvent).device;
      const id = `webusb-${device?.vendorId ?? 0}-${device?.productId ?? 0}`;
      if (reportedIds.has(id)) return;
      reportedIds.add(id);
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        event: "USB_DEVICE_DETECTED",
        timestamp: new Date().toISOString(),
        device_name: device?.productName || "USB Device",
        device_id: id,
        device_type: "webusb",
        manufacturer: device?.manufacturerName,
        count: flagCountRef.current.usb,
      });
    }
    if (usbApi) {
      usbApi.addEventListener("connect", onUsbConnect);
    }

    // 4c. WebHID — keyboards, barcode scanners, custom HID peripherals
    type WebHIDEventTarget = EventTarget & {
      addEventListener(type: "connect" | "disconnect", listener: (ev: Event) => void): void;
      removeEventListener(type: "connect" | "disconnect", listener: (ev: Event) => void): void;
    };
    const hidApi = (navigator as unknown as { hid?: WebHIDEventTarget }).hid;
    function onHidConnect(ev: Event) {
      const d = (ev as unknown as { device?: { productId?: number; vendorId?: number; productName?: string } }).device;
      const id = `webhid-${d?.vendorId ?? 0}-${d?.productId ?? 0}`;
      if (reportedIds.has(id)) return;
      reportedIds.add(id);
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        event: "USB_DEVICE_DETECTED",
        timestamp: new Date().toISOString(),
        device_name: d?.productName || "HID Device",
        device_id: id,
        device_type: "webhid",
        count: flagCountRef.current.usb,
      });
    }
    if (hidApi) {
      hidApi.addEventListener("connect", onHidConnect);
    }

    // 4d. Gamepads (USB game controllers)
    function onGamepadConnected(e: GamepadEvent) {
      const id = `gamepad-${e.gamepad?.id || "unknown"}`;
      if (reportedIds.has(id)) return;
      reportedIds.add(id);
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        event: "USB_DEVICE_DETECTED",
        timestamp: new Date().toISOString(),
        device_name: e.gamepad?.id || "Gamepad",
        device_id: id,
        device_type: "gamepad",
        count: flagCountRef.current.usb,
      });
    }
    window.addEventListener("gamepadconnected", onGamepadConnected);

    /* ── Mount listeners ──────────────────────────────────────── */
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);

    /* ── Cleanup ──────────────────────────────────────────────── */
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("gamepadconnected", onGamepadConnected);

      // Stop USB monitoring
      if (deviceChangeFn) {
        navigator.mediaDevices?.removeEventListener?.("devicechange", deviceChangeFn);
      }
      if (usbPollTimer) clearInterval(usbPollTimer);

      if (usbApi) {
        usbApi.removeEventListener("connect", onUsbConnect);
      }
      if (hidApi) {
        hidApi.removeEventListener("connect", onHidConnect);
      }

      // Tell the server we've gone — needed for clean multi-device tracking
      try { socket.emit("presence:leave", { sessionId }); } catch { /* noop */ }
    };
  }, [enabled, sessionId, reportFlag]);

  return { flagCount: flagCountRef.current };
}
