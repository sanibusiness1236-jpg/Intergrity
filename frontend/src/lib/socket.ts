import { io, Socket } from "socket.io-client";
import { getAccessToken } from "./api";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket", "polling"],
      // `auth` as a function is re-evaluated on every (re)connection, so the
      // server always receives the freshest access token — important across
      // token refreshes during a long exam.
      auth: (cb) => cb({ token: getAccessToken() || "" }),
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect();
  }
}
