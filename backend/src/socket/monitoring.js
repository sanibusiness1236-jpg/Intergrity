const prisma = require("../config/db");

/**
 * In-memory presence map:
 *   studentId  ->  Map<socketId, { sessionId, examId, joinedAt, userAgent, ip }>
 *
 * When a student already has one active socket and a NEW one joins,
 * we record a MULTI_DEVICE behavioral flag against BOTH session ids
 * (the existing one, so the original session is also flagged, and the
 * new one). The flag is rate-limited to one entry per session every
 * 60 s to avoid flooding the table when a flaky network causes a
 * student's own browser to reconnect repeatedly.
 */
const presenceByStudent = new Map(); // studentId -> Map<socketId, info>
const recentMultiDeviceAt = new Map(); // sessionId -> timestamp

const MULTI_DEVICE_COOLDOWN_MS = 60_000;

async function recordMultiDeviceFlag(io, sessionId, studentId, extraMeta = {}) {
  const last = recentMultiDeviceAt.get(sessionId) || 0;
  if (Date.now() - last < MULTI_DEVICE_COOLDOWN_MS) return;
  recentMultiDeviceAt.set(sessionId, Date.now());

  try {
    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const flag = await prisma.behavioralFlag.create({
      data: {
        sessionId,
        studentId,
        flagType: "MULTI_DEVICE",
        metadata: { ...extraMeta, detected_at: new Date().toISOString() },
      },
    });

    io.to(`exam:${session.examId}`).emit("flag:new", {
      sessionId,
      studentId,
      flagType: "MULTI_DEVICE",
      metadata: flag.metadata,
      createdAt: flag.createdAt,
    });
  } catch (err) {
    console.error("MULTI_DEVICE flag persist error:", err.message);
  }
}

function setupMonitoring(io, socket) {
  // ── 1. Behavioral flag from the client ──────────────────────────
  socket.on("flag:report", async ({ sessionId, flagType, metadata }) => {
    try {
      const session = await prisma.examSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) return;

      const flag = await prisma.behavioralFlag.create({
        data: {
          sessionId,
          studentId: session.studentId,
          flagType,
          metadata,
        },
      });

      io.to(`exam:${session.examId}`).emit("flag:new", {
        sessionId,
        studentId: session.studentId,
        flagType,
        metadata,
        createdAt: flag.createdAt,
      });
    } catch (err) {
      console.error("Flag report error:", err.message);
    }
  });

  // ── 2. Examiner subscribes to live monitor ──────────────────────
  socket.on("join:monitor", ({ examId }) => {
    socket.join(`exam:${examId}`);
  });

  // ── 3. Student announces presence (multi-device detection) ──────
  socket.on("presence:join", async ({ sessionId }) => {
    try {
      const session = await prisma.examSession.findUnique({
        where: { id: sessionId },
        select: { id: true, studentId: true, examId: true },
      });
      if (!session) return;

      const ua = socket.handshake?.headers?.["user-agent"] || "";
      const ip =
        socket.handshake?.headers?.["x-forwarded-for"] ||
        socket.handshake?.address ||
        "";

      socket.data.presence = {
        studentId: session.studentId,
        sessionId,
        examId: session.examId,
      };

      let bucket = presenceByStudent.get(session.studentId);
      if (!bucket) {
        bucket = new Map();
        presenceByStudent.set(session.studentId, bucket);
      }
      bucket.set(socket.id, { sessionId, examId: session.examId, joinedAt: Date.now(), ua, ip });

      // If THIS student now has more than one live connection → flag
      if (bucket.size > 1) {
        // Flag every active session belonging to that student so the
        // examiner sees the alert against the exam they're monitoring.
        const sessionIds = new Set();
        bucket.forEach((info) => sessionIds.add(info.sessionId));
        for (const sid of sessionIds) {
          await recordMultiDeviceFlag(io, sid, session.studentId, {
            simultaneous_connections: bucket.size,
            most_recent_ip: ip,
            most_recent_ua: ua,
          });
        }
      }
    } catch (err) {
      console.error("presence:join error:", err.message);
    }
  });

  // ── 4. Explicit leave from the client (cleanest) ───────────────
  socket.on("presence:leave", ({ sessionId }) => {
    const info = socket.data?.presence;
    if (!info) return;
    const bucket = presenceByStudent.get(info.studentId);
    if (bucket) {
      bucket.delete(socket.id);
      if (bucket.size === 0) presenceByStudent.delete(info.studentId);
    }
    delete socket.data.presence;
  });

  // ── 5. Implicit cleanup on disconnect ───────────────────────────
  socket.on("disconnect", () => {
    const info = socket.data?.presence;
    if (!info) return;
    const bucket = presenceByStudent.get(info.studentId);
    if (bucket) {
      bucket.delete(socket.id);
      if (bucket.size === 0) presenceByStudent.delete(info.studentId);
    }
  });
}

module.exports = { setupMonitoring };
