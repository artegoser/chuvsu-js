import type { WebinarSocketFactory } from "./types.js";

export interface WebinarMediaOptions {
  socketFactory?: WebinarSocketFactory;
  peerFactory?: (config: RTCConfiguration) => RTCPeerConnection;
  timeout?: number;
}

export type WebinarPlaybackKind = "audio" | "camera" | "screen";

export interface WebinarReceiveOptions {
  signal?: AbortSignal;
}
