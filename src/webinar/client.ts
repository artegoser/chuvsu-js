import { AuthError } from "../common/types.js";
import { WebinarDdp, type WebinarDocument } from "./ddp.js";
import { webinarEvents } from "./events.js";
import { record, string } from "./parse.js";
import { browserWebinarSocket } from "./socket.js";
import { buildWebinarSnapshot, normalizeWebinarMessage } from "./state.js";
import {
  WebinarPermissionError, WebinarProtocolError,
  type WebinarClientOptions, type WebinarEvent, type WebinarSession,
} from "./types.js";

/** Live participant state and explicit actions; never auto-connects media. */
export class WebinarClient {
  private ddp: WebinarDdp;
  private session: WebinarSession;
  private history = new Map<string, WebinarDocument>();
  private listeners = new Set<(event: WebinarEvent) => void>();
  private ready = false;
  private started = false;

  constructor(session: WebinarSession, opts: WebinarClientOptions = {}) {
    if (session.protocol !== "ddp" || !/^2\.3(?:\.|$)/u.test(session.server.version)) {
      throw new WebinarProtocolError("Unsupported webinar participant protocol");
    }
    this.session = structuredClone(session);
    this.ddp = new WebinarDdp(opts.socketFactory ?? browserWebinarSocket, opts.timeout);
    this.ddp.onChange((collection, id, removed) => {
      this.emit({ type: "change", collection });
      if (collection === "group-chat-msg" && !removed) {
        const doc = this.ddp.documents(collection).find((message) => message._id === id);
        if (doc) this.emit({ type: "message", message: normalizeWebinarMessage(doc,
          [...this.ddp.documents("users"), ...this.ddp.documents("users-persistent-data")]) });
      }
    });
    this.ddp.onDisconnect(() => { this.ready = false; this.emit({ type: "disconnected" }); });
    this.ddp.onError((error) => this.emit({ type: "error", error }));
  }

  async connect(): Promise<void> {
    if (this.started) throw new WebinarProtocolError("Create a new client to reconnect");
    this.started = true;
    try {
      await this.ddp.connect(this.session.connections.state);
      await this.ddp.call("validateAuthToken", [this.session.meeting.id, this.session.user.id,
        this.session.authToken, this.session.externalUserId]);
      await this.ddp.subscribe("auth-token-validation", [{ meetingId: this.session.meeting.id, userId: this.session.user.id }]);
      const validation = await this.ddp.waitFor("auth-token-validation", (doc) =>
        doc.userId === this.session.user.id && (doc.validationStatus === 3 || doc.validationStatus === 4));
      if (validation.validationStatus !== 3) throw new AuthError("Webinar participant authentication rejected");
      await Promise.all([
        "current-user", "users", "users-persistent-data", "meetings", "voiceUsers",
        "presentations", "slides", "slide-positions", "presentation-pods", "video-streams", "screenshare", "note", "group-chat",
      ].map((name) => this.ddp.subscribe(name)));
      const chatIds = this.ddp.documents("group-chat").map((chat) => string(chat.chatId));
      await this.ddp.subscribe("group-chat-msg", [chatIds]);
      this.ready = true;
      if (this.session.features.chat) await this.loadMessages();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private assertConnected(): void {
    if (!this.ready) throw new WebinarProtocolError("Webinar is disconnected");
  }

  getSnapshot() {
    this.assertConnected();
    return buildWebinarSnapshot(this.ddp, this.session, this.history);
  }

  getUsers() { return this.getSnapshot().users; }
  getPresenter() { return this.getUsers().find((user) => user.presenter) ?? null; }
  getModerators() { return this.getUsers().filter((user) => user.moderator); }
  getChats() { return this.getSnapshot().chats; }
  getMessages(opts?: { chatId?: string }) {
    const chatId = opts?.chatId ?? this.session.publicChatId;
    return this.getSnapshot().messages.filter((message) => message.chatId === chatId);
  }
  getPresentations() { return this.getSnapshot().presentations; }
  getCurrentPresentation() { return this.getPresentations().find((presentation) => presentation.current) ?? null; }
  getMediaStreams() { return this.getSnapshot().streams; }
  getNotes() { return this.getSnapshot().notes; }

  /** Reads historical pages; live messages arrive through events(). */
  async loadMessages(opts: { chatId?: string; page?: number } = {}) {
    this.assertConnected();
    const chatId = opts.chatId ?? this.session.publicChatId;
    if (!this.getChats().some((chat) => chat.id === chatId)) throw new WebinarPermissionError("Chat is not accessible");
    const page = opts.page ?? 1;
    if (!Number.isInteger(page) || page < 1) throw new RangeError("Chat page must be a positive integer");
    const result = await this.ddp.call("fetchMessagePerPage", [chatId, page]);
    if (!Array.isArray(result)) throw new WebinarProtocolError("Invalid webinar chat history");
    const docs = result.map(record);
    for (const doc of docs) if (doc.chatId === chatId) this.history.set(string(doc.id) || string(doc._id), doc);
    this.emit({ type: "change", collection: "group-chat-msg" });
    return docs.filter((doc) => doc.chatId === chatId).map((doc) => normalizeWebinarMessage(doc,
      [...this.ddp.documents("users"), ...this.ddp.documents("users-persistent-data")]));
  }

  subscribe(listener: (event: WebinarEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  events(opts?: { signal?: AbortSignal; bufferSize?: number }) {
    return webinarEvents((listener) => this.subscribe(listener), opts);
  }

  private emit(event: WebinarEvent): void {
    for (const listener of this.listeners) {
      // A UI listener must not corrupt or disconnect the network transport.
      try { listener(event); } catch { /* Listener errors belong to the caller. */ }
    }
  }

  private assertPermission(feature: keyof WebinarSession["features"], lock?: string): void {
    this.assertConnected();
    if (!this.session.features[feature]) throw new WebinarPermissionError(`Webinar feature disabled: ${feature}`);
    const user = this.getUsers().find((user) => user.id === this.session.user.id);
    const meeting = this.ddp.documents("meetings")[0];
    if (lock && user?.locked && !user.moderator && record(meeting?.lockSettingsProps)[lock] === true) {
      throw new WebinarPermissionError(`Webinar permission locked: ${feature}`);
    }
  }

  async setRaisedHand(raised: boolean): Promise<void> {
    if (typeof raised !== "boolean") throw new TypeError("Raised hand must be boolean");
    this.assertPermission("raiseHand");
    await this.ddp.call("setEmojiStatus", [this.session.user.id, raised ? "raiseHand" : "none"]);
  }

  async sendMessage(opts: { text: string; chatId?: string }): Promise<void> {
    const chatId = opts.chatId ?? this.session.publicChatId;
    const chat = this.getChats().find((chat) => chat.id === chatId);
    if (!chat) throw new WebinarPermissionError("Chat is not accessible");
    this.assertPermission("chat", chat.private ? "disablePrivateChat" : "disablePublicChat");
    const text = opts.text.trim();
    if (!text || text.length > this.session.maxMessageLength) throw new RangeError("Invalid webinar message length");
    await this.ddp.call("sendGroupChatMsg", [chatId, {
      color: string(this.ddp.documents("users").find((user) => user.userId === this.session.user.id)?.color) || "0",
      correlationId: `${this.session.user.id}-${Date.now()}`,
      sender: { id: this.session.user.id, name: this.session.user.name }, message: text,
    }]);
  }

  async openPrivateChat(opts: { userId: string }) {
    this.assertPermission("chat", "disablePrivateChat");
    if (opts.userId === this.session.user.id) throw new RangeError("Invalid private chat recipient");
    const existing = this.getChats().find((chat) => chat.private && chat.userIds.includes(opts.userId));
    if (existing) return existing;
    const user = this.getUsers().find((user) => user.id === opts.userId);
    if (!user) throw new RangeError("Invalid private chat recipient");
    await this.ddp.call("createGroupChat", [{ userId: user.id, name: user.name }]);
    await this.ddp.waitFor("group-chat", (chat) => chat.access === "PRIVATE_ACCESS"
      && Array.isArray(chat.users) && chat.users.includes(user.id) && chat.users.includes(this.session.user.id));
    const chat = this.getChats().find((chat) => chat.private && chat.userIds.includes(user.id))!;
    await this.ddp.subscribe("group-chat-msg", [this.getChats().map((chat) => chat.id)]);
    return chat;
  }

  async sendPrivateMessage(opts: { userId: string; text: string }): Promise<void> {
    if (!opts.text.trim() || opts.text.trim().length > this.session.maxMessageLength) throw new RangeError("Invalid webinar message length");
    const chat = await this.openPrivateChat(opts);
    await this.sendMessage({ chatId: chat.id, text: opts.text });
  }

  async setMuted(muted: boolean): Promise<void> {
    if (typeof muted !== "boolean") throw new TypeError("Muted state must be boolean");
    this.assertConnected();
    const user = this.getUsers().find((user) => user.id === this.session.user.id);
    if (!user?.audio.joined || user.audio.listenOnly) throw new WebinarPermissionError("Microphone audio is not connected");
    await this.ddp.call("muteToggle", [this.session.user.id, muted]);
  }

  /** Closes local transport; does not issue userLeftMeeting or alter other users. */
  close(): void {
    this.ready = false;
    this.ddp.close();
    this.history.clear();
  }
}
