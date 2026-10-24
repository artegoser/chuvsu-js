import type { WebinarSocketFactory } from "./types.js";

export interface WebinarMediaOptions {
  /** Inject a compatible receive stream in runtimes without a global MediaStream. */
  streamFactory?: () => MediaStream;
  socketFactory?: WebinarSocketFactory;
  peerFactory?: (config: RTCConfiguration) => RTCPeerConnection;
  timeout?: number;
}

export type WebinarPlaybackKind = "audio" | "camera" | "screen";

export interface WebinarReceiveOptions {
  signal?: AbortSignal;
}
