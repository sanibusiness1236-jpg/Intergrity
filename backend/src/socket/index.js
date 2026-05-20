const { Server } = require("socket.io");
const { setupExamSession } = require("./examSession");
const { setupMonitoring } = require("./monitoring");
const { corsOrigin } = require("../config/env");

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: corsOrigin, methods: ["GET", "POST"], credentials: true },
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    setupExamSession(io, socket);
    setupMonitoring(io, socket);

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.IO not initialised");
  return io;
}

module.exports = { initSocket, getIO };
