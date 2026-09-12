import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import test from "node:test";

import {
  CHUVSU_CA_CERTS,
  GLOBALSIGN_GCC_R46_DV_TLS_CA_2025,
  GLOBALSIGN_ROOT_R46,
} from "../dist/common/certs.js";

test("bundles valid GlobalSign R46 chain used by ChuvSU", () => {
  const intermediate = new X509Certificate(
    GLOBALSIGN_GCC_R46_DV_TLS_CA_2025,
  );
  const root = new X509Certificate(GLOBALSIGN_ROOT_R46);

  assert.match(intermediate.subject, /GlobalSign GCC R46 DV TLS CA 2025/);
  assert.match(intermediate.issuer, /GlobalSign Root R46/);
  assert.equal(intermediate.ca, true);
  assert.equal(intermediate.verify(root.publicKey), true);
  assert.equal(root.ca, true);
  assert.equal(root.verify(root.publicKey), true);
  assert.equal(
    CHUVSU_CA_CERTS.includes(GLOBALSIGN_GCC_R46_DV_TLS_CA_2025),
    true,
  );
  assert.equal(CHUVSU_CA_CERTS.includes(GLOBALSIGN_ROOT_R46), true);
});
