// v7.5 item 3 — wall-lining strip: remove insulation from the wall cavity (CO §3 acceptance).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";

function job({ ins = true } = {}) {
  const j = project();
  const r = j.room("External wall room", "2.4");
  j.rect("condition2", r, 0, 0, 4, 3);
  j.rect("ceiling_strip", r, 0, 0, 2, 2, { insulation: true, insulationType: "batts" });   // roof-void/ceiling insulation stays separate
  const a = j.line("wall_strip", r, 0, 0, 4, 0, { insulationRemoval: ins });              // 4.0 m × 2.4 = 9.6
  return { j, r, a };
}
const room = (e) => e.rooms.find((x) => x.name === "External wall room");

test("1: a 4.0 m full-height line with insulation → line true, room 9.6, property 9.6; wall_strip_m2 unchanged", () => {
  const on = exportFromProject(job({ ins: true }).j.p), off = exportFromProject(job({ ins: false }).j.p);
  assert.equal(room(on).wall_strip.lines[0].insulation_removal, true);
  assert.equal(room(on).wall_insulation_removal_m2, 9.6);
  assert.equal(on.property.wall_insulation_removal_m2, 9.6);
  assert.equal(room(on).wall_strip_m2, 9.6);
  assert.equal(room(off).wall_strip_m2, room(on).wall_strip_m2);
  assert.equal(room(off).wall_strip.lines[0].insulation_removal, false);
  assert.equal(room(off).wall_insulation_removal_m2, 0);
  assert.equal(off.property.wall_insulation_removal_m2, 0);
  assert.match(room(on).wall_strip.working, /insulation: 4×2\.4 = 9\.6 m²/);
  assert.doesNotMatch(room(off).wall_strip.working, /insulation:/);
});

test("2: a second, unticked line leaves the insulation total unchanged", () => {
  const { j, r } = job();
  j.line("wall_strip", r, 0, 0, 0, 3);
  const e = exportFromProject(j.p);
  assert.equal(room(e).wall_insulation_removal_m2, 9.6);
  assert.equal(room(e).wall_strip_m2, 16.8);
  assert.deepEqual(room(e).wall_strip.lines.map((l) => l.insulation_removal), [true, false]);
});

test("3: a skirting-only line always exports insulation_removal false (even if the flag is set in data)", () => {
  const { j, r } = job({ ins: false });
  j.line("wall_strip", r, 0, 3, 4, 3, { skirtingOnly: true, insulationRemoval: true });
  const e = exportFromProject(j.p);
  assert.equal(room(e).wall_strip.lines[1].insulation_removal, false);
  assert.equal(room(e).wall_insulation_removal_m2, 0);
});

test("4: property.insulation_removal is identical with the toggle on and off (never merged)", () => {
  const on = exportFromProject(job({ ins: true }).j.p), off = exportFromProject(job({ ins: false }).j.p);
  assert.deepEqual(on.property.insulation_removal, off.property.insulation_removal);
  assert.equal(on.property.insulation_removal.total_m2, 4);
});

test("5: the toggle survives a PROJECT save → reload round trip; legacy lines export false", () => {
  const { j } = job();
  const e = exportFromProject(JSON.parse(JSON.stringify(j.p)));
  assert.equal(room(e).wall_strip.lines[0].insulation_removal, true);
  const legacy = job();
  delete legacy.a.insulationRemoval;
  assert.equal(room(exportFromProject(legacy.j.p)).wall_strip.lines[0].insulation_removal, false);
});

test("sums over rooms into the property total", () => {
  const { j } = job();
  const r2 = j.room("Second");
  j.line("wall_strip", r2, 10, 0, 12, 0, { insulationRemoval: true, hgt: 1.2 });   // 2 × 1.2 = 2.4
  assert.equal(exportFromProject(j.p).property.wall_insulation_removal_m2, 12);
});
