// v7.6 — contents inventory: Not selected / Included / Optional (Jordan 13 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "./fixtures.mjs";
import { exportFromProject } from "./harness.mjs";

const exp = (property) => { const j = project({ property }); j.rect("condition2", j.room("Kitchen"), 0, 0, 3, 3); return exportFromProject(j.p); };

test("1: not selected exports false", () => {
  assert.equal(exp({}).property.contents_inventory, false);
  assert.equal(exp({ contents_inventory: "" }).property.contents_inventory, false);
});

test("2: included and optional export as strings", () => {
  assert.equal(exp({ contents_inventory: "included" }).property.contents_inventory, "included");
  assert.equal(exp({ contents_inventory: "optional" }).property.contents_inventory, "optional");
});

test("3: a job saved before v7.6 keeps its meaning: true -> included, false -> not selected", () => {
  assert.equal(exp({ contents_inventory: true }).property.contents_inventory, "included");
  assert.equal(exp({ contents_inventory: false }).property.contents_inventory, false);
});

test("4: junk values read as not selected; the choice survives a PROJECT round trip", () => {
  assert.equal(exp({ contents_inventory: "yes" }).property.contents_inventory, false);
  const j = project({ property: { contents_inventory: "optional" } });
  j.room("Kitchen");
  assert.equal(exportFromProject(JSON.parse(JSON.stringify(j.p))).property.contents_inventory, "optional");
});

test("5: the v7_6_model note is carried", () => {
  const e = exp({ contents_inventory: "included" });
  assert.match(e.v7_6_model, /RE-TYPED/);
});
