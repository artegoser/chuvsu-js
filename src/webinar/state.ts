import { parseHtml, text } from "../common/parse.js";
import { record, safeWebinarUrl, string } from "./parse.js";
import type { WebinarDdp, WebinarDocument } from "./ddp.js";
import type {
  WebinarMessage, WebinarSession, WebinarSlide, WebinarSnapshot,
} from "./types.js";

export function normalizeWebinarMessage(doc: WebinarDocument, users: WebinarDocument[]): WebinarMessage {
  const senderId = string(doc.sender) || string(record(doc.sender).id);
  const sender = users.find((user) => user.userId === senderId);
  const html = string(doc.message).replace(/<br\s*\/?\s*>/giu, "\n");
  return {
    id: string(doc.id) || string(doc._id),
    chatId: string(doc.chatId),
    senderId,
    senderName: string(sender?.name) || string(record(doc.sender).name) || null,
    timestamp: typeof doc.timestamp === "number" ? doc.timestamp : 0,
    text: text(parseHtml(`<div id="message">${html}</div>`).querySelector("#message")),
  };
}

export function buildWebinarSnapshot(
  ddp: WebinarDdp,
  session: WebinarSession,
  history: Map<string, WebinarDocument>,
): WebinarSnapshot {
  const documents = (name: string) => ddp.documents(name);
  const users = documents("users");
  const persistent = documents("users-persistent-data");
  const voices = documents("voiceUsers");
  const positions = documents("slide-positions");
  const slides = documents("slides");
  const messages = new Map(history);
  for (const doc of documents("group-chat-msg")) messages.set(string(doc.id) || string(doc._id), doc);
  const presentations = documents("presentations");
  const meeting = documents("meetings").find((doc) => doc.meetingId === session.meeting.id);
  const origin = session.server.origin;
  const normalizeSlide = (doc: WebinarDocument, presentationId: string): WebinarSlide => {
    const position = positions.find((p) => p.id === doc.id);
    return {
      id: string(doc.id),
      presentationId,
      number: typeof doc.num === "number" ? doc.num : 0,
      current: doc.current === true,
      svgUrl: safeWebinarUrl(doc.svgUri, origin),
      thumbnailUrl: safeWebinarUrl(doc.thumbUri, origin),
      textUrl: safeWebinarUrl(doc.txtUri, origin),
      text: string(doc.content),
      viewport: position ? {
        x: Number(position.x) || 0, y: Number(position.y) || 0,
        width: Number(position.viewBoxWidth) || 0, height: Number(position.viewBoxHeight) || 0,
      } : null,
    };
  };
  const notes = documents("note")[0];
  const noteUrl = (id: unknown): string | null => {
    if (!session.notesUrl || !string(id)) return null;
    return `${session.notesUrl.replace(/\/$/u, "")}/p/${encodeURIComponent(string(id))}`;
  };
  return {
    users: users.filter((user) => user.loggedOut !== true).map((user) => {
      const voice = voices.find((v) => v.intId === user.userId && v.joined === true);
      return {
        id: string(user.userId), name: string(user.name), role: string(user.role),
        presenter: user.presenter === true, moderator: user.role === "MODERATOR",
        locked: user.locked === true, raisedHand: user.emoji === "raiseHand",
        emoji: string(user.emoji) || "none",
        audio: { joined: !!voice, listenOnly: voice?.listenOnly === true, muted: voice?.muted === true, speaking: voice?.talking === true },
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id)),
    chats: documents("group-chat").map((chat) => ({
      id: string(chat.chatId), name: string(chat.name), private: chat.access === "PRIVATE_ACCESS",
      userIds: Array.isArray(chat.users) ? chat.users.filter((id): id is string => typeof id === "string") : [],
    })),
    messages: [...messages.values()].map((doc) => normalizeWebinarMessage(doc, [...users, ...persistent]))
      .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)),
    presentations: presentations.map((presentation) => {
      const id = string(presentation.id);
      const published = slides.filter((slide) => slide.presentationId === id);
      const pages = published.length ? published : Array.isArray(presentation.pages) ? presentation.pages.map(record) : [];
      return {
        id, name: string(presentation.name), current: presentation.current === true,
        downloadable: presentation.downloadable === true && session.features.presentationDownload,
        slides: pages.map((slide) => normalizeSlide(slide, id)).sort((a, b) => a.number - b.number),
      };
    }),
    streams: [
      ...documents("video-streams").map((stream) => ({
        id: string(stream.stream), kind: "camera" as const, userId: string(stream.userId) || null, hasAudio: false,
      })),
      ...documents("screenshare").filter((stream) => stream.screenshare !== false).map((stream) => ({
        id: string(record(stream.screenshare).streamId) || string(stream._id),
        kind: "screen" as const, userId: string(record(stream.screenshare).userId) || null,
        hasAudio: record(stream.screenshare).hasAudio === true,
      })),
    ],
    notes: notes ? { revision: typeof notes.revs === "number" ? notes.revs : 0,
      readUrl: noteUrl(notes.readOnlyId), editUrl: noteUrl(notes.padId) } : null,
    ended: meeting?.meetingEnded === true,
  };
}
