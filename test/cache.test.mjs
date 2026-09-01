import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Cache, HybridCache } from "../dist/common/cache.js";
import { StudentPortalClient } from "../dist/lk/client.js";
import { TimetableClient } from "../dist/tt/client.js";

class FakeHttpClient {
  constructor({ get = {}, post = {}, buffers = {} } = {}) {
    this.getResponses = new Map(Object.entries(get));
    this.postResponses = new Map(Object.entries(post));
    this.bufferResponses = new Map(
      Object.entries(buffers).map(([key, value]) => [key, Buffer.from(value)]),
    );
    this.calls = {
      get: new Map(),
      post: new Map(),
      getBuffer: new Map(),
    };
  }

  bump(bucket, key) {
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }

  count(method, key) {
    return this.calls[method].get(key) ?? 0;
  }

  async get(url) {
    this.bump(this.calls.get, url);
    return this.getResponses.get(url) ?? { status: 200, body: "" };
  }

  async post(url, data) {
    const key = `${url}|${JSON.stringify(data)}`;
    this.bump(this.calls.post, key);
    return this.postResponses.get(key) ?? { status: 200, body: "" };
  }

  async getBuffer(url) {
    return (await this.getBufferResponse(url)).body;
  }

  async getBufferResponse(url) {
    this.bump(this.calls.getBuffer, url);
    return {
      status: 200,
      body: this.bufferResponses.get(url) ?? Buffer.alloc(0),
      contentType: "application/octet-stream",
    };
  }
}

class FakeCacheAdapter {
  constructor() {
    this.store = new Map();
    this.setCalls = [];
  }

  key(category, key) {
    return `${category}:${key}`;
  }

  async get(category, key) {
    return this.store.get(this.key(category, key)) ?? null;
  }

  async set(category, key, data, ttl) {
    this.setCalls.push({ category, key, ttl, data });
    this.store.set(this.key(category, key), data);
  }

  async clear(category) {
    if (!category) {
      this.store.clear();
      return;
    }
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(`${category}:`)) this.store.delete(key);
    }
  }
}

class FakeBlobAdapter {
  constructor() {
    this.store = new Map();
    this.putCalls = [];
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async put(key, data, opts) {
    this.putCalls.push({ key, opts });
    this.store.set(key, Buffer.from(data));
  }
}

const TT_BASE = "https://tt.chuvsu.ru";
const LK_BASE = "https://lk.chuvsu.ru/student";

test("cache values and snapshots cannot mutate stored state by reference", async () => {
  const source = { nested: { value: 1 } };
  const cache = new Cache({ test: Infinity });
  cache.set("test", "one", source);
  source.nested.value = 2;

  const first = cache.get("test", "one");
  assert.equal(first.nested.value, 1);
  first.nested.value = 3;
  assert.equal(cache.get("test", "one").nested.value, 1);

  const exported = cache.export();
  exported["test:one"].data.nested.value = 4;
  assert.equal(cache.get("test", "one").nested.value, 1);

  const adapter = new FakeCacheAdapter();
  const external = { nested: { value: 5 } };
  adapter.store.set("test:two", external);
  const hybrid = new HybridCache({ test: Infinity }, adapter);
  const loaded = await hybrid.get("test", "two");
  loaded.nested.value = 6;
  assert.equal(external.nested.value, 5);
  assert.equal(hybrid.getLocal("test", "two").nested.value, 5);
});

test("cache rejects invalid TTLs and imported entries", () => {
  assert.throws(() => new Cache({ test: -1 }), /Invalid cache TTL/u);
  const cache = new Cache({ test: 1_000 });
  assert.throws(
    () => cache.import({ "unknown:key": { timestamp: Date.now(), data: 1 } }),
    /cache category/u,
  );
  assert.throws(
    () => cache.import({ "test:key": { timestamp: Number.NaN, data: 1 } }),
    /Invalid cache entry/u,
  );
});

test("TimetableClient caches discovery/search requests and image fetches when cache is a number", async () => {
  const cacheAdapter = new FakeCacheAdapter();
  const blobAdapter = new FakeBlobAdapter();
  const postKey = (url, data) => `${url}|${JSON.stringify(data)}`;
  const fakeHttp = new FakeHttpClient({
    get: {
      [`${TT_BASE}/index/tech`]: {
        status: 200,
        body: `<button class="techbut" value="Иванов Иван Иванович" onClick='$("#idstaff").val(10);$("#tt").submit();'>Иванов Иван Иванович</button>`,
      },
      [`${TT_BASE}/index/audtt/aud/852`]: {
        status: 200,
        body: `
          <div id="path" class="sbtext">
            <a href="/">Расписание занятий</a> &nbsp;&nbsp;/&nbsp;&nbsp;
            <a href="/index/findaud">Аудитории</a> &nbsp;&nbsp;/&nbsp;&nbsp; Е-115
          </div>
          <span class="htext"><nobr>Аудитория <span style="color: blue;">Е-115</span></nobr></span>
          <span class="htextb"> (Корпус Е; 1 этаж - Спортивный зал)</span>
          <img id="audsrc" src="/index/audimage/aud/852/aid/852">
          <img id="blocksrc" src="/index/blockimage/aud/852/bid/6">
          <img id="floorsrc" src="/index/floorplan/aud/852/fid/37">
          <map name="flooraud"><area shape="rect" alt="Е-115" coords="430,92,496,295"></map>
        `,
      },
      [`${TT_BASE}/index/techtt/tech/10`]: {
        status: 200,
        body: `
          <span class="htextb">Иванов Иван Иванович<br><span style="color: blue;">кандидат технических наук </span></span>
          <span class="htext">Кафедра Компьютерных технологий<br></span>
          <img id="photosrc" src="/index/photo/tech/10/id/10" alt="Фото">
        `,
      },
    },
    post: {
      [postKey(`${TT_BASE}/`, {
        techname: "Иванов",
        findtech: "найти",
        hfac: "0",
        pertt: "1",
      })]: {
        status: 200,
        body: `<button class="techbut" value="Иванов Иван Иванович" onClick='$("#idstaff").val(10);$("#tt").submit();'>Иванов Иван Иванович</button>`,
      },
      [postKey(`${TT_BASE}/`, {
        audname: "Е-1",
        findaud: "найти",
        hfac: "0",
        pertt: "1",
      })]: {
        status: 200,
        body: `<button name="aud852" value="Е-115"></button>`,
      },
      [postKey(`${TT_BASE}/`, {
        audname: "%%%",
        findaud: "найти",
        hfac: "0",
        pertt: "1",
      })]: {
        status: 200,
        body: `<button name="aud852" value="Е-115"></button>`,
      },
      [postKey(`${TT_BASE}/`, {
        grname: "КТ-41-24",
        findgr: "найти",
        hfac: "0",
        pertt: "1",
      })]: {
        status: 200,
        body: `<button id="gr8919" value="КТ-41-24" onClick='$("#idgr").val(8919);$("#tt").submit();'>КТ-41-24</button>`,
      },
    },
    buffers: {
      [`${TT_BASE}/index/photo/tech/10/id/10`]: "teacher-photo",
      [`${TT_BASE}/index/audimage/aud/852/aid/852`]: "audience-photo",
      [`${TT_BASE}/index/blockimage/aud/852/bid/6`]: "block-photo",
      [`${TT_BASE}/index/floorplan/aud/852/fid/37`]: "floor-photo",
    },
  });

  const tt = new TimetableClient({
    cache: 10_000,
    cacheAdapter,
    blobAdapter,
  });
  tt.http = fakeHttp;

  await tt.getTeachers();
  await tt.getTeachers();
  await tt.searchTeachers("Иванов");
  await tt.searchTeachers("Иванов");
  await tt.searchRooms("Е-1");
  await tt.searchRooms("Е-1");
  await tt.getRooms();
  await tt.getRooms();
  await tt.searchGroups("КТ-41-24");
  await tt.searchGroups("КТ-41-24");
  await tt.getRoomName(852);
  await tt.getRoomName(852);
  await tt.getTeacherInfo(10);
  await tt.getTeacherInfo(10);
  await tt.getTeacherPhoto(10);
  await tt.getTeacherPhoto(10);
  await tt.getRoomImage(852);
  await tt.getRoomImage(852);
  await tt.getRoomBuildingImage(852);
  await tt.getRoomBuildingImage(852);
  await tt.getRoomFloorPlan(852);
  await tt.getRoomFloorPlan(852);

  assert.equal(fakeHttp.count("get", `${TT_BASE}/index/tech`), 1);
  assert.equal(
    fakeHttp.count(
      "post",
      postKey(`${TT_BASE}/`, {
        techname: "Иванов",
        findtech: "найти",
        hfac: "0",
        pertt: "1",
      }),
    ),
    1,
  );
  assert.equal(
    fakeHttp.count(
      "post",
      postKey(`${TT_BASE}/`, {
        audname: "Е-1",
        findaud: "найти",
        hfac: "0",
        pertt: "1",
      }),
    ),
    1,
  );
  assert.equal(
    fakeHttp.count(
      "post",
      postKey(`${TT_BASE}/`, {
        audname: "%%%",
        findaud: "найти",
        hfac: "0",
        pertt: "1",
      }),
    ),
    1,
  );
  assert.equal(
    fakeHttp.count(
      "post",
      postKey(`${TT_BASE}/`, {
        grname: "КТ-41-24",
        findgr: "найти",
        hfac: "0",
        pertt: "1",
      }),
    ),
    1,
  );
  assert.equal(fakeHttp.count("get", `${TT_BASE}/index/audtt/aud/852`), 1);
  assert.equal(fakeHttp.count("get", `${TT_BASE}/index/techtt/tech/10`), 1);
  assert.equal(fakeHttp.count("getBuffer", `${TT_BASE}/index/photo/tech/10/id/10`), 1);
  assert.equal(fakeHttp.count("getBuffer", `${TT_BASE}/index/audimage/aud/852/aid/852`), 1);
  assert.equal(fakeHttp.count("getBuffer", `${TT_BASE}/index/blockimage/aud/852/bid/6`), 1);
  assert.equal(fakeHttp.count("getBuffer", `${TT_BASE}/index/floorplan/aud/852/fid/37`), 1);

  const cache = tt.exportCache();
  assert.ok(cache["teachers:all"]);
  assert.ok(cache["teachers:search:Иванов:1"]);
  assert.ok(cache["groups:search:КТ-41-24:1"]);
  assert.ok(cache["rooms:search:Е-1:1"]);
  assert.ok(cache["rooms:all:1"]);
  assert.ok(cache["roomNames:852"]);
  assert.ok(cache["teacherInfo:10"]);
  assert.ok(cache["teacherPhotos:10"]);
  assert.ok(cache["roomInfo:852"]);
  assert.ok(cache["roomImages:room:852"]);
  assert.ok(cache["roomImages:block:852"]);
  assert.ok(cache["roomImages:floor:852"]);

  assert.deepEqual(cacheAdapter.store.get("teacherPhotos:10"), {
    blobKey: "tt/teacher-photos/10",
  });
  assert.deepEqual(cacheAdapter.store.get("roomImages:room:852"), {
    blobKey: "tt/room-images/room:852",
  });
  assert.deepEqual(cacheAdapter.store.get("roomImages:block:852"), {
    blobKey: "tt/room-images/block:852",
  });
  assert.deepEqual(cacheAdapter.store.get("roomImages:floor:852"), {
    blobKey: "tt/room-images/floor:852",
  });
  assert.equal(blobAdapter.store.get("tt/teacher-photos/10")?.toString(), "teacher-photo");
  assert.equal(blobAdapter.store.get("tt/room-images/room:852")?.toString(), "audience-photo");
  assert.equal(blobAdapter.store.get("tt/room-images/block:852")?.toString(), "block-photo");
  assert.equal(blobAdapter.store.get("tt/room-images/floor:852")?.toString(), "floor-photo");
});

test("StudentPortalClient caches profile, photo and timetable group id", async () => {
  const cacheAdapter = new FakeCacheAdapter();
  const blobAdapter = new FakeBlobAdapter();
  const fakeHttp = new FakeHttpClient({
    get: {
      [`${LK_BASE}/personal_data.php`]: {
        status: 200,
        body: `
          <form name="form_personal_data"></form>
          <script>
            document.form_personal_data.fam.value = 'Егоров';
            document.form_personal_data.nam.value = 'Артемий';
            document.form_personal_data.oth.value = 'Сергеевич';
            document.form_personal_data.groupname.value = 'КТ-41-24';
          </script>
        `,
      },
      [`${LK_BASE}/tt.php`]: {
        status: 200,
        body: `https://tt.chuvsu.ru/index/grouptt/gr/8919`,
      },
    },
    buffers: {
      [`${LK_BASE}/face.php`]: "lk-photo",
    },
  });

  const lk = new StudentPortalClient({
    cache: 10_000,
    cacheAdapter,
    blobAdapter,
  });
  lk.http = fakeHttp;

  const data1 = await lk.getProfile();
  const data2 = await lk.getProfile();
  const photo1 = await lk.getProfilePhoto();
  const photo2 = await lk.getProfilePhoto();
  const groupId1 = await lk.getTimetableGroupId();
  const groupId2 = await lk.getTimetableGroupId();

  assert.equal(data1.lastName, "Егоров");
  assert.equal(data2.group, "КТ-41-24");
  assert.equal(photo1.toString(), "lk-photo");
  assert.equal(photo2.toString(), "lk-photo");
  assert.equal(groupId1, 8919);
  assert.equal(groupId2, 8919);

  assert.equal(fakeHttp.count("get", `${LK_BASE}/personal_data.php`), 1);
  assert.equal(fakeHttp.count("get", `${LK_BASE}/tt.php`), 1);
  assert.equal(fakeHttp.count("getBuffer", `${LK_BASE}/face.php`), 1);
  assert.deepEqual(cacheAdapter.store.get("profilePhoto:self"), {
    blobKey: "lk/photo/self",
  });
  assert.equal(blobAdapter.store.get("lk/photo/self")?.toString(), "lk-photo");
});

test("clients reject authentication HTML instead of caching it as binary data", async () => {
  const fakeHttp = new FakeHttpClient({
    buffers: {
      [`${LK_BASE}/face.php`]: "<html><a href='login.php'>login</a></html>",
      [`${TT_BASE}/index/photo/tech/10/id/10`]:
        '<html><input name="wname"></html>',
    },
  });
  fakeHttp.getBufferResponse = async function (url) {
    this.bump(this.calls.getBuffer, url);
    return {
      status: 200,
      body: this.bufferResponses.get(url) ?? Buffer.alloc(0),
      contentType: "text/html; charset=utf-8",
    };
  };

  const lk = new StudentPortalClient({ cache: 10_000 });
  lk.http = fakeHttp;
  await assert.rejects(() => lk.getProfilePhoto(), /authentication page/u);

  const tt = new TimetableClient({ cache: 10_000 });
  tt.http = fakeHttp;
  await assert.rejects(() => tt.getTeacherPhoto(10), /authentication page/u);
  assert.equal(tt.exportCache()["teacherPhotos:10"], undefined);
});

test("TimetableClient accepts JPEG photos mislabeled as HTML by TT", async () => {
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const fakeHttp = new FakeHttpClient();
  fakeHttp.getBufferResponse = async function (url) {
    this.bump(this.calls.getBuffer, url);
    return {
      status: 200,
      body: photo,
      contentType: "text/html; charset=utf-8",
    };
  };

  const tt = new TimetableClient({ cache: 10_000 });
  tt.http = fakeHttp;

  assert.deepEqual(await tt.getTeacherPhoto(10), photo);
});

test("StudentPortalClient rejects an unparseable profile before caching", async () => {
  const fakeHttp = new FakeHttpClient({
    get: {
      [`${LK_BASE}/personal_data.php`]: {
        status: 200,
        body: "<html><body>unexpected response</body></html>",
      },
    },
  });
  const lk = new StudentPortalClient({ cache: 10_000 });
  lk.http = fakeHttp;

  await assert.rejects(() => lk.getProfile(), /no student identity/u);
  assert.equal(fakeHttp.count("get", `${LK_BASE}/personal_data.php`), 1);
});

test("TimetableClient uses timetable context for canonical group schedule cache", async () => {
  const cacheAdapter = new FakeCacheAdapter();
  const groupUrl = `${TT_BASE}/index/grouptt/gr/8919`;
  const schedulePage = `
    <span class="htext">Группа <span style="color: blue;">КТ-41-24</span></span>
    <span style="color: blue;">2026/2027 учебный год</span>
    <input type="radio" name="pertype" value="1" checked="checked">
    <input type="hidden" id="htype" value="1">
  `;
  const fakeHttp = new FakeHttpClient({
    get: {
      [groupUrl]: {
        status: 200,
        body: schedulePage,
      },
    },
    post: Object.fromEntries([1, 2, 3, 4].map((period) => [
      `${groupUrl}|${JSON.stringify({ htype: String(period) })}`,
      { status: 200, body: schedulePage },
    ])),
  });

  const tt = new TimetableClient({ cache: 10_000, cacheAdapter });
  tt.http = fakeHttp;

  const schedule = await tt.getGroupSchedule(8919);

  assert.equal(schedule.period, 1);
  assert.equal(schedule.academicYearStartYear, 2026);
  assert.deepEqual(schedule.owner, {
    type: "group",
    group: { id: 8919, name: "КТ-41-24" },
  });
  for (const period of [1, 2, 3, 4]) {
    assert.ok(tt.exportCache()[`schedule:group:8919:${period}:2026-2027`]);
    assert.equal(
      fakeHttp.count(
        "post",
        `${groupUrl}|${JSON.stringify({ htype: String(period) })}`,
      ),
      1,
    );
  }
  assert.equal(fakeHttp.count("get", groupUrl), 1);
});

test("TimetableClient never caches an invalid schedule response", async () => {
  const groupUrl = `${TT_BASE}/index/grouptt/gr/8919`;
  const contextPage = `
    <span class="htext">Группа <span style="color: blue;">КТ-41-24</span></span>
    <span>2026/2027 учебный год</span>
    <input type="radio" name="pertype" value="1" checked>
  `;
  const fakeHttp = new FakeHttpClient({
    get: { [groupUrl]: { status: 200, body: contextPage } },
    post: {
      [`${groupUrl}|${JSON.stringify({ htype: "1" })}`]: {
        status: 200,
        body: `<html><body>temporary login/error page</body></html>`,
      },
    },
  });
  const tt = new TimetableClient({ cache: 10_000 });
  tt.http = fakeHttp;

  await assert.rejects(
    () => tt.getGroupSchedule(8919, { periods: [1] }),
    /unexpected academic year/u,
  );
  assert.equal(tt.exportCache()["schedule:group:8919:1:2026-2027"], undefined);
  assert.equal(tt.repository.getSeries().length, 0);
});

test("TimetableClient does not guess academic year when timetable page lacks context", async () => {
  const groupUrl = `${TT_BASE}/index/grouptt/gr/8919`;
  const fakeHttp = new FakeHttpClient({
    get: {
      [groupUrl]: {
        status: 200,
        body: `<html><body><div>Расписание занятий</div></body></html>`,
      },
    },
  });

  const tt = new TimetableClient();
  tt.http = fakeHttp;

  await assert.rejects(
    () => tt.getGroupSchedule(8919),
    (error) =>
      error?.name === "ParseError" &&
      error?.message === "TT page does not expose the current academic year",
  );
});

test("TimetableClient rejects invalid public inputs before network access", async () => {
  const fakeHttp = new FakeHttpClient();
  const tt = new TimetableClient();
  tt.http = fakeHttp;

  await assert.rejects(() => tt.searchGroups("   "), /at least 1/u);
  await assert.rejects(() => tt.searchTeachers(""), /at least 1/u);
  await assert.rejects(() => tt.searchRooms("E1"), /at least 3/u);
  await assert.rejects(() => tt.getGroupSchedule(0), /positive integer/u);
  await assert.rejects(
    () => tt.getTeacherSchedule(1, { periods: [] }),
    /At least one period/u,
  );
  await assert.rejects(
    () => tt.getRoomSchedule(1, { periods: [1, 1] }),
    /Duplicate academic period/u,
  );
  await assert.rejects(
    () => tt.getGroupSchedule(1, { periods: [99] }),
    /Invalid academic period/u,
  );
  assert.equal(fakeHttp.calls.get.size, 0);
  assert.equal(fakeHttp.calls.post.size, 0);
});

test("TimetableClient ingests real teacher and room pages through public methods", async () => {
  const teacherHtml = await readFile(
    new URL("./fixtures/tt/teacher-schedules/teacher-543-period-1.html", import.meta.url),
    "utf8",
  );
  const roomHtml = await readFile(
    new URL("./fixtures/tt/room-schedules/room-811-period-1.html", import.meta.url),
    "utf8",
  );
  const teacherUrl = `${TT_BASE}/index/techtt/tech/543`;
  const roomUrl = `${TT_BASE}/index/audtt/aud/811`;
  const postKey = (url) => `${url}|${JSON.stringify({ htype: "1" })}`;
  const fakeHttp = new FakeHttpClient({
    get: {
      [teacherUrl]: { status: 200, body: teacherHtml },
      [roomUrl]: { status: 200, body: roomHtml },
    },
    post: {
      [postKey(teacherUrl)]: { status: 200, body: teacherHtml },
      [postKey(roomUrl)]: { status: 200, body: roomHtml },
    },
  });
  const tt = new TimetableClient({ cache: 10_000 });
  tt.http = fakeHttp;

  const teacherSchedule = await tt.getTeacherSchedule(543, { periods: [1] });
  const roomSchedule = await tt.getRoomSchedule(811, { periods: [1] });

  assert.deepEqual(teacherSchedule.owner, {
    type: "teacher",
    teacher: {
      id: 543,
      name: "Митрофанова Марина Юрьевна",
      degree: "кандидат экономических наук",
    },
  });
  assert.deepEqual(roomSchedule.owner, {
    type: "room",
    room: { id: 811, name: "Е-302" },
  });
  assert.ok(teacherSchedule.series().length > 0);
  assert.ok(roomSchedule.series().length > 0);
  assert.ok(tt.repository.getSeries().some((lesson) => {
    const kinds = new Set(lesson.sources.map((source) => source.owner.type));
    return kinds.has("teacher") && kinds.has("room");
  }));
  assert.equal(fakeHttp.count("post", postKey(teacherUrl)), 1);
  assert.equal(fakeHttp.count("post", postKey(roomUrl)), 1);
});
