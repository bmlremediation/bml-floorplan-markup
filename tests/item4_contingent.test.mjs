// v7.5 item 4 — contingent shapes: no minimum width (CO §4 acceptance).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";
import { keepDrawnShape } from "../src/quantities.js";

const rect = (cat, w, h) => ({ type: "rect", cat, x: 0, y: 0, w, h });

test("draw-end guard: contingent keeps any shape with both dimensions > 0", () => {
  for (const zoom of [0.1, 0.32, 1, 4]) {
    assert.ok(keepDrawnShape(rect("contingent", 0.5, 300), zoom), `thin strip kept at zoom ${zoom}`);
    assert.ok(keepDrawnShape(rect("contingent", 3, 300), zoom), "3 px wide (v7.4 discarded < 4 px)");
    assert.ok(!keepDrawnShape(rect("contingent", 0, 0), zoom), "3: a click (no drag) creates nothing");
    assert.ok(!keepDrawnShape(rect("contingent", 0, 300), zoom), "zero width is not a shape");
  }
});

test("draw-end guard: other types discard only under 1 SCREEN px (a click)", () => {
  assert.ok(!keepDrawnShape(rect("condition2", 0.5, 0.5), 1));
  assert.ok(keepDrawnShape(rect("condition2", 1, 1), 1));
  assert.ok(keepDrawnShape(rect("condition2", 3, 200), 1), "v7.4 discarded this (≤ 4 image px)");
  assert.ok(!keepDrawnShape(rect("condition2", 3, 200), 0.25), "at 25 % zoom 3 image px is < 1 screen px");
  assert.ok(!keepDrawnShape({ type: "line", cat: "wall_strip", x1: 0, y1: 0, x2: 0.4, y2: 0 }, 1));
  assert.ok(keepDrawnShape({ type: "line", cat: "wall_strip", x1: 0, y1: 0, x2: 2, y2: 0 }, 1));
});

function stripJob(w, l) {
  const j = project();
  const r = j.room("Hall");
  j.rect("contingent", r, 0, 0, w, l);
  return exportFromProject(j.p).rooms.find((x) => x.name === "Hall");
}

test("1: a 0.1 m × 4 m contingent strip exports 0.4 m²", () => {
  const room = stripJob(0.1, 4);
  assert.equal(room.contingent_m2, 0.4);
  assert.deepEqual(room.contingent, { shapes: [{ w: 0.1, l: 4, m2: 0.4 }], m2: 0.4, working: "(0.1×4) = 0.4 m²" });
});

test("2: a 0.05 m × 2 m contingent strip exports 0.1 m²", () => {
  const room = stripJob(0.05, 2);
  assert.equal(room.contingent_m2, 0.1);
  assert.equal(room.contingent.shapes[0].m2, 0.1);
});

test("rooms with no contingent carry the empty block; contingent_m2 unchanged in meaning", () => {
  const j = project();
  const r = j.room("Lounge");
  j.rect("condition2", r, 0, 0, 3, 3);
  j.rect("contingent", r, 0, 0, 1, 1);
  j.rect("contingent", r, 0, 2, 1, 1);
  const room = exportFromProject(j.p).rooms[0];
  assert.equal(room.contingent_m2, 2);
  assert.equal(room.contingent.m2, room.contingent_m2);
  const k = project(); k.room("Empty"); k.rect("condition2", 1, 0, 0, 2, 2);
  assert.deepEqual(exportFromProject(k.p).rooms[0].contingent, { shapes: [], m2: 0, working: "no contingent drawn" });
});
