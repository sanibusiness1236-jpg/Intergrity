const { Server } = require("socket.io");
const { setupExamSession } = require("./examSession");
const { setupMonitoring } = require("./monitoring");
const { corsOrigin, redisUrl } = require("../config/env");
const { verifyAccessToken } = require("../utils/jwt");

let io;

/**
 * Attach the Redis adapter so Socket.IO state (rooms, broadcasts) is shared
 * across multiple backend instances. This is what makes horizontal scaling
 * possible — without it, students connected to instance A never reach an
 * examiner connected to instance B. Entirely non-fatal: if Redis is not
 * configured/reachable we log a warning and run single-instance in-memory.
 */
async function attachRedisAdapter(ioInstance) {
  try {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const Redis = require("ioredis");
    const opts = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 1000, 3000)),
    };
    const pubClient = new Redis(redisUrl, opts);
    const subClient = pubClient.duplicate();
    pubClient.on("error", () => {});
    subClient.on("error", () => {});
    await Promise.all([pubClient.connect(), subClient.connect()]);
    ioInstance.adapter(createAdapter(pubClient, subClient));
    console.log("[Socket.IO] Redis adapter attached — multi-instance scaling enabled");
  } catch (err) {
    console.warn(`[Socket.IO] Redis adapter not attached (${err.message}). Running single-instance.`);
  }
}

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: corsOrigin, methods: ["GET", "POST"], credentials: true },
  });

  attachRedisAdapter(io);

  // Soft authentication: verify the JWT from the handshake (if provided) and
  // attach the user to the socket so privileged events can check identity.
  // We deliberately do NOT reject unauthenticated/expired sockets here: a
  // short access-token expiry mid-exam must never sever a student's live
  // connection (which would silently disable auto-save and anti-cheat). The
  // client sends a fresh token on every (re)connection.
  io.use((socket, next) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (token) {
        const decoded = verifyAccessToken(token);
        socket.data.user = { id: decoded.id, role: decoded.role };
      }
    } catch {
      // Invalid/expired token — leave socket.data.user undefined.
    }
    next();
  });

  io.on("connection", (socket) => {
    setupExamSession(io, socket);
    setupMonitoring(io, socket);
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.IO not initialised");
  return io;
}

module.exports = { initSocket, getIO };
