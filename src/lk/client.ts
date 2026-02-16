import { HttpClient, type HttpResponse } from "../common/http.js";
import { AuthError } from "../common/types.js";
import { extractScriptValues } from "./parse.js";
import type { PersonalData } from "./types.js";

const BASE = "https://lk.chuvsu.ru";
const LOGIN_URL = `${BASE}/info/login.php`;
const STUDENT_BASE = `${BASE}/student`;

export class LkClient {
  private http = new HttpClient();
  private credentials: { email: string; password: string } | null = null;

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
    const { body } = await this.authGet(`${STUDENT_BASE}/personal_data.php`);
    const vals = extractScriptValues(body, "form_personal_data");
    return {
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
  }

  async getPhoto(): Promise<Buffer> {
    return this.http.getBuffer(`${STUDENT_BASE}/face.php`);
  }

  async getGroupId(): Promise<number | null> {
    const { body } = await this.authGet(`${STUDENT_BASE}/tt.php`);
    const match = body.match(/tt\.chuvsu\.ru\/index\/grouptt\/gr\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }
}
