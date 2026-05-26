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
     * Root problem: browsers only expose device labels and unique IDs
     * AFTER the user grants camera/microphone permission.  Without
     * permission all deviceId values are "" (empty string), making
     * ID-based comparison useless.
     *
     * Solution: COUNT-BASED comparison.
     *   1. At exam start, record the total number of connected media
     *      devices as the baseline count (works without any permission).
     *   2. On every `devicechange` event (or polling tick), re-enumerate
     *      and compare TOTAL count vs the last known count.
     *   3. If count INCREASES → one or more devices were just plugged in
     *      → emit a USB_DETECTED flag.
     *   4. prevCount is updated on every check so that each physical
     *      plug-in is counted exactly once (even if the student unplugs
     *      and re-plugs a different device).
     *   5. Event-driven first; 8-second polling fallback for older browsers.
     * ────────────────────────────────────────────────────────────── */

    // -1 = not yet initialised; set to baseline count after first enumerate
    let prevDeviceCount = -1;

    // References kept so we can remove them in cleanup
    let deviceChangeFn: (() => Promise<void>) | null = null;
    let usbPollTimer: ReturnType<typeof setInterval> | null = null;

    // Returns per-kind breakdown + total so we can log something useful
    async function getDeviceSnapshot(): Promise<{ total: number; kinds: Record<string, number> }> {
      if (!navigator.mediaDevices?.enumerateDevices) return { total: 0, kinds: {} };
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const kinds: Record<string, number> = {};
        for (const d of devs) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
        return { total: devs.length, kinds };
      } catch {
        return { total: 0, kinds: {} };
      }
    }

    // Called on every devicechange event or polling tick.
    // Emits one flag per newly detected insertion above prevCount.
    async function checkDeviceCount() {
      const { total, kinds } = await getDeviceSnapshot();

      if (prevDeviceCount >= 0 && total > prevDeviceCount) {
        // Determine which kind of device increased (best-effort)
        const kindLabel = Object.keys(kinds).find(
          (k) => (kinds[k] ?? 0) > 0 && k !== "_total"
        ) ?? "device";

        const newOnes = total - prevDeviceCount;
        for (let i = 0; i < newOnes; i++) {
          flagCountRef.current.usb++;
          reportFlag("USB_DETECTED", {
            event: "USB_DEVICE_DETECTED",
            timestamp: new Date().toISOString(),
            device_name: `New ${kindLabel} connected`,
            device_type: kindLabel,
            device_count_before: prevDeviceCount,
            device_count_after: total,
            count: flagCountRef.current.usb,
          });
        }
      }

      // Always advance prevCount so the next check compares against NOW
      prevDeviceCount = total;
    }

    // Async init: establish baseline then wire up event/poll
    (async () => {
      const { total } = await getDeviceSnapshot();
      prevDeviceCount = total; // baseline — devices present at exam start are safe

      deviceChangeFn = checkDeviceCount;

      if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener("devicechange", checkDeviceCount);
      } else {
        // Fallback polling — 8 s is low enough to be useful, high enough to be cheap
        usbPollTimer = setInterval(checkDeviceCount, 8_000);
      }
    })();

    // 4b. WebUSB — explicit connect event for any WebUSB-capable peripheral
    //     (does NOT fire for standard USB storage drives — those need OS-level APIs)
    const usbApi = (navigator as Navigator & { usb?: USB }).usb;
    function onUsbConnect(event: Event) {
      const device = (event as USBConnectionEvent).device;
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        event: "USB_DEVICE_DETECTED",
        timestamp: new Date().toISOString(),
        device_name: device?.productName || "USB Device",
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
      const d = (ev as unknown as { device?: { productName?: string } }).device;
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        event: "USB_DEVICE_DETECTED",
        timestamp: new Date().toISOString(),
        device_name: d?.productName || "HID Device",
        device_type: "webhid",
        count: flagCountRef.current.usb,
      });
    }
    if (hidApi) {
      hidApi.addEventListener("connect", onHidConnect);
    }

    // 4d. Gamepads (USB game controllers also register here)
    function onGamepadConnected(e: GamepadEvent) {
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        event: "USB_DEVICE_DETECTED",
        timestamp: new Date().toISOString(),
        device_name: e.gamepad?.id || "Gamepad",
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
