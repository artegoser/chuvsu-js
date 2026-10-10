import { ParseError } from "../common/types.js";
import { WebinarProtocolError, type WebinarSession } from "./types.js";
import type { WebinarDocument } from "./ddp.js";

export function record(value: unknown): WebinarDocument {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as WebinarDocument : {};
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function safeWebinarUrl(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, origin);
    return url.protocol === "https:" && url.origin === origin && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

/** Decode the JSON runtime config without executing server scripts. */
export function parseWebinarConfig(html: string): WebinarDocument {
  const match = html.match(/__meteor_runtime_config__\s*=\s*JSON\.parse\(decodeURIComponent\("([^"\r\n]+)"\)\)/u);
  if (!match) throw new WebinarProtocolError("Unsupported webinar client: no Meteor runtime config");
  try {
    const config = record(JSON.parse(decodeURIComponent(match[1])));
    if (!config.PUBLIC_SETTINGS) throw new Error();
    return record(config.PUBLIC_SETTINGS);
  } catch { throw new ParseError("Invalid webinar runtime configuration"); }
}

export function parseWebinarSession(opts: {
  clientUrl: string;
  config: WebinarDocument;
  entry: unknown;
  iceServers: RTCIceServer[];
}): WebinarSession {
  const url = new URL(opts.clientUrl);
  const response = record(record(opts.entry).response);
  if (response.returncode !== "SUCCESS") throw new ParseError("Webinar session entry failed");
  const app = record(opts.config.app);
  const kurento = record(opts.config.kurento);
  const chat = record(opts.config.chat);
  const version = String(app.bbbServerVersion ?? "");
  if (!/^2\.3(?:\.|$)/u.test(version)) {
    throw new WebinarProtocolError(`Unsupported webinar version: ${version || "unknown"}`);
  }
  const token = url.searchParams.get("sessionToken");
  const required = [token, response.authToken, response.internalUserID, response.meetingID,
    response.fullname, response.voicebridge];
  if (required.some((value) => typeof value !== "string" || !value)) {
    throw new ParseError("Incomplete webinar participant credentials");
  }
  const basename = string(app.basename) || "/html5client";
  if (!/^\/[\w/-]+$/u.test(basename)) throw new ParseError("Invalid webinar client path");
  const state = new URL(`${basename.replace(/\/$/u, "")}/websocket`, url.origin);
  state.protocol = "wss:";
  const media = new URL(string(kurento.wsUrl), url.origin);
  if (media.protocol !== "wss:" || media.host !== url.host) throw new ParseError("Invalid webinar media endpoint");
  media.searchParams.set("sessionToken", token!);
  const enabled = (value: unknown) => value === true;
  return {
    server: { origin: url.origin, version, build: typeof app.html5ClientBuild === "number" ? app.html5ClientBuild : null },
    protocol: "ddp",
    mediaBackend: "kurento",
    sessionToken: token!,
    authToken: string(response.authToken),
    externalUserId: string(response.externUserID),
    user: { id: string(response.internalUserID), name: string(response.fullname), role: string(response.role) },
    meeting: { id: string(response.meetingID), name: string(response.confname), voiceBridge: string(response.voicebridge) },
    connections: { state: state.href, media: media.href },
    iceServers: opts.iceServers,
    features: {
      chat: enabled(chat.enabled),
      notes: enabled(record(opts.config.note).enabled),
      audio: enabled(kurento.enableListenOnly),
      video: enabled(kurento.enableVideo),
      screen: enabled(kurento.enableScreensharing),
      raiseHand: enabled(record(app.raiseHandActionButton).enabled),
      presentationDownload: enabled(record(opts.config.presentation).allowDownloadable),
    },
    notesUrl: safeWebinarUrl(record(opts.config.note).url, url.origin),
    publicChatId: string(chat.public_group_id) || "MAIN-PUBLIC-GROUP-CHAT",
    chatPageSize: typeof chat.itemsPerPage === "number" && chat.itemsPerPage > 0 ? chat.itemsPerPage : 100,
    maxMessageLength: typeof chat.max_message_length === "number" && chat.max_message_length > 0 ? chat.max_message_length : 5_000,
  };
}

export function parseWebinarIceServers(body: string): RTCIceServer[] {
  try {
    const response = record(JSON.parse(body));
    if (!Array.isArray(response.stunServers) || !Array.isArray(response.turnServers)) throw new Error();
    const servers: RTCIceServer[] = [];
    for (const stun of Array.isArray(response.stunServers) ? response.stunServers : []) {
      const url = string(record(stun).url) || string(stun);
      if (/^stuns?:/u.test(url)) servers.push({ urls: url });
    }
    for (const turn of Array.isArray(response.turnServers) ? response.turnServers : []) {
      const data = record(turn);
      const url = string(data.url);
      if (/^turns?:/u.test(url)) servers.push({ urls: url, username: string(data.username), credential: string(data.password) });
    }
    return servers;
  } catch { throw new ParseError("Invalid webinar ICE server response"); }
}
