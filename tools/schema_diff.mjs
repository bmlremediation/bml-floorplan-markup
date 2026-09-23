// Generates the v7.4 → v7.5 export-schema diff from REAL exports, not from memory.
//   node tools/schema_diff.mjs <path-to-v7.4-quantities.js> [projectsDir]
// v7.4 exports come from the v7.4 quantities module (the prep commit 49bcf3e is a pure extraction
// of v7.4's logic); v7.5 exports from src/. Inputs: synthetic fixtures that exercise every v7.5
// feature, plus (optionally) a local folder of real PROJECT files. Prints a markdown table of every
// path added / removed / re-typed / value-changed, with the JSON types seen on each side.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { diff } from "../tests/jsondiff.mjs";
import { project } from "../tests/fixtures.mjs";
import * as v75 from "../src/quantities.js";

const v74 = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const exp = (Q, d, opts) => Q.makeQuantities(Q.migrateProjectFile(d)).buildExport(opts);

function synthetic() {
  const j = project({ jobName: "SYNTHETIC schema diff", property: { ch: true } });
  const wet = j.room("Wet room", "2.4");
  j.rect("condition2", wet, 0, 0, 2, 1.5);
  for (const [a, b, c, d] of [[0, 0, 2, 0], [2, 0, 2, 1.5], [2, 1.5, 0, 1.5], [0, 1.5, 0, 0]]) j.line("wall_strip", wet, a, b, c, d, { insulationRemoval: true });
  j.rect("ceiling_strip", wet, 0, 0, 2, 1.5);
  j.rect("contingent", wet, 0, 0, 0.1, 4);
  j.line("containment", wet, 0, 0, 1.2, 0);
  j.line("containment", wet, 0, 1, 0, 3.35);
  const stair = j.room("Stair", "2.4");
  j.rect("condition2", stair, 5, 0, 2, 1.5);
  for (const [a, b, c, d] of [[5, 0, 7, 0], [7, 0, 7, 1.5], [7, 1.5, 5, 1.5], [5, 1.5, 5, 0]]) j.line("wall_strip", stair, a, b, c, d, { hgt: 4.8 });
  const up = { id: "f2", name: "L1", calLine: null, scale: null, imgW: 2000, imgH: 1500 };
  j.p.floors.push(up);
  const r2 = j.room("Upper", "2.4", { floorId: "f2" });
  j.line("containment", r2, 0, 0, 1, 0, { floorId: "f2" });
  const unset = project({ jobName: "SYNTHETIC unset CH" });
  unset.rect("condition2", unset.room("Kitchen"), 0, 0, 3, 3);
  return [["synthetic: all v7.5 features", j.p], ["synthetic: CH unset", unset.p]];
}

const cases = synthetic();
const dir = process.argv[3];
if (dir && fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) cases.push([`real PROJECT file #${cases.length - 1}`, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]);

const type = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const rows = new Map();
const flagCodes = { v74: new Set(), v75: new Set() };
const refused = [];
const note = (key, side, v) => { const r = rows.get(key); r[side].add(type(v)); };
for (const [name, d] of cases) {
  const a = exp(v74, d), live = exp(v75, d);
  let re = null;
  try { re = v75.reexportFromProject(d).exp; } catch (e) { refused.push(`${name}: ${e.message}`); }
  for (const f of a.flags) flagCodes.v74.add(f.code);
  for (const f of [...live.flags, ...(re ? re.flags : [])]) flagCodes.v75.add(f.code);
  for (const [b, how] of [[live, "live"], ...(re ? [[re, "re-export"]] : [])]) {
    for (const x of diff({ ...a, flags: [] }, { ...b, flags: [] })) {
      const key = `${x.op} ${x.path.replace(/\[\d+\]/g, "[]")}`;
      if (!rows.has(key)) rows.set(key, { a: new Set(), b: new Set(), cases: new Set(), sample: x.op === "added" ? x.b : x.op === "removed" ? x.a : `${JSON.stringify(x.a)} → ${JSON.stringify(x.b)}` });
      rows.get(key).cases.add(name.startsWith("real") ? "real" : name); rows.get(key).cases.add(how);
      if ("a" in x) note(key, "a", x.a);
      if ("b" in x) note(key, "b", x.b);
    }
  }
}
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 70 ? s.slice(0, 67) + "…" : s; };
console.log(`Cases: ${cases.length} (${cases.filter((c) => c[0].startsWith("real")).length} real PROJECT files), each exported by v7.4 and by v7.5 (live AND re-export).\n`);
console.log("| op | path | v7.4 type | v7.5 type | seen in | sample |\n|---|---|---|---|---|---|");
for (const [k, r] of [...rows.entries()].sort()) {
  const [op, p] = k.split(" ");
  console.log(`| ${op} | \`${p}\` | ${[...r.a].join("/") || "—"} | ${[...r.b].join("/") || "—"} | ${[...r.cases].sort().join(", ")} | ${short(r.sample).replace(/\|/g, "\|")} |`);
}
console.log(`\nRe-export refusals (expected — no file written): ${refused.join(" · ") || "none"}`);
console.log(`Flag codes new in v7.5: ${[...flagCodes.v75].filter((c) => !flagCodes.v74.has(c)).sort().join(", ") || "none"}`);
console.log(`Flag codes seen in v7.4 and absent from v7.5 across these cases: ${[...flagCodes.v74].filter((c) => !flagCodes.v75.has(c)).sort().join(", ") || "none"}`);
