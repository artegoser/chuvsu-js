/** Participant credentials. Pass only to the authenticated student's browser. */
export interface WebinarSession {
  server: { origin: string; version: string; build: number | null };
  protocol: "ddp";
  mediaBackend: "kurento";
  sessionToken: string;
  authToken: string;
  externalUserId: string;
  user: { id: string; name: string; role: string };
  meeting: { id: string; name: string; voiceBridge: string };
  connections: { state: string; media: string };
  iceServers: RTCIceServer[];
  features: {
    chat: boolean;
    notes: boolean;
    audio: boolean;
    video: boolean;
    screen: boolean;
    raiseHand: boolean;
    presentationDownload: boolean;
  };
  notesUrl: string | null;
  publicChatId: string;
  chatPageSize: number;
  maxMessageLength: number;
}

export interface WebinarUser {
  id: string;
  name: string;
  role: string;
  presenter: boolean;
  moderator: boolean;
  locked: boolean;
  raisedHand: boolean;
  emoji: string;
  audio: { joined: boolean; listenOnly: boolean; muted: boolean; speaking: boolean };
}

export interface WebinarChat {
  id: string;
  name: string;
  private: boolean;
  userIds: string[];
}

export interface WebinarMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string | null;
  timestamp: number;
  /** Plain text: render as text, never as HTML. */
  text: string;
}

export interface WebinarSlide {
  id: string;
  presentationId: string;
  number: number;
  current: boolean;
  svgUrl: string | null;
  thumbnailUrl: string | null;
  textUrl: string | null;
  text: string;
  viewport: { x: number; y: number; width: number; height: number } | null;
}

export interface WebinarPresentation {
  id: string;
  name: string;
  current: boolean;
  downloadable: boolean;
  slides: WebinarSlide[];
}

export interface WebinarMediaStream {
  id: string;
  kind: "camera" | "screen";
  userId: string | null;
  hasAudio: boolean;
}

export interface WebinarNotes {
  revision: number;
  readUrl: string | null;
  editUrl: string | null;
}

export interface WebinarSnapshot {
  users: WebinarUser[];
  chats: WebinarChat[];
  messages: WebinarMessage[];
  presentations: WebinarPresentation[];
  streams: WebinarMediaStream[];
  notes: WebinarNotes | null;
  ended: boolean;
}

export type WebinarEvent =
  | { type: "change"; collection: string }
  | { type: "message"; message: WebinarMessage }
  | { type: "disconnected" }
  | { type: "error"; error: Error };

/** Minimal native/Undici WebSocket contract, shared by both runtimes. */
export interface WebinarSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export type WebinarSocketFactory = (url: string) => WebinarSocket;

export interface WebinarClientOptions {
  socketFactory?: WebinarSocketFactory;
  timeout?: number;
}

export class WebinarProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebinarProtocolError";
  }
}

export class WebinarPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebinarPermissionError";
  }
}
