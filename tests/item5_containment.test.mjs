// v7.5 item 5 — containment barrier lengths (CO §5 acceptance; quantify side is already built).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";
import { makeQuantities, migrateProjectFile } from "../src/quantities.js";

const lengths = (room) => room.containment_barriers.map((b) => b.length_m);

test("1: two barriers, 1.20 m and 2.35 m → count 2 and both lengths", () => {
  const j = project();
  const r = j.room("Bathroom");
  j.line("containment", r, 0, 0, 1.2, 0);
  j.line("containment", r, 0, 1, 0, 3.35);
  const room = exportFromProject(j.p).rooms[0];
  assert.equal(room.containment_count, 2);
  assert.deepEqual(lengths(room), [1.2, 2.35]);
  assert.ok(room.containment_barriers.every((b) => "id" in b && "floor" in b));
});

test("3: deleting a barrier drops count and array together", () => {
  const j = project();
  const r = j.room("Bathroom");
  j.line("containment", r, 0, 0, 1.2, 0);
  j.line("containment", r, 0, 1, 0, 3.35);
  j.p.shapes.splice(0, 1);
  const room = exportFromProject(j.p).rooms[0];
  assert.equal(room.containment_count, 1);
  assert.deepEqual(lengths(room), [2.35]);
});

test("invariant len(containment_barriers) == containment_count on every room, incl. Unassigned", () => {
  const j = project();
  const a = j.room("A"), b = j.room("B");
  j.line("containment", a, 0, 0, 1, 0);
  j.line("containment", null, 0, 0, 2, 0);
  j.rect("condition2", b, 0, 0, 2, 2);
  for (const room of exportFromProject(j.p).rooms) assert.equal(room.containment_barriers.length, room.containment_count, room.name);
});

test("uncalibrated floor → {length_m: null} + CONTAINMENT_LENGTH_MISSING, never dropped", () => {
  const j = project();
  const r = j.room("Upstairs");
  j.line("containment", r, 0, 0, 1, 0);
  j.p.floors[0].scale = null;
  const e = makeQuantities(migrateProjectFile(j.p)).buildExport();
  const room = e.rooms[0];
  assert.equal(room.containment_count, 1);
  assert.deepEqual(lengths(room), [null]);
  const f = e.flags.find((x) => x.code === "CONTAINMENT_LENGTH_MISSING");
  assert.equal(f.severity, "FLAG");
  assert.equal(f.room, "Upstairs");
});

test("uses the barrier's own floor calibration, not the active floor's", () => {
  const j = project();
  j.p.floors.push({ id: "f2", name: "L1", calLine: null, scale: 0.02, imgW: 2000, imgH: 1500 });
  const r = j.room("Upper", "2.4", { floorId: "f2" });
  j.line("containment", r, 0, 0, 1, 0, { floorId: "f2" });   // 100 px at 0.02 m/px = 2 m
  assert.deepEqual(lengths(exportFromProject(j.p).rooms[0]), [2]);
});
