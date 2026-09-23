// Regression over REAL job PROJECT files. Those files are client data and live ONLY in the
// gitignored public/test-assets/ (see CLAUDE.md — the repo is public). When they are absent this
// suite skips; it is run locally before every commit.
//
// public/test-assets/projects/*.json          — real PROJECT files
// public/test-assets/baseline_v7_4/*.json     — the v7.4 export of each, captured headlessly
//                                               BEFORE any v7.5 behaviour change
//
// Every difference between the v7.4 baseline and today's export must be explained by the v7.5
// change order (CO-2026-09-22-MARKUP): additive keys, the version string, and the full-strip
// signature clamp. Anything else is a regression.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exportFromProject, readJson } from "./harness.mjs";
import { unexplained } from "./v75diff.mjs";

const DIR = "public/test-assets/projects";
const BASE = "public/test-assets/baseline_v7_4";
const files = fs.existsSync(DIR) && fs.existsSync(BASE) ? fs.readdirSync(DIR).filter((f) => fs.existsSync(`${BASE}/${f}`)) : [];

test("real-job corpus: every v7.4 → v7.5 difference is explained by the CO", { skip: files.length ? false : "no local fixtures" }, () => {
  for (const f of files) {
    const after = exportFromProject(readJson(`${DIR}/${f}`));
    const bad = unexplained(readJson(`${BASE}/${f}`), after);
    assert.deepEqual(bad, [], `${f}: unexplained differences`);
  }
});

test("BMLJ00685 garage regression guard (footprint / perimeter / surface / net)", { skip: fs.existsSync(`${DIR}/BMLJ00685_12.json`) ? false : "no local fixture" }, () => {
  const g = exportFromProject(readJson(`${DIR}/BMLJ00685_12.json`)).rooms.find((r) => r.name === "garage");
  assert.equal(g.condition2.footprint_m2, 20.82);
  assert.equal(g.condition2.height_groups[0].perimeter_m, 22.03);
  assert.equal(g.condition2.surface_m2, 94.51);
  assert.equal(g.condition2_net_m2, 49.23);
});
