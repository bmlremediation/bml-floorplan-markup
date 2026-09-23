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
import { diff } from "./jsondiff.mjs";

const DIR = "public/test-assets/projects";
const BASE = "public/test-assets/baseline_v7_4";
const files = fs.existsSync(DIR) && fs.existsSync(BASE) ? fs.readdirSync(DIR).filter((f) => fs.existsSync(`${BASE}/${f}`)) : [];

const ADDED_OK = [
  /^v7_5_model$/, /^reexported_from_project$/, /^project_saved_at$/,
  /^rooms\[\d+\]\.wall_insulation_removal_m2$/, /^rooms\[\d+\]\.wall_strip\.lines\[\d+\]\.insulation_removal$/,
  /^rooms\[\d+\]\.contingent$/, /^rooms\[\d+\]\.containment_barriers$/,
  /^rooms\[\d+\]\.full_strip$/, /^rooms\[\d+\]\.condition2\.full_strip$/,
  /^property\.wall_insulation_removal_m2$/, /^property\.ch$/, /^property\.rate_variant$/,
];
const NEW_FLAG_CODES = new Set(["CH_FLAG_NOT_SET", "C2_FULL_STRIP_SIGNATURE", "CONTAINMENT_LENGTH_MISSING"]);

export function unexplained(before, after) {
  const bad = [];
  for (const d of diff({ ...before, flags: [] }, { ...after, flags: [] })) {
    if (d.path === "exported_at" || d.path === "source") continue;
    if (d.op === "added" && ADDED_OK.some((re) => re.test(d.path))) continue;
    // full-strip signature: C2 net clamped to 0 (never negative), working string annotated
    const m = /^rooms\[(\d+)\]\.(condition2_net_m2|condition2_m2|condition2\.net_m2|condition2\.working)$/.exec(d.path);
    if (m && after.rooms[+m[1]].full_strip === true && (m[2] === "condition2.working" || (d.a <= 0 && d.b === 0))) continue;
    bad.push(d);
  }
  // flags compared as a multiset of code@room
  const key = (f) => `${f.code}@${f.room ?? ""}`;
  const bk = before.flags.map(key), ak = after.flags.map(key);
  for (const k of ak.filter((k) => !bk.includes(k))) if (!NEW_FLAG_CODES.has(k.split("@")[0])) bad.push({ op: "flag-added", k });
  for (const k of bk.filter((k) => !ak.includes(k))) {
    const [code, room] = k.split("@");
    const r = after.rooms.find((x) => x.name === room);
    if (!(code === "C2_NET_NOT_POSITIVE" && r?.full_strip === true)) bad.push({ op: "flag-removed", k });
  }
  return bad;
}

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
