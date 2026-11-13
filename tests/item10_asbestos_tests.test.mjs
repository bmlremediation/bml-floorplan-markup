// v7.7 — asbestos test count (Jordan 13 Nov 2026; the engine already reads property.asbestos_tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";

const exp = (property) => { const j = project({ property }); j.rect("condition2", j.room("Kitchen"), 0, 0, 3, 3); return exportFromProject(j.p); };

test("1: testing ticked with a count exports the count, no flag", () => {
  const e = exp({ asbestos_testing: true, asbestos_tests: "3" });
  assert.equal(e.property.asbestos_tests, 3);
  assert.ok(!e.flags.some((f) => f.code === "ASBESTOS_TEST_COUNT_NOT_SET"));
});

test("2: testing ticked with no count exports 0 and raises the FLAG", () => {
  const e = exp({ asbestos_testing: true });
  assert.equal(e.property.asbestos_tests, 0);
  const f = e.flags.find((x) => x.code === "ASBESTOS_TEST_COUNT_NOT_SET");
  assert.equal(f.severity, "FLAG");
});

test("3: testing not ticked exports 0 whatever the box holds, no flag", () => {
  const e = exp({ asbestos_testing: false, asbestos_tests: "4" });
  assert.equal(e.property.asbestos_tests, 0);
  assert.ok(!e.flags.some((f) => f.code === "ASBESTOS_TEST_COUNT_NOT_SET"));
});

test("4: a job saved before v7.7 (no asbestos_tests key) still exports, as 0", () => {
  assert.equal(exp({ asbestos_testing: true, asbestos_tests: undefined }).property.asbestos_tests, 0);
});

test("5: export source carries v7.7 and the v7_7_model note", () => {
  const e = exp({ asbestos_testing: true, asbestos_tests: 2 });
  assert.match(e.source, /v7\.7$/);
  assert.match(e.v7_7_model, /asbestos_tests/);
});
