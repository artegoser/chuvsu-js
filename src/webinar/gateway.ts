import { HttpClient } from "../common/http.js";
import { AuthError, ParseError } from "../common/types.js";
import { parseWebinarConfig, parseWebinarIceServers, parseWebinarSession } from "./parse.js";
import { WebinarPermissionError, type WebinarSession, type WebinarSlide } from "./types.js";
import { WebinarClient } from "./client.js";

/** Backend-only LK/BBB bootstrap and same-server presentation HTTP access. */
export class WebinarGateway {
  private http = new HttpClient();
  private session: WebinarSession | null = null;
  private client: WebinarClient | null = null;

  getSession(): WebinarSession {
    if (!this.session) throw new AuthError("Open a webinar session first");
    return structuredClone(this.session);
  }

  async openSession(opts: { joinUrl: string }): Promise<WebinarSession> {
    if (this.session) throw new Error("Create a new gateway for each webinar session");
    let url = new URL(opts.joinUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/bigbluebutton/api/join") {
      throw new RangeError("Expected a signed HTTPS BBB join URL");
    }
    const origin = url.origin;
    let html: string | null = null;
    for (let redirects = 0; redirects < 6; redirects++) {
      const response = await this.http.get(url.href, false);
      if (response.status >= 300 && response.status < 400 && response.location) {
        const next = new URL(response.location, url);
        if (next.origin !== origin || next.username || next.password) throw new AuthError("Webinar redirected outside its server");
        url = next;
        continue;
      }
      if (response.status !== 200) throw new AuthError(`Webinar join failed with HTTP ${response.status}`);
      html = response.body;
      break;
    }
    if (html === null || !url.searchParams.get("sessionToken")) throw new AuthError("Webinar did not create a participant session");
    const config = parseWebinarConfig(html);
    const token = url.searchParams.get("sessionToken")!;
    const endpoint = (path: string) => {
      const endpointUrl = new URL(path, origin);
      endpointUrl.searchParams.set("sessionToken", token);
      return endpointUrl.href;
    };
    const entry = await this.http.get(endpoint("/bigbluebutton/api/enter"), false);
    if (entry.status !== 200) throw new AuthError("Webinar participant entry failed");
    let data: unknown;
    try { data = JSON.parse(entry.body); } catch { throw new ParseError("Invalid webinar entry response"); }
    const ice = await this.http.get(endpoint("/bigbluebutton/api/stuns"), false);
    if (ice.status !== 200) throw new AuthError("Webinar ICE configuration failed");
    this.session = parseWebinarSession({ clientUrl: url.href, config, entry: data, iceServers: parseWebinarIceServers(ice.body) });
    return structuredClone(this.session);
  }

  /** Opens state only. Browser media is connected separately by WebinarMediaClient. */
  async connect(): Promise<WebinarClient> {
    if (!this.session) throw new AuthError("Open a webinar session first");
    if (this.client) throw new Error("Webinar gateway state client already opened");
    const client = new WebinarClient(this.session, { socketFactory: (url) => this.http.createWebSocket(url) });
    await client.connect();
    this.client = client;
    return client;
  }

  /** Downloads only when the live participant state exposes this permission. */
  async downloadPresentation(opts: { presentationId: string }): Promise<{
    body: Buffer; contentType: string; filename: string;
  }> {
    const presentation = this.client?.getPresentations().find((item) => item.id === opts.presentationId);
    if (!this.session || !presentation?.downloadable) throw new WebinarPermissionError("Original presentation download is disabled or unavailable");
    const extension = presentation.name.split(".").pop() ?? "";
    if (!/^[a-zA-Z0-9]+$/u.test(extension)) throw new ParseError("Invalid presentation extension");
    const url = new URL(`/bigbluebutton/presentation/download/${encodeURIComponent(this.session.meeting.id)}/${encodeURIComponent(presentation.id)}`, this.session.server.origin);
    url.searchParams.set("presFilename", `${presentation.id}.${extension}`);
    const response = await this.http.getBufferResponse(url.href, false);
    if (response.status !== 200 || !response.contentType || response.contentType.startsWith("text/html")) {
      throw new ParseError("Original presentation download failed");
    }
    return { body: response.body, contentType: response.contentType,
      filename: presentation.name.replace(/[\\/\x00-\x1f]/gu, "_") };
  }

  async downloadSlide(opts: { slide: WebinarSlide; format?: "svg" | "thumbnail" | "text" }): Promise<{
    body: Buffer;
    contentType: string;
    filename: string;
  }> {
    if (!this.session) throw new AuthError("Open a webinar session first");
    const format = opts.format ?? "svg";
    const value = format === "svg" ? opts.slide.svgUrl : format === "text" ? opts.slide.textUrl : opts.slide.thumbnailUrl;
    if (!value) throw new ParseError("Slide asset is unavailable");
    const url = new URL(value);
    const prefix = `/bigbluebutton/presentation/${encodeURIComponent(this.session.meeting.id)}/`;
    if (url.origin !== this.session.server.origin || !url.pathname.startsWith(prefix)
      || !/\/(?:svg|thumbnail|textfiles)\/\d+$/u.test(url.pathname) || url.search || url.username || url.password) {
      throw new RangeError("Expected a slide asset from the current webinar");
    }
    const response = await this.http.getBufferResponse(url.href, false);
    if (response.status !== 200) throw new Error(`Webinar slide request failed with HTTP ${response.status}`);
    const expected = format === "svg" ? "image/svg+xml" : format === "text" ? "text/" : "image/";
    if (!response.contentType?.startsWith(expected)) throw new ParseError("Webinar returned an invalid slide asset");
    const extension = format === "svg" ? "svg" : format === "text" ? "txt" : response.contentType.includes("png") ? "png" : "jpg";
    return { body: response.body, contentType: response.contentType, filename: `slide-${opts.slide.number}.${extension}` };
  }
}
