import { HttpClient, type HttpResponse } from "../common/http.js";
import { HybridCache } from "../common/cache.js";
import { AuthError } from "../common/types.js";
import { extractScriptValues } from "./parse.js";
import type {
  StudentPortalCacheConfig,
  StudentPortalClientOptions,
  StudentProfile,
} from "./types.js";

const BASE = "https://lk.chuvsu.ru";
const LOGIN_URL = `${BASE}/info/login.php`;
const STUDENT_BASE = `${BASE}/student`;

function makeUniformCacheConfig(ttl: number): StudentPortalCacheConfig {
  return {
    profile: ttl,
    profilePhoto: ttl,
    timetableGroupId: ttl,
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
    const res = await this.http.get(url);
    if (this.credentials && this.isSessionExpired(res.body)) {
      await this.login(this.credentials);
      return this.http.get(url);
    }
    return res;
  }

  async getProfile(): Promise<StudentProfile> {
    const cached = await this.cache?.get("profile", "self");
    if (cached) return cached as StudentProfile;

    const { body } = await this.authGet(`${STUDENT_BASE}/personal_data.php`);
    const vals = extractScriptValues(body, "form_personal_data");
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

    const photo = await this.http.getBuffer(`${STUDENT_BASE}/face.php`);
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
}
