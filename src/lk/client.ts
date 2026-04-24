import { HttpClient, type HttpResponse } from "../common/http.js";
import { Cache } from "../common/cache.js";
import { AuthError } from "../common/types.js";
import { extractScriptValues } from "./parse.js";
import type { LkCacheConfig, LkClientOptions, PersonalData } from "./types.js";

const BASE = "https://lk.chuvsu.ru";
const LOGIN_URL = `${BASE}/info/login.php`;
const STUDENT_BASE = `${BASE}/student`;

function makeUniformCacheConfig(ttl: number): LkCacheConfig {
  return {
    personalData: ttl,
    photo: ttl,
    groupId: ttl,
  };
}

export class LkClient {
  private http = new HttpClient();
  private credentials: { email: string; password: string } | null = null;
  private cache: Cache | null;

  constructor(opts?: LkClientOptions) {
    if (opts?.cache == null) {
      this.cache = null;
    } else if (typeof opts.cache === "number") {
      this.cache = new Cache(
        makeUniformCacheConfig(opts.cache) as Record<string, number | undefined>,
      );
    } else {
      this.cache = new Cache(opts.cache as Record<string, number | undefined>);
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

  async getPersonalData(): Promise<PersonalData> {
    const cached = this.cache?.get("personalData", "self");
    if (cached) return cached as PersonalData;

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
    this.cache?.set("personalData", "self", data);
    return data;
  }

  async getPhoto(): Promise<Buffer> {
    const cached = this.cache?.get("photo", "self");
    if (cached !== null && cached !== undefined) {
      return Buffer.from(cached as string, "base64");
    }

    const photo = await this.http.getBuffer(`${STUDENT_BASE}/face.php`);
    this.cache?.set("photo", "self", photo.toString("base64"));
    return photo;
  }

  async getGroupId(): Promise<number | null> {
    const cached = this.cache?.get("groupId", "self");
    if (cached !== null && cached !== undefined) return cached as number | null;

    const { body } = await this.authGet(`${STUDENT_BASE}/tt.php`);
    const match = body.match(/tt\.chuvsu\.ru\/index\/grouptt\/gr\/(\d+)/);
    const groupId = match ? parseInt(match[1]) : null;
    this.cache?.set("groupId", "self", groupId);
    return groupId;
  }
}
