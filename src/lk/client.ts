import {
  HttpClient,
  type HttpBufferResponse,
  type HttpResponse,
} from "../common/http.js";
import { HybridCache } from "../common/cache.js";
import { AuthError, ParseError } from "../common/types.js";
import { extractScriptValues } from "./parse.js";
import { parseWebinarPage } from "./parse/webinars.js";
import { parsePortfolio, parsePortfolioUrl } from "./parse/portfolio.js";
import { WebinarGateway } from "../webinar/gateway.js";
import type { StudentPortfolio } from "./portfolio-types.js";
import { isLocalDate } from "../tt/utils/date.js";
import type { LocalDate } from "../common/types.js";
import type {
  StudentPortalCacheConfig,
  StudentPortalClientOptions,
  StudentProfile,
  Webinar,
  WebinarPage,
} from "./types.js";

const BASE = "https://lk.chuvsu.ru";
const LOGIN_URL = `${BASE}/info/login.php`;
const STUDENT_BASE = `${BASE}/student`;

function makeUniformCacheConfig(ttl: number): StudentPortalCacheConfig {
  return {
    profile: ttl,
    profilePhoto: ttl,
    timetableGroupId: ttl,
    webinars: ttl,
    portfolio: ttl,
  };
}

export class StudentPortalClient {
  private http = new HttpClient();
  private credentials: { email: string; password: string } | null = null;
  private cache: HybridCache | null;
  private blobAdapter = undefined as StudentPortalClientOptions["blobAdapter"];

  constructor(opts?: StudentPortalClientOptions) {
    this.blobAdapter = opts?.blobAdapter;
    if (opts?.cache == null) {
      this.cache = null;
    } else if (typeof opts.cache === "number") {
      this.cache = new HybridCache(
        makeUniformCacheConfig(opts.cache) as Record<string, number | undefined>,
        opts.cacheAdapter,
      );
    } else {
      this.cache = new HybridCache(
        opts.cache as Record<string, number | undefined>,
        opts.cacheAdapter,
      );
    }
  }

  async login(opts: { email: string; password: string }): Promise<void> {
    const res = await this.http.post(
      LOGIN_URL,
      { email: opts.email, password: opts.password, role: "1", enter: "" },
      false,
    );
    if (!(res.status === 302 && res.location?.includes("student"))) {
      throw new AuthError("LK login failed");
    }
    this.credentials = opts;
  }

  private isSessionExpired(body: string): boolean {
    return body.includes("login.php");
  }

  private async authGet(url: string): Promise<HttpResponse> {
    let res = await this.http.get(url);
    if (this.credentials && this.isSessionExpired(res.body)) {
      await this.login(this.credentials);
      res = await this.http.get(url);
    }
    if (this.isSessionExpired(res.body)) {
      throw new AuthError("LK request returned an authentication page");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`LK request failed with HTTP ${res.status}: ${url}`);
    }
    return res;
  }

  private isBinarySessionExpired(response: HttpBufferResponse): boolean {
    const prefix = response.body.subarray(0, 8_192).toString("utf8");
    return this.isSessionExpired(prefix);
  }

  private async authGetBuffer(url: string): Promise<Buffer> {
    let res = await this.http.getBufferResponse(url);
    if (this.credentials && this.isBinarySessionExpired(res)) {
      await this.login(this.credentials);
      res = await this.http.getBufferResponse(url);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`LK request failed with HTTP ${res.status}: ${url}`);
    }
    if (this.isBinarySessionExpired(res)) {
      throw new AuthError("LK binary request returned an authentication page");
    }
    return res.body;
  }

  async getProfile(): Promise<StudentProfile> {
    const cached = await this.cache?.get("profile", "self");
    if (cached) return cached as StudentProfile;

    const { body } = await this.authGet(`${STUDENT_BASE}/personal_data.php`);
    const vals = extractScriptValues(body, "form_personal_data");
    if (!vals.fam?.trim() || !vals.nam?.trim()) {
      throw new ParseError("LK profile response has no student identity");
    }
    const data = {
      lastName: vals.fam ?? "",
      firstName: vals.nam ?? "",
      patronymic: vals.oth ?? "",
      sex: vals.sex ?? "",
      birthday: vals.birthday ?? "",
      recordBookNumber: vals.zachetka ?? "",
      faculty: vals.faculty ?? "",
      specialty: vals.spec ?? "",
      profile: vals.profile ?? "",
      group: vals.groupname ?? "",
      course: vals.course ?? "",
      email: vals.email ?? "",
      phone: vals.phone ?? "",
    };
    await this.cache?.set("profile", "self", data);
    return data;
  }

  async getProfilePhoto(): Promise<Buffer> {
    const cached =
      this.cache?.getLocal("profilePhoto", "self") ??
      await this.cache?.get("profilePhoto", "self");
    if (cached !== null && cached !== undefined) {
      const entry = cached as { data?: string | null; blobKey?: string } | string;
      if (typeof entry === "string") return Buffer.from(entry, "base64");
      if (entry.data !== undefined) {
        return entry.data ? Buffer.from(entry.data, "base64") : Buffer.alloc(0);
      }
      if (entry.blobKey && this.blobAdapter) {
        const photo = await this.blobAdapter.get(entry.blobKey);
        if (photo) {
          this.cache?.setLocal("profilePhoto", "self", { data: photo.toString("base64") });
          return photo;
        }
      }
    }

    const photo = await this.authGetBuffer(`${STUDENT_BASE}/face.php`);
    if (this.blobAdapter) {
      const blobKey = "lk/photo/self";
      this.cache?.setLocal("profilePhoto", "self", { data: photo.toString("base64") });
      await this.blobAdapter.put(blobKey, photo, {
        ttl: this.cache?.ttl("profilePhoto"),
      });
      await this.cache?.setExternal("profilePhoto", "self", { blobKey });
    } else {
      await this.cache?.set("profilePhoto", "self", photo.toString("base64"));
    }
    return photo;
  }

  async getTimetableGroupId(): Promise<number | null> {
    const cached = await this.cache?.get("timetableGroupId", "self");
    if (cached !== null && cached !== undefined) return cached as number | null;

    const { body } = await this.authGet(`${STUDENT_BASE}/tt.php`);
    const match = body.match(/tt\.chuvsu\.ru\/index\/grouptt\/gr\/(\d+)/);
    const groupId = match ? parseInt(match[1]) : null;
    await this.cache?.set("timetableGroupId", "self", groupId);
    return groupId;
  }

  /** No date means the portal's current day. Date POST only filters the listing. */
  async getWebinarPage(opts?: { date?: LocalDate }): Promise<WebinarPage> {
    if (opts?.date !== undefined && !isLocalDate(opts.date)) {
      throw new RangeError("Invalid webinar date");
    }
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
    const key = `v2:${opts?.date ?? `today:${today}`}`;
    const cached = await this.cache?.get("webinars", key);
    if (cached) return cached as WebinarPage;
    const url = `${STUDENT_BASE}/mywebinars.php`;
    const response = opts?.date
      ? await this.authPost(url, { day: opts.date })
      : await this.authGet(url);
    const page = parseWebinarPage(response.body);
    if (opts?.date && page.date !== opts.date) {
      throw new ParseError("LK did not return the requested webinar date");
    }
    await this.cache?.set("webinars", key, page);
    return page;
  }

  async getWebinars(opts?: { date?: LocalDate }): Promise<Webinar[]> {
    return (await this.getWebinarPage(opts)).webinars;
  }

  /** Creates a BBB participant session. May register the student's room presence. */
  async openWebinar(opts: { webinarId: string | number }): Promise<WebinarGateway> {
    const gateway = new WebinarGateway();
    await gateway.openSession({ joinUrl: await this.getWebinarJoinUrl(opts) });
    return gateway;
  }

  /** Discovers the current student's portfolio through the home navigation. */
  async getPortfolio(): Promise<StudentPortfolio> {
    const cached = await this.cache?.get("portfolio", "v2:self");
    if (cached) return cached as StudentPortfolio;
    const home = await this.authGet(`${STUDENT_BASE}/index.php`);
    const target = parsePortfolioUrl(home.body);
    const { body } = await this.authGet(target);
    const portfolio = parsePortfolio(body, { url: target });
    await this.cache?.set("portfolio", "v2:self", portfolio);
    return portfolio;
  }

  async getPortfolioUrl(): Promise<string> {
    return (await this.getPortfolio()).url;
  }

  /** Resolves a URL only. Does not open or connect to the webinar. */
  async getWebinarJoinUrl(opts: { webinarId: string | number }): Promise<string> {
    if (!/^[1-9]\d*$/u.test(String(opts.webinarId))) {
      throw new RangeError("Webinar ID must be a positive integer");
    }
    const { body } = await this.authPost(`${STUDENT_BASE}/joinweb.php`, {
      idw: String(opts.webinarId),
    });
    let data: { mes?: unknown; url?: unknown } | null;
    try {
      data = JSON.parse(body);
    } catch {
      throw new ParseError("LK webinar join returned invalid JSON");
    }
    if (data?.mes !== "SUCCESS" || typeof data.url !== "string") {
      throw new ParseError("LK webinar join returned no URL");
    }
    let url: URL;
    try {
      url = new URL(data.url);
    } catch {
      throw new ParseError("LK webinar join returned an invalid URL");
    }
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new ParseError("LK webinar join returned an unsafe URL");
    }
    return data.url;
  }

  private async authPost(url: string, data: Record<string, string>): Promise<HttpResponse> {
    let response = await this.http.post(url, data);
    if (this.credentials && this.isSessionExpired(response.body)) {
      await this.login(this.credentials);
      response = await this.http.post(url, data);
    }
    if (this.isSessionExpired(response.body)) {
      throw new AuthError("LK request returned an authentication page");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`LK request failed with HTTP ${response.status}: ${url}`);
    }
    return response;
  }
}
