// v7.5 item 7 — Claims Hero choice (CO §7 acceptance; quantify reads property.rate_variant already).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";

const exp = (opts) => { const j = project(opts); j.rect("condition2", j.room("Kitchen"), 0, 0, 3, 3); return exportFromProject(j.p); };

test("1: unset → ch null, rate_variant null, CH_FLAG_NOT_SET; export still produced", () => {
  const e = exp();
  assert.equal(e.property.ch, null);
  assert.equal(e.property.rate_variant, null);
  const f = e.flags.find((x) => x.code === "CH_FLAG_NOT_SET");
  assert.equal(f.severity, "FLAG");
  assert.match(f.message, /Claims Hero job\?/);
});

test("2: Yes → ch true, rate_variant \"ch\"", () => {
  const e = exp({ property: { ch: true } });
  assert.equal(e.property.ch, true);
  assert.equal(e.property.rate_variant, "ch");
  assert.ok(!e.flags.some((f) => f.code === "CH_FLAG_NOT_SET"));
});

test("3: No → ch false, rate_variant \"non_ch\"", () => {
  const e = exp({ property: { ch: false } });
  assert.equal(e.property.ch, false);
  assert.equal(e.property.rate_variant, "non_ch");
});

test("4: a job named \"Claims Hero – test\" with the choice unset stays null (no inference)", () => {
  for (const jobName of ["Claims Hero – test", "CH - 14 Sample St BMLJ00999"]) {
    const e = exp({ jobName });
    assert.equal(e.property.ch, null);
    assert.equal(e.job, jobName, "job stays the title string");
  }
});

test("5: the choice survives a PROJECT round trip; never writes ac_variant; junk values read as unset", () => {
  const j = project({ property: { ch: true } });
  j.room("Kitchen");
  assert.equal(exportFromProject(JSON.parse(JSON.stringify(j.p))).property.ch, true);
  assert.ok(!("ac_variant" in exportFromProject(j.p).property));
  assert.equal(exp({ property: { ch: "yes" } }).property.ch, null);
});
