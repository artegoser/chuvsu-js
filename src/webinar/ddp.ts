import { openWebinarSocket } from "./socket.js";
import { WebinarProtocolError, type WebinarSocketFactory, type WebinarSocket } from "./types.js";

export type WebinarDocument = Record<string, unknown>;
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** DDP transport: no Meteor runtime and no profile/settings writes. */
export class WebinarDdp {
  private socket: WebinarSocket | null = null;
  private sequence = 0;
  private pending = new Map<string, Pending>();
  private collections = new Map<string, Map<string, WebinarDocument>>();
  private listeners = new Set<(collection: string, id: string, removed: boolean) => void>();
  private disconnectListeners = new Set<() => void>();
  private errorListeners = new Set<(error: Error) => void>();
  private subscriptions = new Map<string, Promise<void>>();
  private connected = false;

  constructor(
    private factory: WebinarSocketFactory,
    private timeout = 15_000,
  ) {
    if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("Invalid webinar timeout");
  }

  onChange(listener: (collection: string, id: string, removed: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => { this.disconnectListeners.delete(listener); };
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => { this.errorListeners.delete(listener); };
  }

  documents(collection: string): WebinarDocument[] {
    return structuredClone([...this.collections.get(collection)?.values() ?? []]);
  }

  async connect(url: string): Promise<void> {
    if (this.socket) throw new WebinarProtocolError("Webinar transport already opened");
    const socket = this.factory(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      try {
        if (typeof event.data !== "string") throw new WebinarProtocolError("Invalid DDP frame");
        this.receive(JSON.parse(event.data) as WebinarDocument);
      } catch {
        const error = new WebinarProtocolError("Invalid webinar DDP response");
        for (const listener of this.errorListeners) listener(error);
        this.close();
      }
    });
    socket.addEventListener("close", () => this.disconnected());
    socket.addEventListener("error", () => this.close());
    await openWebinarSocket(socket, this.timeout);
    const ready = this.wait("connect");
    this.send({ msg: "connect", version: "1", support: ["1"] });
    await ready;
    this.connected = true;
  }

  private wait(id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WebinarProtocolError("Webinar request timed out"));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private settle(id: string, value: unknown, error?: Error): void {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (error) request.reject(error);
    else request.resolve(value);
  }

  private send(message: WebinarDocument): void {
    if (this.socket?.readyState !== 1) throw new WebinarProtocolError("Webinar is disconnected");
    this.socket.send(JSON.stringify(message));
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    if (!this.connected) throw new WebinarProtocolError("Webinar is disconnected");
    const id = `method:${++this.sequence}`;
    const result = this.wait(id);
    this.send({ msg: "method", id, method, params });
    return result;
  }

  async subscribe(name: string, params: unknown[] = []): Promise<void> {
    if (!this.connected) throw new WebinarProtocolError("Webinar is disconnected");
    const key = JSON.stringify([name, params]);
    const existing = this.subscriptions.get(key);
    if (existing) return existing;
    const id = `sub:${++this.sequence}`;
    const ready = this.wait(id);
    const subscription = ready.then(() => undefined).catch((error) => {
      this.subscriptions.delete(key);
      throw error;
    });
    this.subscriptions.set(key, subscription);
    this.send({ msg: "sub", id, name, params });
    return subscription;
  }

  async waitFor(collection: string, predicate: (doc: WebinarDocument) => boolean): Promise<WebinarDocument> {
    const existing = this.documents(collection).find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe(); disconnected();
        reject(new WebinarProtocolError("Webinar state timed out"));
      }, this.timeout);
      const finish = () => { clearTimeout(timer); unsubscribe(); disconnected(); };
      const unsubscribe = this.onChange((changed) => {
        if (changed !== collection) return;
        const doc = this.documents(collection).find(predicate);
        if (doc) { finish(); resolve(doc); }
      });
      const disconnected = this.onDisconnect(() => {
        finish(); reject(new WebinarProtocolError("Webinar is disconnected"));
      });
    });
  }

  private receive(data: WebinarDocument): void {
    if (!data || typeof data !== "object") throw new WebinarProtocolError("Invalid DDP message");
    switch (data.msg) {
      case "connected": this.settle("connect", undefined); break;
      case "failed": this.settle("connect", undefined, new WebinarProtocolError("DDP version rejected")); break;
      case "ping": this.send({ msg: "pong", ...(data.id === undefined ? {} : { id: data.id }) }); break;
      case "ready":
        if (Array.isArray(data.subs)) for (const id of data.subs) this.settle(String(id), undefined);
        break;
      case "nosub":
      case "result":
        this.settle(String(data.id), data.result, data.error
          ? new WebinarProtocolError(`Webinar ${data.msg === "nosub" ? "subscription" : "method"} rejected`)
          : undefined);
        break;
      case "added":
      case "changed":
      case "removed": {
        if (typeof data.collection !== "string" || typeof data.id !== "string") return;
        let collection = this.collections.get(data.collection);
        if (!collection) { collection = new Map(); this.collections.set(data.collection, collection); }
        if (data.msg === "removed") collection.delete(data.id);
        else {
          const fields = data.fields !== null && typeof data.fields === "object" && !Array.isArray(data.fields)
            ? data.fields as WebinarDocument : {};
          const doc: WebinarDocument = { ...(data.msg === "added" ? {} : collection.get(data.id)), ...fields, _id: data.id };
          if (Array.isArray(data.cleared)) for (const field of data.cleared) if (field !== "_id") delete doc[String(field)];
          collection.set(data.id, doc);
        }
        for (const listener of this.listeners) listener(data.collection, data.id, data.msg === "removed");
        break;
      }
    }
  }

  private disconnected(): void {
    if (!this.socket) return;
    this.connected = false;
    this.socket = null;
    for (const [id] of this.pending) this.settle(id, undefined, new WebinarProtocolError("Webinar is disconnected"));
    for (const listener of this.disconnectListeners) listener();
  }

  close(): void {
    const socket = this.socket;
    this.disconnected();
    socket?.close();
    this.collections.clear();
    this.subscriptions.clear();
  }
}
