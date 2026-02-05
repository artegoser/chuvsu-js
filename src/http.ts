import { Agent, fetch, type Dispatcher, type Headers as UndiciHeaders } from "undici";
import { CHUVSU_CA_CERTS } from "./certs.js";

const agent = new Agent({
  connect: { ca: CHUVSU_CA_CERTS },
});

export interface HttpResponse {
  status: number;
  body: string;
  location?: string;
}

export class HttpClient {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private saveCookies(headers: UndiciHeaders): void {
    const raw = headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const match = c.match(/^([^=]+)=([^;]*)/);
      if (match) this.cookies.set(match[1], match[2]);
    }
  }

  async get(url: string, followRedirects = true): Promise<HttpResponse> {
    const res = await fetch(url, {
      method: "GET",
      headers: { Cookie: this.cookieHeader() },
      redirect: followRedirects ? "follow" : "manual",
      dispatcher: agent as Dispatcher,
    });
    this.saveCookies(res.headers);
    return {
      status: res.status,
      body: await res.text(),
      location: res.headers.get("location") ?? undefined,
    };
  }

  async post(
    url: string,
    data: Record<string, string>,
    followRedirects = true,
  ): Promise<HttpResponse> {
    const body = new URLSearchParams(data).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.cookieHeader(),
      },
      body,
      redirect: followRedirects ? "follow" : "manual",
      dispatcher: agent as Dispatcher,
    });
    this.saveCookies(res.headers);
    return {
      status: res.status,
      body: await res.text(),
      location: res.headers.get("location") ?? undefined,
    };
  }
}
