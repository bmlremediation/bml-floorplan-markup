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
- **Never clamp a negative C2 net to zero.** Net ≤ 0 raises `C2_NET_NOT_POSITIVE` (ERROR) and
  exports the real number. It is the double-height/stairwell signature and must reach a human.
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

Drive, and only Drive:
`C:\Users\jcahi\My Drive\GD Claude\Projects\BML Report Writing And Estimating Project\_Skill Masters\Floorplan Markup Quantify Quote Skill\`
— change orders, `SKILL.md`, and the versioned `v<X>.0_engine_handoff\` folders (export contract +
real fixture exports). The master pointer for the app source is
`_Artifact and HTML App Masters\MASTER_POINTER.md`.

## Governance split

- **This repo** — app code. Owned by Claude Code sessions. Branch, test, hand back.
- **PRC** (Cowork "Reporting / Estimating PRC") — owns change orders, `quantify_quote.py` and
  `BML_Price_List.json`. Those files **never enter this repo**, and this repo never edits them.
- Schema changes hand back through a `v<X>.0_engine_handoff/` folder with `EXPORT_CONTRACT.md`,
  the old→new field mapping, and **real regenerated fixture exports**. Merge to `master` only
  after the engine accepts the new `markup_convention`.
