import type { WebinarSocket, WebinarSocketFactory } from "./types.js";

export const browserWebinarSocket: WebinarSocketFactory = (url) => new WebSocket(url);

export async function openWebinarSocket(
  socket: WebinarSocket,
  timeout: number,
): Promise<void> {
  if (socket.readyState === 1) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Webinar WebSocket connection timed out"));
      socket.close();
    }, timeout);
    const fail = () => {
      clearTimeout(timer);
      reject(new Error("Webinar WebSocket connection failed"));
    };
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); });
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
  });
}
