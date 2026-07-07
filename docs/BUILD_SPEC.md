# BML Floor Plan Markup — v3 Standalone App Build Spec

**Purpose:** Port the existing v2 markup artifact to a standalone, persistently hosted web app. Executable by Claude Opus/Sonnet in **Claude Code** with no access to the originating chat.
**Author context:** Spec written by Claude (Fable) 07 Jul 2026 for Jordan (BML Remediation).

---

## 0 · PRECONDITIONS — STATUS AS AT 09 JUL 2026

1. ✅ PASSED — two field tests against the BMLJ00618 quote: full-room ceiling strips within ±3% (Bathroom, Sewing Room); divergences explained and resolved as contract/discipline issues, not accuracy issues.
2. ⚠️ PARTIAL — artifact autosave/job-list persistence validated; the project-file export→re-import cycle was NOT fully field-verified in the artifact (sandbox friction). This test moves into §7 acceptance for v3 rather than blocking the build.
3. SUPERSEDED — the "3–5 real jobs on v2 first" gate is waived by Jordan's explicit decision (Jul 2026): concept proven; further v2 hardening is sandbox-workaround work, not validation.
4. ✅ CONFIRMED — Jordan explicitly authorised the v3 build (Jul 2026, "build v3" decision recorded). Do not re-ask; proceed on this spec.

Sequencing note from field review: the markup canvas is good enough — the higher-ROI half is the engine integration (`quantify_quote.py` consuming this JSON schema and emitting a priced per-room schedule; Cowork/Code task). Do not spend v3 build time polishing canvas UI beyond the port.

## 1 · SOURCE ASSETS (must be in the working folder)

- `bml-floorplan-markup.jsx` — the complete v2 React artifact. **This is the codebase. Port it; do not rebuild from scratch.** All drawing logic, calibration maths, quantity calcs, colour convention, and export schema are correct and validated in it.
- This spec.
- Reference (if available via Drive/project knowledge): `bml-floorplan-quantify-quote` skill — the downstream consumer of the export JSON.

If the .jsx is missing, STOP and ask Jordan for it. Do not reconstruct from this spec alone.

## 2 · WHAT v2 DOES (summary of the code being ported)

- Load floor plan image: paste / drop / file picker. Auto-compress (max 3000 px dimension, JPEG re-encode if large).
- Calibrate: draw a line along a known wall, enter real length (m/mm) → scale (m per image px). Measure tool for cross-checks.
- Locked BML v2 markup palette (colours are convention — NEVER make them user-editable):
  | Category | Kind | Hex | Quantified as |
  |---|---|---|---|
  | Full strip | fill | #EE0000 | m² |
  | Floor + subfloor | fill | #FF00FF | m² |
  | Ceiling strip | fill | #FFFF00 | m² |
  | Condition 2 clean | fill | #00B0F0 | m² |
  | Cabinetry | fill | #6600FF | m² |
  | Contingent (provisional) | fill | #FF9900 | m² |
  | Wall strip (full ht) | line | #EE0000 | linear m → m² via ceiling height |
  | Containment set-up | line | #4EA72E | count |
- Rooms with per-room ceiling height (default 2.4 m); active room auto-tags new shapes; shapes reassignable; unassigned shapes flagged, never dropped.
- Rect fills at 35% opacity; shift = axis-lock lines; select/move/resize handles; Ctrl+Z undo; Delete; zoom/pan.
- Live per-room quantities panel.
- **Export JSON** (schema below) — consumed by Cowork `quantify_quote.py`. Do not change field names.
- **Project file** save/open: format id `bml-markup-project`. Two variants exist and v3 MUST import both:
  - v2.1 legacy: image embedded as dataURL (`img.src`).
  - v2.3 current: **markup-only** (no image; `image_embedded:false`, plus `imgW`/`imgH` of the original image). On import the user re-loads the plan image and the app auto-rescales all shape coordinates, the calibration line, and the m/px scale by `newW/imgW` (aspect-ratio mismatch >2% triggers a warning).
  This is the durable system of record, stored in the job folder in Drive.
- v2-only: autosave to artifact `window.storage` with chunked image keys. This layer is REPLACED in v3 (see §4).
- **Environment learning (why v2.3 exists):** the artifact iframe sandbox BLOCKS programmatic downloads (`a.click()` on blob URLs shows a "content is blocked" page and can wedge the preview) and may block `navigator.clipboard`. v2.3 therefore exports via copy/paste modals with a `document.execCommand("copy")` fallback. In v3 (self-hosted, no sandbox) real file downloads and clipboard API are fine — restore proper `Download .json` buttons, but keep the paste-import path for compatibility.

### Export JSON schema (frozen — downstream dependency)
```json
{
  "job": "BMLJ00652 — 12 Sample St",
  "exported_at": "ISO8601",
  "source": "bml-floorplan-markup v3",
  "calibration": {"scale_m_per_px": 0.0123, "reference_px": 400, "reference_m": 4.92},
  "markup_convention": "BML v2 (bml-floorplan-quantify-quote)",
  "condition2_model": "condition2_m2 = explicitly drawn C2 zones only; engine derives full-room C2 for strip_room:true rooms — never double-count",
  "rooms": [{
    "name": "Kitchen", "ceiling_height": 2.4, "strip_room": true,
    "full_strip_m2": 0, "floor_strip_m2": 0, "ceiling_strip_m2": 0,
    "condition2_m2": 0, "cabinetry_m2": 0, "contingent_m2": 0,
    "wall_strip_linm": 0, "wall_strip_m2": 0, "containment_count": 0
  }],
  "flags": ["UNASSIGNED shapes present — reassign before pricing"]
}
```

### Condition 2 contract (validated in field testing, Jul 2026)
The pricing engine applies full-room-surface Condition 2 (floor + walls + remaining ceiling) to EVERY room containing any strip scope — per BML standing rule. Therefore the tool's blue `condition2_m2` means **explicitly drawn extra C2 zones only** (typically adjacent non-strip rooms). `strip_room: true` tells the engine which rooms get the full-room C2 model. The tool must never be changed to "auto-derive" full-room C2 — that's the engine's job; changing it creates double-counting.

### Spot-cut rule (field-corrected, Jul 2026)
Draw the **actual cutout area** — the real cut the crew will make, including whatever strip-past-contamination allowance Jordan judges on the plan. There is **NO auto-buffer/margin feature**: a "+500 mm" expansion button was built, field-tested, and REMOVED (it inflated cutouts well past the real cut). Do not reintroduce it in v3. Note the language distinction: "to 500 mm past visible contamination" is S520 **report prose** for defensibility; the **quote quantity** is the marked cut area. The two are deliberately not reconciled.

## 3 · TARGET ARCHITECTURE

- **Client-side only. No server, no backend, no auth, no build-time framework requirement.** A single static site.
- Preferred build: Vite + React (direct port of the .jsx) compiled to static assets. Acceptable alternative: single self-contained `index.html` (React via CDN or vanilla rewrite) if Jordan chooses hosting option 2.
- Must work in Chrome/Edge desktop. Mouse-first; basic pointer-event touch support is a bonus, not a requirement.

## 4 · PERSISTENCE (replaces artifact window.storage)

Two layers, same philosophy as v2:

1. **IndexedDB (local convenience layer):** jobs store keyed by job id — `{name, rooms, shapes, calLine, scale, image blob, savedAt}`. Store the image as a Blob, not chunked base64 (no 5MB/key limit in IndexedDB). Debounced autosave (~1.2 s) on any change. Job list home screen with last-saved timestamps, open/delete. Save-status indicator: Unsaved… / Saving… / Saved ✓ / SAVE FAILED (red, tells user to save project file).
2. **Project file (durable system of record — unchanged from v2):** same `bml-markup-project` JSON format, save/open buttons on home and editor. **v3 project files must remain import-compatible with files exported from v2** (image as dataURL inside the JSON). Jordan stores these in the Drive job folder.

IndexedDB is per-browser/per-device. The project file is the cross-device transfer mechanism. State this in the UI footer text.

## 5 · HOSTING (ask Jordan to pick, recommend 1)

1. **GitHub Pages (recommended):** private-source repo, Pages deploy, shareable URL, Rose can use it, versioned like his prompt repo. Claude Code maintains via commits.
2. **Single HTML file in Drive/desktop:** zero hosting, per-browser storage only, no shared URL.

Note: the floor plans and markup never leave the browser under either option (client-side only) — no data-privacy exposure from hosting the static app publicly, but keep the repo/source private anyway.

## 6 · v3 SCOPE

**In scope (port + these):**
- Everything in §2 with persistence per §4.
- Home screen job list from IndexedDB.
- Version stamp visible in UI (e.g. "v3.0 · build date") so support conversations are unambiguous.

**Explicitly OUT of scope unless Jordan asks after v3 ships (one change at a time):**
- Multi-floor tabs · polygon tool · PDF import · direct Drive save · multi-user sync · editable colours (never) · auto-buffer/margin expansion on shapes (field-rejected — never).

## 7 · ACCEPTANCE TESTS (all must pass before handover)

1. Load plan → calibrate → cross-check second wall with Measure (within 1%) → mark 3+ categories across 2+ rooms → quantities match hand-calc.
2. Close browser entirely → reopen URL → job restores from IndexedDB exactly.
3. Save project file → clear IndexedDB (or different browser/device) → open project file → identical restore, autosave resumes.
4. **Import both v2 project-file variants** — embedded-image (v2.1) and markup-only (v2.3, incl. rescale to a differently-sized copy of the same plan) → restore correctly.
5. Export JSON → validates against §2 schema → runs through Cowork `quantify_quote.py` reconciliation without edits.
6. Unassigned shape produces the flag in export; uncalibrated state blocks/flag-invalidates export.

## 8 · POST-BUILD SKILL UPDATE

Update `bml-floorplan-quantify-quote`:
1. v3 app = PRIMARY markup path (include the URL); v2 artifact = fallback; Word SOP = legacy fallback (keep, don't delete).
2. Quantify gate: check job folder for `[Job]_markup_PROJECT.json` alongside the quantities JSON; flag if missing (backup enforcement).
3. Keep export schema note frozen per §2.

## 9 · OWNERSHIP / ENFORCEMENT / METRIC

- **Owner:** Jordan (markup + end-of-session project-file save). Claude Code owns maintenance via repo.
- **Trigger:** every markup session ends with Save project file → Drive job folder.
- **Enforcement:** quantify gate flag (§8.2).
- **Metric:** zero re-markups from lost state; markup+quantify time per job vs Word baseline (target: ≤50%). Review in the Saturday bml-project-refiner pass.

## 10 · RISKS

- IndexedDB can be evicted by the browser under storage pressure → project file discipline is the mitigation, enforced at the gate.
- Schema drift breaks Cowork pricing → schema frozen; any change requires updating `quantify_quote.py` in the same session.
- Rectangles-only under-serves irregular rooms → same limitation as the Word workflow; two rects; not a v3 problem.
