import { record, string } from "./parse.js";
import { openWebinarSocket } from "./socket.js";
import { webinarMediaMessages } from "./media-protocol.js";
import { WebinarProtocolError, type WebinarSession, type WebinarSocket } from "./types.js";
import type { WebinarMediaOptions, WebinarPlaybackKind, WebinarReceiveOptions } from "./media-types.js";

/** Direct browser-to-BBB receiver. Attach stream to an audio/video element. */
export class WebinarPlayback {
  readonly stream: MediaStream;
  readonly connection: RTCPeerConnection;
  private socket: WebinarSocket;
  private messages: ReturnType<typeof webinarMediaMessages>;
  private closed = false;
  private started = false;
  private answered = false;
  private localCandidates: RTCIceCandidateInit[] = [];
  private remoteCandidates: RTCIceCandidateInit[] = [];
  private pendingReceive = Promise.resolve();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private errorListeners = new Set<(error: Error) => void>();
  private closeListeners = new Set<() => void>();
  private connectionResolve: (() => void) | undefined;
  private connectionReject: ((error: Error) => void) | undefined;
  private abort: (() => void) | undefined;
  private signal: AbortSignal | undefined;

  constructor(
    session: WebinarSession,
    readonly kind: WebinarPlaybackKind,
    socket: WebinarSocket,
    opts: WebinarMediaOptions,
    streamId?: string,
    hasAudio = false,
  ) {
    this.socket = socket;
    this.messages = webinarMediaMessages(session, kind, streamId, hasAudio);
    this.stream = new MediaStream();
    this.connection = (opts.peerFactory ?? ((config) => new RTCPeerConnection(config)))({ iceServers: session.iceServers });
    if (kind !== "camera" && (kind === "audio" || hasAudio)) this.connection.addTransceiver("audio", { direction: "recvonly" });
    if (kind !== "audio") this.connection.addTransceiver("video", { direction: "recvonly" });
    this.connection.addEventListener("track", (event) => {
      if (!this.stream.getTracks().some((track) => track.id === event.track.id)) this.stream.addTrack(event.track);
    });
    this.connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate || this.closed) return;
      const candidate = event.candidate.toJSON();
      if (!this.answered) this.localCandidates.push(candidate);
      else this.send(this.messages.candidate(candidate));
    });
    this.connection.addEventListener("connectionstatechange", () => {
      if (this.connection.connectionState === "connected") this.connectionResolve?.();
      if (!this.closed && this.connection.connectionState === "failed") this.fail(new WebinarProtocolError("Webinar media connection failed"));
    });
    socket.addEventListener("message", (event) => {
      this.pendingReceive = this.pendingReceive.then(async () => {
        if (this.closed) return;
        if (typeof event.data !== "string") throw new WebinarProtocolError("Invalid media frame");
        await this.receive(record(JSON.parse(event.data)));
      }).catch(() => this.fail(new WebinarProtocolError("Webinar media negotiation failed")));
    });
    socket.addEventListener("close", () => {
      if (!this.closed) this.fail(new WebinarProtocolError("Webinar media signaling disconnected"));
    });
    socket.addEventListener("error", () => {
      if (!this.closed) this.fail(new WebinarProtocolError("Webinar media signaling failed"));
    });
  }

  async connect(timeout: number, opts: WebinarReceiveOptions = {}): Promise<void> {
    if (this.closed || this.started) throw new WebinarProtocolError("Playback already opened or closed");
    if (opts.signal?.aborted) { this.close(); throw new Error("Webinar playback aborted"); }
    this.signal = opts.signal;
    this.abort = () => this.fail(new Error("Webinar playback aborted"));
    this.signal?.addEventListener("abort", this.abort, { once: true });
    const connected = new Promise<void>((resolve, reject) => {
      this.connectionResolve = resolve;
      this.connectionReject = reject;
    });
    // Observe early failures while the WebSocket/offer is still opening.
    void connected.catch(() => {});
    const timer = setTimeout(() => this.fail(new WebinarProtocolError("Webinar media connection timed out")), timeout);
    try {
      await openWebinarSocket(this.socket, timeout);
      if (this.closed) throw new WebinarProtocolError("Webinar playback closed");
      const offer = await this.connection.createOffer();
      await this.connection.setLocalDescription(offer);
      if (this.closed) throw new WebinarProtocolError("Webinar playback closed");
      this.started = true;
      this.send(this.messages.start(offer.sdp ?? ""));
      this.pingTimer = setInterval(() => this.send({ id: "ping" }), 10_000);
      await connected;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      clearTimeout(timer);
      this.connectionResolve = undefined;
      this.connectionReject = undefined;
    }
  }

  private send(message: Record<string, unknown>): void {
    if (!this.closed && this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  private async receive(message: Record<string, unknown>): Promise<void> {
    if (message.id === "startResponse") {
      if (message.response !== "accepted" || !string(message.sdpAnswer)) throw new WebinarProtocolError("Webinar media offer rejected");
      await this.connection.setRemoteDescription({ type: "answer", sdp: string(message.sdpAnswer) });
      this.answered = true;
      for (const candidate of this.remoteCandidates.splice(0)) await this.connection.addIceCandidate(candidate);
      for (const candidate of this.localCandidates.splice(0)) this.send(this.messages.candidate(candidate));
    } else if (message.id === "iceCandidate") {
      const candidate = record(message.candidate) as RTCIceCandidateInit;
      if (!this.answered) this.remoteCandidates.push(candidate);
      else await this.connection.addIceCandidate(candidate);
    } else if (["error", "webRTCAudioError"].includes(string(message.id))) {
      throw new WebinarProtocolError("Webinar media rejected by server");
    } else if (["stopSharing", "playStop"].includes(string(message.id))) {
      this.close();
    }
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => { this.errorListeners.delete(listener); };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => { this.closeListeners.delete(listener); };
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.connectionReject?.(error);
    for (const listener of this.errorListeners) { try { listener(error); } catch { /* Caller owns listener errors. */ } }
    this.close();
  }

  getStats(): Promise<RTCStatsReport> { return this.connection.getStats(); }

  close(): void {
    if (this.closed) return;
    if (this.started && this.kind === "camera") this.send(this.messages.stop());
    this.closed = true;
    this.connectionReject?.(new WebinarProtocolError("Webinar playback closed"));
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.abort) this.signal?.removeEventListener("abort", this.abort);
    this.socket.close();
    this.connection.close();
    for (const track of this.stream.getTracks()) track.stop();
    this.localCandidates.length = 0;
    this.remoteCandidates.length = 0;
    this.errorListeners.clear();
    for (const listener of this.closeListeners) { try { listener(); } catch { /* Caller owns listener errors. */ } }
    this.closeListeners.clear();
  }
}
