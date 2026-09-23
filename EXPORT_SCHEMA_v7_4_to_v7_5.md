# Export schema diff — markup app v7.4 → v7.5 (CO-2026-09-22-MARKUP)

**Removed / renamed / re-typed: none.** Every v7.4 key is still present, under the same name, with the same JSON type. `job` is still a string. `markup_convention` is unchanged (`BML v7.0 — MULTI-FLOOR; C2 NETTED; INSULATION DE-DUPLICATED; EQUIPMENT MARKERS; FLOOR COVERINGS`), so quantify's MAJOR-7 handshake is untouched. A v7.4 consumer reads a v7.5 export unchanged.

**How this was produced:** generated, not written from memory. `tools/schema_diff.mjs` exports the same jobs twice: once through the v7.4 quantities logic (commit `49bcf3e`, a pure extraction of v7.4 with no behaviour change) and once through v7.5, both as a live export and through "Open PROJECT.json → Export quantities". It then diffs every path. The inputs were 2 synthetic jobs that exercise every v7.5 feature, plus **38 real PROJECT files** (file versions v2 → v7, kept locally and never committed). The appendix below is the generator's output as is. Re-run with:

```
git worktree add ../v74ref 49bcf3e
node tools/schema_diff.mjs ../v74ref/src/quantities.js [folder-of-PROJECT-files]
```

## Added keys

| Path | Type | Meaning | CO item |
|---|---|---|---|
| `v7_5_model` | string | Descriptive summary of the v7.5 additions, in the same style as the existing `*_model` strings. | all |
| `reexported_from_project` | boolean | `true` when the file was recomputed from a PROJECT file via **Open PROJECT.json → Export quantities**; `false` on a live export. | 8 |
| `project_saved_at` | string \| null | On a re-export: the PROJECT file's own `savedAt` (null if the file has none). Always null on a live export. | 8 |
| `rooms[].wall_strip.lines[].insulation_removal` | boolean | This wall-strip line also removes insulation from the wall cavity. Always `false` on a `skirtingOnly` line and on lines saved before v7.5. | 3 |
| `rooms[].wall_insulation_removal_m2` | number (2 dp) | Sum of `m2` over the room's lines where `insulation_removal` is true (length × that line's own removal height). `0` when none. | 3 |
| `property.wall_insulation_removal_m2` | number (2 dp) | Sum of `rooms[].wall_insulation_removal_m2`. **Never** merged into `property.insulation_removal` (the netted roof-void / strip-ceiling union with its batts / blown-in split). | 3 |
| `rooms[].contingent` | object `{shapes: [{w, l, m2}], m2, working}` | Per-shape audit of contingent areas, mirroring the `cabinetry` / `condition2` blocks. `m2` equals `contingent_m2`. Empty rooms carry `{shapes: [], m2: 0, working: "no contingent drawn"}`. | 4 |
| `rooms[].containment_barriers` | array of `{length_m, id, floor}` | One entry per drawn barrier: its length in metres (2 dp) at its own floor's calibration. `length_m` is `null` only when that floor is uncalibrated; the entry is never dropped. **Invariant: `length == containment_count` on every room.** quantify reads `length_m`. | 5 |
| `rooms[].full_strip` | boolean | Full-strip signature: C2 drawn, C2 net ≤ 0, `wall_strip_m2 > 0` and `ceiling_strip_m2 > 0` (2 dp; floor strip not required; same test as quantify v7.10). Distinct from the retired `full_strip_m2`, which stays absent. | 6 |
| `rooms[].condition2.full_strip` | boolean | Same value, inside the `condition2` audit block (present whenever `condition2` is non-null). | 6 |
| `property.ch` | boolean \| null | **Claims Hero job?** — the explicit Yes/No from the job header. `null` = not chosen. Never inferred from a name. | 7 |
| `property.rate_variant` | `"ch"` \| `"non_ch"` \| null | Derived from `property.ch`. This is the key quantify v7.11 already reads for the CH electrical and plumbing rates. `ac_variant` is **not** written. | 7 |

## Existing keys whose values can differ (same type, same meaning)

| Path | When it differs | CO item |
|---|---|---|
| `source` | Always: `"bml-floorplan-markup v7.5"`. | — |
| `exported_at` | Always (timestamp). | — |
| `rooms[].condition2_net_m2`, `rooms[].condition2_m2`, `rooms[].condition2.net_m2` | **Only on full-strip-signature rooms:** clamped to `0` instead of the negative net. `condition2_surface_m2` and `condition2.deductions` keep their true gross values. Every other room is unchanged; without the signature a net ≤ 0 still exports the real negative number. In the real corpus the signature fires 5 times across 5 PROJECT files (4 distinct jobs: BMLJ00675 has two saves of the same room); the v7.4 nets there were −0.06 to −10.42. | 6 |
| `rooms[].condition2.working` | Signature rooms gain the suffix `→ full-strip signature (wall + ceiling stripped): net clamped to 0`. | 6 |
| `rooms[].wall_strip.working` | Rooms with an insulation-flagged line gain `; insulation: L×H [+ …] = X m²`. | 3 |
| `rooms[].contingent_m2` | Unchanged in meaning. Thin strips drawn in v7.5 now persist (no minimum width), so new markups can carry areas that v7.4 silently discarded on mouse-up. | 4 |

## Flag codes

`flags[]` keeps the `{code, severity, message, room?, floor?}` shape and the app's existing severity vocabulary: **ERROR** means do not price, and **FLAG** is the non-blocking level (the CO's "WARN"/"CONFIRM"). No new severity value was introduced, so no consumer's severity handling changes. quantify v7.11 already surfaces every app `FLAG` as a CONFIRM.

| Code | Severity | Raised when | CO item |
|---|---|---|---|
| `CONTAINMENT_LENGTH_MISSING` | FLAG | A room has a containment barrier whose length cannot be computed (its floor is uncalibrated). That barrier exports `{length_m: null}`, which quantify prices at STANDARD. | 5 |
| `C2_FULL_STRIP_SIGNATURE` | FLAG | A room meets the full-strip signature. C2 is exported as 0; the message names the room and asks the operator to confirm it is not a double-height space. | 6 |
| `CH_FLAG_NOT_SET` | FLAG | "Claims Hero job?" is unset. The export proceeds with `property.ch: null` and `rate_variant: null`. | 7 |

Existing codes: all unchanged in meaning. `C2_NET_NOT_POSITIVE` (ERROR) still fires on C2 net ≤ 0 **without** the full-strip signature (the double-height / stairwell case). On signature rooms it is replaced by the new code. No v7.4 code was retired.

## Not an export change

- Item 1 (number boxes save as typed) and item 2 (Condition 2 first in the left bar) are behavioural / presentation only. `CATS` order, shape-type ids and `rooms[]` key order are unchanged.
- The PROJECT file format is unchanged apart from new optional fields that older files simply lack: `insulationRemoval` on wall-strip shapes and `ch` in `property`. The file's integer `version` stays `7`.
- A re-export refuses to write a file (and says why) when a floor carrying markup has no calibration, or neither an embedded image nor a recorded plan size.

## Appendix — generator output (38 real PROJECT files + 2 synthetic jobs)

Cases: 40 (38 real PROJECT files), each exported by v7.4 and by v7.5 (live AND re-export).

| op | path | v7.4 type | v7.5 type | seen in | sample |
|---|---|---|---|---|---|
| added | `project_saved_at` | — | null/string | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | null |
| added | `property.ch` | — | boolean/null | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | true |
| added | `property.rate_variant` | — | string/null | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | ch |
| added | `property.wall_insulation_removal_m2` | — | number | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | 16.8 |
| added | `reexported_from_project` | — | boolean | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | false |
| added | `rooms[].condition2.full_strip` | — | boolean | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | false |
| added | `rooms[].containment_barriers` | — | array | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | [{"length_m":1.2,"id":9,"floor":"G"},{"length_m":2.35,"id":10,"floo… |
| added | `rooms[].contingent` | — | object | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | {"shapes":[{"w":0.1,"l":4,"m2":0.4}],"m2":0.4,"working":"(0.1×4) = … |
| added | `rooms[].full_strip` | — | boolean | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | false |
| added | `rooms[].wall_insulation_removal_m2` | — | number | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | 16.8 |
| added | `rooms[].wall_strip.lines[].insulation_removal` | — | boolean | live, re-export, real, synthetic: all v7.5 features | true |
| added | `v7_5_model` | — | string | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | v7.5 (CO-2026-09-22-MARKUP) — ADDITIVE ONLY: no key removed, rename… |
| changed | `exported_at` | string | string | live, re-export, real, synthetic: all v7.5 features | "2026-09-23T03:20:37.545Z" → "2026-09-23T03:20:37.551Z" |
| changed | `rooms[].condition2.net_m2` | number | number | live, re-export, real | -0.08 → 0 |
| changed | `rooms[].condition2.working` | string | string | live, re-export, real | "(2.37×3.35) = 7.93 m² fp (union) → ×(2+2.4H) = 43.32 → −(43.4) = -… |
| changed | `rooms[].condition2_m2` | number | number | live, re-export, real | -0.08 → 0 |
| changed | `rooms[].condition2_net_m2` | number | number | live, re-export, real | -0.08 → 0 |
| changed | `rooms[].wall_strip.working` | string | string | live, synthetic: all v7.5 features | "2×2.4 + 1.5×2.4 + 2×2.4 + 1.5×2.4 = 16.8 m²" → "2×2.4 + 1.5×2.4 + … |
| changed | `source` | string | string | live, re-export, real, synthetic: CH unset, synthetic: all v7.5 features | "bml-floorplan-markup v7.4" → "bml-floorplan-markup v7.5" |

Re-export refusals (expected — no file written): synthetic: all v7.5 features: Cannot re-export — floor "L1" has markup but NO CALIBRATION. No file was written.
Flag codes new in v7.5: C2_FULL_STRIP_SIGNATURE, CH_FLAG_NOT_SET, CONTAINMENT_LENGTH_MISSING
Flag codes seen in v7.4 and absent from v7.5 across these cases: none
