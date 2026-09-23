// v7.5 item 6 — full-strip signature (CO §6 acceptance).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";

// Room 2.0 × 1.5 m, CH 2.4: C2 surface = 2 × 3.0 + 7.0 × 2.4 = 22.8 m²
function wetRoom({ c2 = [0, 0, 2, 1.5], wallH = "full", ceiling = true, floor = true } = {}) {
  const j = project();
  const r = j.room("Ensuite", "2.4");
  j.rect("condition2", r, ...c2);
  for (const [x1, y1, x2, y2] of [[0, 0, 2, 0], [2, 0, 2, 1.5], [2, 1.5, 0, 1.5], [0, 1.5, 0, 0]])
    j.line("wall_strip", r, x1, y1, x2, y2, { hgt: wallH });            // 7.0 m run
  if (ceiling) j.rect("ceiling_strip", r, 0, 0, 2, 1.5);                  // 3.0
  if (floor) j.rect("floor_strip", r, 0, 0, 2, 1.5, { floorCov: "tiles" }); // 3.0
  const e = exportFromProject(j.p);
  return { e, room: e.rooms.find((x) => x.name === "Ensuite"), codes: e.flags.map((f) => f.code) };
}

test("1a: wall 16.8 + ceiling 3.0 + floor 3.0 = surface 22.8 → net 0, full_strip, new flag, no hard error", () => {
  const { room, codes, e } = wetRoom();
  assert.equal(room.condition2_surface_m2, 22.8);
  assert.equal(room.wall_strip_m2, 16.8);
  assert.equal(room.condition2_net_m2, 0);
  assert.equal(room.condition2_m2, 0);
  assert.equal(room.condition2.net_m2, 0);
  assert.equal(room.full_strip, true);
  assert.equal(room.condition2.full_strip, true);
  assert.ok(codes.includes("C2_FULL_STRIP_SIGNATURE"));
  assert.ok(!codes.includes("C2_NET_NOT_POSITIVE"));
  const f = e.flags.find((x) => x.code === "C2_FULL_STRIP_SIGNATURE");
  assert.equal(f.severity, "FLAG");                 // non-blocking (the app's WARN level)
  assert.equal(f.room, "Ensuite");
  assert.match(f.message, /Ensuite/);
  assert.match(f.message, /double-height/);
  assert.ok(!("full_strip_m2" in room), "the retired full_strip_m2 stays absent");
});

test("1b: C2 drawn smaller than the strips (net would be negative) → still exactly 0; gross kept for audit", () => {
  const { room, codes } = wetRoom({ c2: [0, 0, 1.9, 1.4] });
  assert.equal(room.condition2_net_m2, 0);
  assert.ok(!Object.is(room.condition2_net_m2, -0));
  assert.equal(room.full_strip, true);
  assert.ok(room.condition2_surface_m2 < 22.8, "surface is the true gross");
  assert.deepEqual(room.condition2.deductions, { wall_strip: 16.8, ceiling_strip: 3, floor_strip: 3 });
  assert.match(room.condition2.working, /full-strip signature/);
  assert.ok(!codes.includes("C2_NET_NOT_POSITIVE"));
});

test("signature does not need a floor strip (matches quantify's carve-out)", () => {
  const { room } = wetRoom({ c2: [0, 0, 1.2, 1.0], floor: false });
  assert.equal(room.full_strip, true);
  assert.equal(room.condition2_net_m2, 0);
});

test("2: stairwell — walls at 4.8 m (33.6 m²), NO ceiling strip → −10.8, C2_NET_NOT_POSITIVE ERROR as today", () => {
  const { room, codes, e } = wetRoom({ wallH: 4.8, ceiling: false, floor: false });
  assert.equal(room.wall_strip_m2, 33.6);
  assert.equal(room.condition2_net_m2, -10.8);
  assert.equal(room.full_strip, false);
  assert.equal(room.condition2.full_strip, false);
  assert.equal(e.flags.find((f) => f.code === "C2_NET_NOT_POSITIVE").severity, "ERROR");
  assert.ok(!codes.includes("C2_FULL_STRIP_SIGNATURE"));
});

test("3: a normal room (net > 0) → full_strip false, no new flag", () => {
  const j = project();
  const r = j.room("Lounge", "2.4");
  j.rect("condition2", r, 0, 0, 4, 4);
  j.line("wall_strip", r, 0, 0, 1, 0);
  j.rect("ceiling_strip", r, 0, 0, 1, 1);
  const e = exportFromProject(j.p);
  assert.equal(e.rooms[0].full_strip, false);
  assert.equal(e.rooms[0].condition2_net_m2, 67);   // 2×16 + 16×2.4 − 2.4 − 1
  assert.ok(!e.flags.some((f) => ["C2_FULL_STRIP_SIGNATURE", "C2_NET_NOT_POSITIVE"].includes(f.code)));
});

test("a room with no C2 drawn is never a signature room", () => {
  const j = project();
  const r = j.room("Laundry");
  j.line("wall_strip", r, 0, 0, 2, 0);
  j.rect("ceiling_strip", r, 0, 0, 1, 1);
  const room = exportFromProject(j.p).rooms[0];
  assert.equal(room.full_strip, false);
  assert.equal(room.condition2, null);
});
