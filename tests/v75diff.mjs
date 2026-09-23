// v7.4 → v7.5 difference classifier: returns every difference NOT explained by CO-2026-09-22-MARKUP.
import { diff } from "./jsondiff.mjs";

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
