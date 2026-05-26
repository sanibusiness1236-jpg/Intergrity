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

    /* ── 1. TAB SWITCH (with duration in seconds) ─────────────── */
    let hiddenAt: number | null = null;

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        const seconds = Math.max(1, Math.round((Date.now() - hiddenAt) / 1000));
        hiddenAt = null;
        flagCountRef.current.tab_switch++;
        reportFlag("TAB_SWITCH", {
          count: flagCountRef.current.tab_switch,
          seconds,
          returned_at: new Date().toISOString(),
        });
      }
    }

    /* ── 2. WINDOW MINIMIZE / ALT-TAB ─────────────────────────── */
    // window.blur fires even while the tab is still "visible" (e.g. alt-tab
    // to another app or minimise). We only report if the tab is NOT hidden
    // (otherwise visibilitychange already handles it).
    function onWindowBlur() {
      if (document.hidden) return;        // already covered by TAB_SWITCH
      flagCountRef.current.blur++;
      reportFlag("WINDOW_BLUR", {
        count: flagCountRef.current.blur,
        reason: "window_lost_focus",
      });
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

    /* ── 4. USB / HID / DEVICE CHANGES ────────────────────────── */
    // We aggregate signals from several browser APIs. The single
    // `flagUsb` helper rate-limits to one emit per 2 seconds so that a
    // single device plug-in (which often fires 3-4 events) does not
    // explode the counter.
    let lastUsbAt = 0;
    function flagUsb(source: string, extra: Record<string, unknown> = {}) {
      const now = Date.now();
      if (now - lastUsbAt < 2000) return;
      lastUsbAt = now;
      flagCountRef.current.usb++;
      reportFlag("USB_DETECTED", {
        source,
        count: flagCountRef.current.usb,
        ...extra,
      });
    }

    // 4a. mediaDevices.devicechange — fires when ANY audio/video device
    //     is added/removed. Covers most USB headsets / cameras / mics
    //     and some USB-C docking stations.
    let lastDeviceCount = -1;
    async function onDeviceChange() {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const count = devs.length;
        if (lastDeviceCount >= 0 && count !== lastDeviceCount) {
          flagUsb("mediaDevices", {
            previous: lastDeviceCount,
            current: count,
            delta: count - lastDeviceCount,
          });
        }
        lastDeviceCount = count;
      } catch {
        flagUsb("mediaDevices", { error: "enumerate_failed" });
      }
    }
    // Establish baseline (and request the permission-free list so the
    // browser will fire devicechange afterwards).
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then((d) => { lastDeviceCount = d.length; })
        .catch(() => {});
      navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    }

    // 4b. WebUSB — only fires for previously-authorised devices but it
    //     does work for many engineering / lab USB peripherals.
    const usbApi = (navigator as Navigator & { usb?: USB }).usb;
    function onUsbConnect(event: Event) {
      const device = (event as USBConnectionEvent).device;
      flagUsb("webusb", {
        action: "connect",
        productName: device?.productName,
        manufacturerName: device?.manufacturerName,
      });
    }
    function onUsbDisconnect(event: Event) {
      const device = (event as USBConnectionEvent).device;
      flagUsb("webusb", { action: "disconnect", productName: device?.productName });
    }
    if (usbApi) {
      usbApi.addEventListener("connect", onUsbConnect);
      usbApi.addEventListener("disconnect", onUsbDisconnect);
      usbApi.getDevices().then((devices) => {
        if (devices.length > 0) {
          flagUsb("webusb", {
            action: "initial_scan",
            deviceCount: devices.length,
          });
        }
      }).catch(() => {});
    }

    // 4c. WebHID — keyboards / barcode scanners / custom HID devices
    type WebHIDEventTarget = EventTarget & {
      addEventListener(type: "connect" | "disconnect", listener: (ev: Event) => void): void;
      removeEventListener(type: "connect" | "disconnect", listener: (ev: Event) => void): void;
    };
    const hidApi = (navigator as unknown as { hid?: WebHIDEventTarget }).hid;
    function onHidConnect(ev: Event) {
      const productName =
        (ev as unknown as { device?: { productName?: string } }).device?.productName;
      flagUsb("webhid", { action: "connect", productName });
    }
    function onHidDisconnect(ev: Event) {
      const productName =
        (ev as unknown as { device?: { productName?: string } }).device?.productName;
      flagUsb("webhid", { action: "disconnect", productName });
    }
    if (hidApi) {
      hidApi.addEventListener("connect", onHidConnect);
      hidApi.addEventListener("disconnect", onHidDisconnect);
    }

    // 4d. Gamepads (USB game controllers register here too)
    function onGamepadConnected(e: GamepadEvent) {
      flagUsb("gamepad", { id: e.gamepad?.id });
    }
    window.addEventListener("gamepadconnected", onGamepadConnected);

    /* ── Mount listeners ──────────────────────────────────────── */
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);

    /* ── Cleanup ──────────────────────────────────────────────── */
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("gamepadconnected", onGamepadConnected);

      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);

      if (usbApi) {
        usbApi.removeEventListener("connect", onUsbConnect);
        usbApi.removeEventListener("disconnect", onUsbDisconnect);
      }
      if (hidApi) {
        hidApi.removeEventListener("connect", onHidConnect);
        hidApi.removeEventListener("disconnect", onHidDisconnect);
      }

      // Tell the server we've gone — needed for clean multi-device tracking
      try { socket.emit("presence:leave", { sessionId }); } catch { /* noop */ }
    };
  }, [enabled, sessionId, reportFlag]);

  return { flagCount: flagCountRef.current };
}
