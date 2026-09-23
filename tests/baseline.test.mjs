// Baseline behaviour of the export (synthetic fixtures). These pin v7.4 behaviour that v7.5 must
// NOT change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";

test("harness: a simple room exports its strip, C2 net and markup_convention", () => {
  const j = project();
  const r = j.room("Bathroom", "2.4");
  j.rect("condition2", r, 0, 0, 2, 3);            // footprint 6, perimeter 10 → surface 12 + 24 = 36
  j.rect("ceiling_strip", r, 0, 0, 1, 1);         // 1
  j.line("wall_strip", r, 0, 0, 2, 0);            // 2 × 2.4 = 4.8
  const e = exportFromProject(j.p);
  const room = e.rooms.find((x) => x.name === "Bathroom");
  assert.equal(room.condition2_surface_m2, 36);
  assert.equal(room.condition2_net_m2, 30.2);
  assert.equal(room.condition2_m2, room.condition2_net_m2);
  assert.equal(room.wall_strip_m2, 4.8);
  assert.match(e.markup_convention, /^BML v7\.0 — /);
  assert.equal(typeof e.job, "string");
});

test("C2 with no strip and net > 0 raises no C2 flag", () => {
  const j = project();
  const r = j.room("Lounge");
  j.rect("condition2", r, 0, 0, 4, 4);
  const e = exportFromProject(j.p);
  assert.ok(!e.flags.some((f) => f.code.startsWith("C2_NET")));
});
