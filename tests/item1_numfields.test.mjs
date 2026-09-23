// v7.5 item 1 — left-bar number boxes save as typed. The keystroke → state → export behaviour
// is browser-tested (see the PR); these pin the parts that can be checked headlessly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isValidNumText, COMMIT_MS } from "../src/numText.js";

test("valid finite numbers commit; mid-typing intermediates do not", () => {
  for (const ok of ["2.7", "0", "10", ".5", "-2", " 3.1 "]) assert.ok(isValidNumText(ok), ok);
  for (const bad of ["", "-", ".", "1.", "-.", "1e", "abc", "2.7x", "1..2"]) assert.ok(!isValidNumText(bad), bad);
  assert.ok(isValidNumText("", true), "allowEmpty lets a blank commit (C2 height override = room default)");
});

test("debounce is within the CO's 150 ms", () => assert.ok(COMMIT_MS > 0 && COMMIT_MS <= 150));

test("every numeric <input> in App.jsx is a NumField or explicitly exempted", () => {
  const src = fs.readFileSync("src/App.jsx", "utf8");
  const inputs = src.match(/<input\b[^>]*>/gs) || [];
  const numeric = inputs.filter((t) => /inputMode="(decimal|numeric)"|type="number"/.test(t));
  const stray = numeric.filter((t) => !/data-numfield-exempt=/.test(t));
  assert.deepEqual(stray, []);
  assert.ok((src.match(/<NumField\b/g) || []).length >= 8, "room CH/EF/PF, property numbers, cabinetry, C2 override, heat mats");
});
