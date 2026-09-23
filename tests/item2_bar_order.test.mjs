// v7.5 item 2 — Condition 2 first in the left bar; everything else in v7.4 order; ids/exports untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATS, LEFT_BAR_CATS } from "../src/quantities.js";

const V74_ORDER = ["floor_strip", "ceiling_strip", "condition2", "cabinetry", "contingent", "wall_strip", "containment", "roof_void_decon", "floor_protection"];

test("CATS (ids + order that drive the export) is unchanged from v7.4", () => {
  assert.deepEqual(CATS.map((c) => c.id), V74_ORDER);
});

test("left bar: Condition 2 first, the rest in v7.4 relative order", () => {
  assert.deepEqual(LEFT_BAR_CATS.map((c) => c.id), ["condition2", ...V74_ORDER.filter((id) => id !== "condition2")]);
  assert.equal(new Set(LEFT_BAR_CATS).size, CATS.length);
});
