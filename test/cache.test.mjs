import test from "node:test";
import assert from "node:assert/strict";

import { LkClient } from "../dist/lk/client.js";
import { TtClient } from "../dist/tt/client.js";

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
    this.bump(this.calls.getBuffer, url);
    return this.bufferResponses.get(url) ?? Buffer.alloc(0);
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

test("TtClient caches discovery/search requests and image fetches when cache is a number", async () => {
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

  const tt = new TtClient({
    cache: 10_000,
    cacheAdapter,
    blobAdapter,
  });
  tt.http = fakeHttp;

  await tt.getTeachers();
  await tt.getTeachers();
  await tt.searchTeacher({ name: "Иванов" });
  await tt.searchTeacher({ name: "Иванов" });
  await tt.searchAudience({ name: "Е-1" });
  await tt.searchAudience({ name: "Е-1" });
  await tt.getAudiences();
  await tt.getAudiences();
  await tt.searchGroup({ name: "КТ-41-24" });
  await tt.searchGroup({ name: "КТ-41-24" });
  await tt.getAudienceName(852);
  await tt.getAudienceName(852);
  await tt.getTeacherInfo(10);
  await tt.getTeacherInfo(10);
  await tt.getTeacherPhoto(10);
  await tt.getTeacherPhoto(10);
  await tt.getAudienceImage(852);
  await tt.getAudienceImage(852);
  await tt.getAudienceBlockImage(852);
  await tt.getAudienceBlockImage(852);
  await tt.getAudienceFloorplan(852);
  await tt.getAudienceFloorplan(852);

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
  assert.ok(cache["audiences:search:Е-1:1"]);
  assert.ok(cache["audiences:all:1"]);
  assert.ok(cache["audienceNames:852"]);
  assert.ok(cache["teacherInfo:10"]);
  assert.ok(cache["teacherPhotos:10"]);
  assert.ok(cache["audienceInfo:852"]);
  assert.ok(cache["audienceImages:aud:852"]);
  assert.ok(cache["audienceImages:block:852"]);
  assert.ok(cache["audienceImages:floor:852"]);

  assert.deepEqual(cacheAdapter.store.get("teacherPhotos:10"), {
    blobKey: "tt/teacher-photos/10",
  });
  assert.deepEqual(cacheAdapter.store.get("audienceImages:aud:852"), {
    blobKey: "tt/audience-images/aud:852",
  });
  assert.deepEqual(cacheAdapter.store.get("audienceImages:block:852"), {
    blobKey: "tt/audience-images/block:852",
  });
  assert.deepEqual(cacheAdapter.store.get("audienceImages:floor:852"), {
    blobKey: "tt/audience-images/floor:852",
  });
  assert.equal(blobAdapter.store.get("tt/teacher-photos/10")?.toString(), "teacher-photo");
  assert.equal(blobAdapter.store.get("tt/audience-images/aud:852")?.toString(), "audience-photo");
  assert.equal(blobAdapter.store.get("tt/audience-images/block:852")?.toString(), "block-photo");
  assert.equal(blobAdapter.store.get("tt/audience-images/floor:852")?.toString(), "floor-photo");
});

test("LkClient caches personal data, photo and group id", async () => {
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

  const lk = new LkClient({
    cache: 10_000,
    cacheAdapter,
    blobAdapter,
  });
  lk.http = fakeHttp;

  const data1 = await lk.getPersonalData();
  const data2 = await lk.getPersonalData();
  const photo1 = await lk.getPhoto();
  const photo2 = await lk.getPhoto();
  const groupId1 = await lk.getGroupId();
  const groupId2 = await lk.getGroupId();

  assert.equal(data1.lastName, "Егоров");
  assert.equal(data2.group, "КТ-41-24");
  assert.equal(photo1.toString(), "lk-photo");
  assert.equal(photo2.toString(), "lk-photo");
  assert.equal(groupId1, 8919);
  assert.equal(groupId2, 8919);

  assert.equal(fakeHttp.count("get", `${LK_BASE}/personal_data.php`), 1);
  assert.equal(fakeHttp.count("get", `${LK_BASE}/tt.php`), 1);
  assert.equal(fakeHttp.count("getBuffer", `${LK_BASE}/face.php`), 1);
  assert.deepEqual(cacheAdapter.store.get("photo:self"), {
    blobKey: "lk/photo/self",
  });
  assert.equal(blobAdapter.store.get("lk/photo/self")?.toString(), "lk-photo");
});
