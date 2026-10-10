import type { WebinarClient } from "./client.js";
import { WebinarPlayback } from "./playback.js";
import { browserWebinarSocket } from "./socket.js";
import { WebinarPermissionError, WebinarProtocolError, type WebinarSession } from "./types.js";
import type { WebinarMediaOptions, WebinarPlaybackKind, WebinarReceiveOptions } from "./media-types.js";

/** Browser media stays direct; the state client supplies permitted stream IDs. */
export class WebinarMediaClient {
  private session: WebinarSession;
  private playbacks = new Set<WebinarPlayback>();
  private closed = false;
  private timeout: number;

  constructor(
    session: WebinarSession,
    private room: WebinarClient,
    private opts: WebinarMediaOptions = {},
  ) {
    if (session.mediaBackend !== "kurento" || !/^2\.3(?:\.|$)/u.test(session.server.version)) {
      throw new WebinarProtocolError("Unsupported webinar media backend");
    }
    this.session = structuredClone(session);
    this.timeout = opts.timeout ?? 20_000;
    if (!Number.isFinite(this.timeout) || this.timeout <= 0) throw new RangeError("Invalid webinar media timeout");
  }

  async listen(opts?: WebinarReceiveOptions): Promise<WebinarPlayback> {
    if (!this.session.features.audio) throw new WebinarPermissionError("Listen-only audio is disabled");
    return this.receive("audio", opts);
  }

  async receiveCamera(opts: { streamId: string } & WebinarReceiveOptions): Promise<WebinarPlayback> {
    if (!this.session.features.video) throw new WebinarPermissionError("Camera playback is disabled");
    const stream = this.room.getMediaStreams().find((stream) => stream.kind === "camera" && stream.id === opts.streamId);
    if (!stream) throw new WebinarPermissionError("Camera stream is not published to this participant");
    return this.receive("camera", opts, stream.id);
  }

  async receiveScreen(opts: WebinarReceiveOptions = {}): Promise<WebinarPlayback> {
    if (!this.session.features.screen) throw new WebinarPermissionError("Screen playback is disabled");
    const stream = this.room.getMediaStreams().find((stream) => stream.kind === "screen");
    if (!stream) throw new WebinarPermissionError("No screen is being shared");
    return this.receive("screen", opts, stream.id, stream.hasAudio);
  }

  private async receive(kind: WebinarPlaybackKind, opts?: WebinarReceiveOptions, streamId?: string, hasAudio = false): Promise<WebinarPlayback> {
    if (this.closed) throw new WebinarProtocolError("Webinar media client closed");
    if (this.room.getSnapshot().ended) throw new WebinarProtocolError("Webinar has ended");
    const socket = (this.opts.socketFactory ?? browserWebinarSocket)(this.session.connections.media);
    let playback: WebinarPlayback;
    try { playback = new WebinarPlayback(this.session, kind, socket, this.opts, streamId, hasAudio); }
    catch (error) { socket.close(); throw error; }
    this.playbacks.add(playback);
    playback.onClose(() => { this.playbacks.delete(playback); });
    try { await playback.connect(this.timeout, opts); return playback; }
    catch (error) { this.playbacks.delete(playback); playback.close(); throw error; }
  }

  close(): void {
    this.closed = true;
    for (const playback of this.playbacks) playback.close();
    this.playbacks.clear();
  }
}
