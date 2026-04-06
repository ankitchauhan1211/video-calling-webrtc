import { io } from "socket.io-client";

/**
 * Must match your Socket.IO server (Express + socket.io on port 8080).
 * Override in production: NEXT_PUBLIC_SIGNALING_URL=https://your-host:8080
 */
export const SIGNALING_URL ="https://signaling-server-zyb9.onrender.com";
  // process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:8080";

/** Single shared client — same instance as used in FirstPage. */
export const socket = io(SIGNALING_URL, {
  transports: ["websocket", "polling"],
});
