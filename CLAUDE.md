# CLAUDE.md — bml-floorplan-markup

## What this is

A standalone Vite/React SPA for marking up floor plans and exporting **quantities only**. It never
holds rates, prices or pricing logic — a separate PRC-owned engine (`quantify_quote.py`) consumes
the exported JSON. Adding any rate to this app is a contract violation.

It is a **live tool holding Jordan's real job markups**, in **per-browser IndexedDB** (`bml-markup`,
stores `jobs` + `images`). There is no server and no backup. **Never bulk-delete, clear the DB, or
run destructive storage code against the live origin** (`bmlremediation.github.io`). Test on
`localhost` with jobs you created yourself.

## Deploy pipeline

Push to **`master`** → `.github/workflows/deploy.yml` builds and publishes to GitHub Pages →
**live immediately** at `bmlremediation.github.io/bml-floorplan-markup`. So: **work on a branch**,
merge only when the change is accepted and (for schema changes) the engine is ready.
*(README.md still says "push to `main`" — it is stale; the workflow triggers on `master`.)*

**The repo is PUBLIC.** Never commit: job files or exports, rates, `BML_Price_List.json`,
`quantify_quote.py`, or anything from the Drive project. `public/test-assets/` is gitignored and is
where local fixture plans/exports go.

## Invariants — do not break these

- **Condition 2 is netted in the app**, and has been since v4.0. `condition2_net_m2` is the priced
  figure; `condition2_m2` is an alias of the net so no consumer can read the gross by accident;
  `condition2_surface_m2` is the gross, audit only.
- **Regression guard** — BMLJ00685 ground fixture, `garage` room:
  footprint `20.82` m², perimeter `22.03` m, surface `94.51` m², net `49.23` m². Any change to the
  union / snapping / surface geometry must reproduce these exactly.
- **Never clamp a negative C2 net to zero — with ONE exception (v7.5, CO-2026-09-22 item 6).** Net ≤ 0
  raises `C2_NET_NOT_POSITIVE` (ERROR) and exports the real number: it is the double-height/stairwell
  signature and must reach a human. The exception is the **full-strip signature** — C2 drawn, net ≤ 0,
  AND `wall_strip_m2 > 0` AND `ceiling_strip_m2 > 0` (2 dp, floor not required; matches quantify v7.10):
  net is clamped to 0, `full_strip: true`, and the non-blocking `C2_FULL_STRIP_SIGNATURE` (FLAG) replaces
  the ERROR. Do not widen that condition.
- **`void_type` is never inferred from a room name.** Names are free text. A room called
  "understair void" with `void_type: null` is an ordinary room, and is flagged, not reinterpreted.
  Roof-void shapes bind to a roof-void room by `void_type` only. `ceiling_void` is retired: never
  written to a new room, only read and flagged from legacy data.
- **No auto-naming and no auto-creation of floors or rooms.** An unlabelled floor with markup is an
  ERROR flag, not a `"Floor 1"`.
- **Flags are structured** — `{code, severity: "ERROR"|"FLAG", message, room?, floor?}`. Codes are
  **stable machine keys**; messages are prose and will be reworded. If a condition's meaning
  changes, it gets a **NEW code** — never redefine an existing one.
- **Per-floor scale.** Always `scaleOf(shape)` (the scale of the floor the shape was drawn on),
  never the active floor's scale, for any quantity.
- **Category colours are a locked downstream contract.** The `CATS` hex values are the BML v2
  convention; do not change them.
- **`markup_convention` is the version handshake.** The engine hard-asserts the exact string
  (em dash U+2014, `; ` separators) and rejects what it does not recognise. Current:
  `BML v7.0 — MULTI-FLOOR; C2 NETTED; INSULATION DE-DUPLICATED; EQUIPMENT MARKERS; FLOOR COVERINGS`.
  Changing it without a matching engine change breaks live quoting.
- **Insulation:** `property.insulation_removal` is authoritative and already de-duplicated (union
  per floor per type). Per-room `insulation_batts_m2`/`insulation_blown_m2` are audit only.
- **Legacy data is never silently dropped or silently converted.** Unmigratable values ride along
  in the export with a hard ERROR flag (export keys `property.roof_void_LEGACY_UNMIGRATED` /
  `property.equipment_legacy`; flag codes `ROOF_VOID_UNMIGRATED` / `EQUIPMENT_LEGACY_COUNTS`).

## Browser-test harness (established pattern)

1. Start the dev server via `.claude/launch.json` (`npm run dev`, port 5173) — not a raw shell.
2. Drive it with claude-in-chrome.
3. **Stub `window.alert` and `window.confirm` first** — unstubbed modals block automation dead.
4. Set textarea/input values with the **native property setter** + a dispatched `input` event, or
   React will not see the change.
5. Keep `javascript_tool` evals **small** — one assertion at a time; large evals silently truncate.
6. **Export-modal gotcha:** the export modal must be closed (Close button) before the next
   interaction; it overlays the canvas and swallows clicks.

## Where the specs live

The engine that consumes the export, and its markup skill, live in the BML engine repo
(`C:\BML\engine-work`, git data `C:\BML\engine.git`), made live in Drive at
`C:\Users\jcahi\My Drive\GD Claude\Projects\Reporting Estimating Project\05_Skill Masters\Floorplan Markup Quantify Quote Skill\`
(`SKILL.md`, `scripts\quantify_quote.py`, `scripts\markup_export_check.py`). The contract check is
`00_Engine\check_markup_app.py` in that repo. *(Updated 13 Nov 2026: the old "BML Report Writing And
Estimating Project\_Skill Masters" path no longer exists.)*

## Governance split

- **Coordinator (Jordan 13 Nov 2026):** the BML engine edit surface (the Claude Code refinement
  session, `bml-refinement` MARKUP APP section) owns changes to this app AND to the engine that reads
  it, and lands both in the same refinement run. It never hands an app change to a separate session.
- **This repo** — app code only. `quantify_quote.py`, `BML_Price_List.json`, rates, job files and
  exports **never enter this repo** (it is public).
- **Every export change:** a test in `tests/`, an `EXPORT_SCHEMA_v<old>_to_v<new>.md` note stating
  engine readiness, the engine readers updated first, and `check_markup_app.py` PASS on the branch.
  Merge to `master` (= live) only on Jordan's go-ahead.
