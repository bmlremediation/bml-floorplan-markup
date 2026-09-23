// v7.5 item 8 — Open PROJECT.json → Export quantities (CO §8 acceptance).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { project } from "./fixtures.mjs";
import { reexportFromProject, ReexportError, makeQuantities, migrateProjectFile } from "../src/quantities.js";
import { readJson } from "./harness.mjs";
import { unexplained } from "./v75diff.mjs";

const sample = () => { const j = project({ jobName: "TEST reexport" }); const r = j.room("Kitchen"); j.rect("condition2", r, 0, 0, 3, 3); j.line("containment", r, 0, 0, 2, 0); return j.p; };

test("recomputes through the live export path and records provenance", () => {
  const p = sample();
  const { exp } = reexportFromProject(JSON.stringify(p));
  const live = makeQuantities(migrateProjectFile(p)).buildExport();
  assert.equal(exp.reexported_from_project, true);
  assert.equal(exp.project_saved_at, p.savedAt);
  assert.equal(live.reexported_from_project, false);
  assert.equal(live.project_saved_at, null);
  const strip = (e) => ({ ...e, exported_at: 0, reexported_from_project: 0, project_saved_at: 0 });
  assert.deepEqual(strip(exp), strip(live), "same numbers as a live export");
  assert.ok(Array.isArray(exp.rooms[0].containment_barriers), "carries v7.5 keys (recomputed, not copied)");
});

test("an old file's new v7.5 inputs export as unset", () => {
  const p = sample(); delete p.property.ch;
  const { exp } = reexportFromProject(p);
  assert.equal(exp.property.ch, null);
  assert.ok(exp.flags.some((f) => f.code === "CH_FLAG_NOT_SET"));
  assert.deepEqual(exp.rooms[0].containment_barriers.map((b) => b.length_m), [2]);
});

test("project_saved_at is null when the file carries no timestamp", () => {
  const p = sample(); delete p.savedAt;
  assert.equal(reexportFromProject(p).exp.project_saved_at, null);
});

test("4: plan image stripped → clear error naming it, nothing produced", () => {
  const p = sample(); p.floors[0].imgW = 0; p.floors[0].imgH = 0;
  assert.throws(() => reexportFromProject(p), (e) => e instanceof ReexportError && /NO PLAN IMAGE/.test(e.message) && /floor "G"/.test(e.message));
});

test("calibration absent → clear error naming it", () => {
  const p = sample(); p.floors[0].scale = null;
  assert.throws(() => reexportFromProject(p), (e) => e instanceof ReexportError && /NO CALIBRATION/.test(e.message));
});

test("an uncalibrated EMPTY second floor does not block the export", () => {
  const p = sample(); p.floors.push({ id: "f2", name: "L1", calLine: null, scale: null, imgW: 0, imgH: 0 });
  assert.equal(reexportFromProject(p).exp.rooms.length, 1);
});

test("not a PROJECT file / not JSON → clear error", () => {
  assert.throws(() => reexportFromProject("{nope"), ReexportError);
  assert.throws(() => reexportFromProject({ format: "something-else" }), ReexportError);
});

test("3: a pre-v7.0 flat v2 file (embedded image, top-level calibration) exports with migration intact", () => {
  const p = sample();
  const legacy = { format: "bml-markup-project", version: 2, jobName: "legacy", rooms: p.rooms.map(({ floorId, ...r }) => r),
    shapes: p.shapes.map(({ floorId, ...s }) => s), calLine: p.floors[0].calLine, scale: p.floors[0].scale,
    img: { src: "data:image/png;base64,AAAA", w: 2000, h: 1500 }, property: { afd_units: "2" } };
  const { exp } = reexportFromProject(legacy);
  assert.equal(exp.rooms[0].condition2_surface_m2, 46.8);   // 2 × 9 + 12 × 2.4
  assert.ok(exp.flags.some((f) => f.code === "EQUIPMENT_LEGACY_COUNTS"), "legacy counts flagged, not dropped");
  assert.equal(exp.property.equipment_legacy.afd_units, 2);
});

const DIR = "public/test-assets/projects", BASE = "public/test-assets/baseline_v7_4";
const local = fs.existsSync(DIR) && fs.existsSync(BASE);

test("3 (real files): every local PROJECT file v2–v7 re-exports without a crash; differences vs v7.4 all explained",
  { skip: local ? false : "no local fixtures" }, () => {
    for (const f of fs.readdirSync(DIR)) {
      const { exp } = reexportFromProject(fs.readFileSync(`${DIR}/${f}`, "utf8"));
      const bad = unexplained(readJson(`${BASE}/${f}`), exp).filter((d) => !["reexported_from_project", "project_saved_at"].includes(d.path));
      assert.deepEqual(bad, [], f);
    }
  });

test("1+2 (real file): BMLJ00775 PROJECT → quantities; every v7.4 figure identical",
  { skip: fs.existsSync("public/test-assets/BMLJ00775_PROJECT.json") ? false : "no local fixture" }, () => {
    const { exp } = reexportFromProject(fs.readFileSync("public/test-assets/BMLJ00775_PROJECT.json", "utf8"));
    assert.equal(exp.reexported_from_project, true);
    assert.equal(exp.project_saved_at, "2026-09-18T01:08:07.742Z");
    assert.equal(exp.rooms.length, 9);
  });
