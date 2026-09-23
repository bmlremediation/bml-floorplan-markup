// ---------- quantities + export (pure) ----------
// Extracted from App.jsx for v7.5 (CO-2026-09-22-MARKUP) so the quantities export can be computed
// HEADLESSLY — by the test harness and by "Open PROJECT.json → Export quantities" — through the
// SAME code path the live editor uses. Everything here is a pure function of the job state; no
// React, no DOM, no storage. App.jsx calls makeQuantities() once per render.
// ---------- BML markup convention (v3.2 — mirrors bml-floorplan-quantify-quote) ----------
// "Full strip" removed (v3.1): floor_strip + ceiling_strip drawn separately instead.
// roof_void_decon / floor_protection (v3.2) are PROPERTY-SCOPE: room assignment is ignored,
// they're excluded from every per-room row and from the UNASSIGNED flag, and are aggregated
// globally into the Property-wide block / export.property block instead.
export const CATS = [
  { id: "floor_strip",   label: "Strip floor coverings + remediate subfloor surface",              kind: "fill", color: "#FF00FF" },
  { id: "ceiling_strip", label: "Strip ceiling linings + remediate cavity surfaces then contain",   kind: "fill", color: "#FFFF00" },
  { id: "condition2",    label: "Condition 2 clean all surfaces",                                   kind: "fill", color: "#00B0F0" },
  { id: "cabinetry",     label: "Cabinetry strip",                                                   kind: "fill", color: "#6600FF" },
  { id: "contingent",    label: "Contingent (provisional)",                                          kind: "fill", color: "#FF9900" },
  { id: "wall_strip",    label: "Wall strip",                                                        kind: "line", color: "#EE0000" },
  { id: "containment",   label: "Containment set-up",                                                kind: "line", color: "#4EA72E" },
  // v5.0 — roof-void decon is ROOM-scoped when drawn inside an explicit void room (that is what
  // void-as-room means). propertyScope is retained as the FALLBACK for shapes not yet inside one:
  // it keeps them out of an ordinary room's scope (where they would silently become that room's
  // quantity) and routes them to the legacy export block plus a hard migration ERROR instead.
  { id: "roof_void_decon", label: "Roof void decontamination (roof voids only)", kind: "fill", color: "#795548", propertyScope: true },
  { id: "floor_protection", label: "Floor protection",                          kind: "fill", color: "#9E9E9E", propertyScope: true },
];
export const catById = (id) => CATS.find((c) => c.id === id);
// v7.5 item 2 (CO-2026-09-22-MARKUP) — LEFT-BAR order: Condition 2 first (it is drawn first on
// almost every job — it defines the zone the strip items sit inside), every other item in its
// v7.4 order. PRESENTATION ONLY: CATS itself is untouched, so shape-type ids, every quantity
// loop and the export key order are exactly as before. The scope-image legend follows this order.
export const LEFT_BAR_CATS = [catById("condition2"), ...CATS.filter((c) => c.id !== "condition2")];
// v6.0 item 3 — categories that can carry an insulation-removal flag. A strip-ceiling and a
// roof-void shape routinely cover the SAME void from two directions; where both are flagged the
// overlap must be counted ONCE (see computeInsulationRemoval).
export const INSULATION_CATS = new Set(["roof_void_decon", "ceiling_strip"]);

// Void-room types. v6.0 RETIRES ceiling_void (Jordan 7 Aug 2026): a ceiling void between two
// storeys is scoped with the STRIP-CEILING shape and its insulation option, not as its own
// room. Only a ROOF void — between the top floor and the roof — is still a room.
// The engine keys off void_type and NEVER off the room name; names are free text.
export const VOID_TYPES = [
  { value: "roof_void", label: "Roof void", hint: "between the top floor and the roof" },
];
// Retained ONLY so pre-v6.0 saved jobs can still be read and flagged. Never offered as a choice
// and never written to a new room — existing data is flagged for Jordan, never silently rebound.
export const RETIRED_VOID_TYPES = new Set(["ceiling_void"]);
export const DEFAULT_PROPERTY = {
  // v7.0 (CO 2026-08-27 item 8): the equipment UNIT-COUNT inputs (afd_units, dehum_units,
  // drymatic_units, ac_split_units) are GONE — counts now come from placed markers. The ×days
  // inputs stay (duration is job-level). drying_mat_units/days are DEAD (item 4), and the
  // 27 Aug ADDENDUM removed the property drying-mats m² box too: mats area has exactly ONE
  // entry point — heat_mats_m2 on the Drymatic Boost markers. Two entry points for the same
  // physical product was confusing.
  afd_days: "", dehum_days: "", dbkii_days: "",
  drymatic_days: "",
  air_mover_units: "", air_mover_days: "",
  ac_ducted_units: "", ac_duct_removal_rooms: "", prv_areas: "",
  contents_packout: false, contents_inventory: false, skip_bin: false, asbestos_testing: false,
  contents_storage: "none", roof_void_mode: "all_surfaces",
};
// Legacy property keys carried invisibly so an old job NEVER silently loses a quantity on
// re-export. Unit counts cannot be converted to markers (no positions) and drying-mat UNITS
// cannot be converted to m² — so they ride along, export under equipment.legacy_* with a loud
// flag, and disappear only when Jordan places the markers / enters the m² himself.
export const LEGACY_EQUIP_KEYS = ["afd_units", "dehum_units", "drymatic_units", "ac_split_units", "drying_mat_units", "drying_mat_days"];
export function migrateProperty(p) {
  const out = { ...DEFAULT_PROPERTY };
  for (const k of Object.keys(DEFAULT_PROPERTY)) if (p && p[k] != null) out[k] = p[k];
  // v4.x adf_* -> afd_* (days only now; the unit count folds into the legacy ride-along)
  if (out.afd_days === "" && p?.adf_days != null && p.adf_days !== "") out.afd_days = p.adf_days;
  for (const k of LEGACY_EQUIP_KEYS) {
    const v = p?.[k] ?? (k === "afd_units" ? p?.adf_units : undefined);
    if (v != null && v !== "" && parseFloat(v) > 0) out[`legacy_${k}`] = v;
  }
  return out;
}

// ---------- v7.0 item 1 (CO 2026-08-27) — floor covering on floor-strip shapes ----------
// Every floor-strip shape carries the SPECIFIC covering (floorCov, the `value` below); the
// export maps it to the 3-class enum quantify_quote.py already consumes UNCHANGED via `cls`.
// "carpet/lino — direct stuck" maps to carpet_direct_stuck (the CO's "hard" parenthetical also
// mentions lino-direct-stuck — resolved in favour of the detail option's own mapping; logged).
// "" = not yet selected -> FLOOR_COVERING_NOT_SET flag (kills the standing quantify CONFIRM
// only when a value is actually chosen, never by defaulting).
export const FLOOR_COVERINGS = [
  { value: "carpet_underlay",     label: "Carpet — underlay & smooth edge", cls: "carpet" },
  { value: "carpet_direct_stuck", label: "Carpet/lino — direct stuck",      cls: "carpet_direct_stuck" },
  { value: "tiles",               label: "Tiles",                            cls: "hard" },
  { value: "floorboards",         label: "Floorboards",                      cls: "hard" },
  { value: "other",               label: "Other",                            cls: "hard" },
];
export const floorCovById = (v) => FLOOR_COVERINGS.find((c) => c.value === v);

// ---------- v7.0 item 8 (CO 2026-08-27) — equipment as per-room draggable markers ----------
// Point markers placed on the plan (fixed SCREEN size, not drawn shapes), room-assigned and
// floor-tagged exactly like shapes. They replace the property-level UNIT-COUNT boxes; the
// property-level ×days inputs are KEPT (equipment duration is job-level — CO silent, logged).
// exportKey is the per-room field name AND the property-level total name; legacyAlias keeps the
// old property key alive as a derived total so pre-update consumers keep reading a number.
export const MARKER_KINDS = [
  { id: "split_ac_decon_insitu", label: "Split AC decon (in-situ)",          exportKey: "split_ac_decon_insitu_count", legacyAlias: "ac_split_units" },
  { id: "split_ac_decommission", label: "Split AC decommission + decon",     exportKey: "split_ac_decommission_count" },
  { id: "afd",                   label: "AFD (air filtration device)",       exportKey: "afd_count",                   legacyAlias: "afd_units" },
  { id: "dehumidifier",          label: "Dehumidifier",                      exportKey: "dehumidifier_count",          legacyAlias: "dehum_units" },
  { id: "drymatic_boost",        label: "Drymatic boost",                    exportKey: "drymatic_boost_count",        legacyAlias: "drymatic_units", hasHeatMats: true },
];
export const markerKindById = (id) => MARKER_KINDS.find((k) => k.id === id);

// ---------- v5.0 multi-floor data model (phase 1) ----------
// FLAT ARRAYS WITH A FLOOR TAG, never nested floors. rooms[] and shapes[] stay single flat
// arrays and each carries a floorId, so roomRows(), buildExport(), qtyOf() and the whole
// union / netting / perimeter geometry corrected in v4.1-v4.2 keep operating on exactly the
// array shape they always have. Nesting would have rewritten that geometry, which is the
// one thing this cycle is protecting.
//
// NO AUTO-NAMING, NO AUTO-CREATION (Jordan ruling 26 Jul 2026). A migrated or newly created
// floor gets an EMPTY label. Floor labelling conventions vary per job (G/GF/L1 vs L1/L2), so
// any label the app invents is a defect. Jordan types it.
export const FIRST_FLOOR_ID = "f1";
export const newFloor = (id) => ({ id, name: "", calLine: null, scale: null, imgW: 0, imgH: 0 });

// In-memory migration of a v4.x record (a stored IndexedDB job OR an imported project file)
// to the floor-tagged shape. NEVER writes back to storage — the caller decides when to
// persist, so opening a v4.x job and exporting without saving leaves the record untouched.
export function migrateFloors(d) {
  if (Array.isArray(d.floors) && d.floors.length) {
    const floors = d.floors.map((f) => ({ ...newFloor(f.id), ...f }));
    const fb = floors[0].id;
    return {
      floors,
      rooms: (d.rooms || []).map((r) => ({ ...r, floorId: r.floorId ?? fb })),
      shapes: (d.shapes || []).map((s) => ({ ...s, floorId: s.floorId ?? fb })),
      markers: (d.markers || []).map((m) => ({ ...m, floorId: m.floorId ?? fb })),   // v7.0 — pre-v7 records have none
    };
  }
  // v4.x flat record -> one implicit floor carrying that job's calibration + image size.
  const f = { ...newFloor(FIRST_FLOOR_ID), calLine: d.calLine || null, scale: d.scale ?? null,
              imgW: d.imgW || 0, imgH: d.imgH || 0 };
  return {
    floors: [f],
    rooms: (d.rooms || []).map((r) => ({ ...r, floorId: FIRST_FLOOR_ID })),
    shapes: (d.shapes || []).map((s) => ({ ...s, floorId: FIRST_FLOOR_ID })),
    markers: (d.markers || []).map((m) => ({ ...m, floorId: FIRST_FLOOR_ID })),
  };
}

// A parsed `bml-markup-project` file (any version, v2.1 onwards) -> the job state the editor
// holds. In-memory only; used by the editor's Import AND by the headless re-export, so both
// read a PROJECT file identically.
export function migrateProjectFile(d) {
  // v3.1: legacy full_strip shapes convert to floor_strip (overlay ceiling separately);
  // legacy wall_strip lines without a height default to "full" (room ceiling height).
  let convertedFullStrip = false;
  const shapes = (d.shapes || []).map((s) => {
    let out = s;
    if (out.cat === "full_strip") { out = { ...out, cat: "floor_strip" }; convertedFullStrip = true; }
    if (out.cat === "wall_strip" && out.hgt == null) out = { ...out, hgt: "full" };
    return out;
  });
  // v5.0 — same in-memory migration as openJob; a v2/v3/v4 project file becomes one floor.
  const mig = migrateFloors({ ...d, shapes });
  const activeFloor = d.activeFloor && mig.floors.some((f) => f.id === d.activeFloor) ? d.activeFloor : mig.floors[0].id;
  return { ...mig, activeFloor, jobName: d.jobName || "", property: migrateProperty(d.property), convertedFullStrip };
}

export const APP_VERSION = "v7.4";

// ---------- edge snapping (v4.2) ----------
// Shapes drawn by hand to visually abut are never numerically coincident. Measured on the real
// BMLJ00685 garage markup: 12.9 mm and 19.3 mm between edges that are plainly the same wall.
// A strict union therefore treats them as separate islands and KEEPS the internal wall that the
// union exists to remove. So: cluster near-coincident edge coordinates onto a shared value
// FIRST, then union. SNAP_PX is in raw plan px; at a typical calibration that is ~25 mm, which
// is below drawing precision but well above pixel noise.
export const SNAP_PX = 3;
export function snapRects(rects) {
  const axisMap = (vals) => {
    const sorted = [...new Set(vals)].sort((a, b) => a - b);
    const m = new Map();
    let rep = sorted[0];
    for (const v of sorted) { if (v - rep > SNAP_PX) rep = v; m.set(v, rep); }
    return m;
  };
  const xm = axisMap(rects.flatMap((r) => [r.x, r.x + r.w]));
  const ym = axisMap(rects.flatMap((r) => [r.y, r.y + r.h]));
  return rects.map((r) => {
    const x0 = xm.get(r.x), x1 = xm.get(r.x + r.w);
    const y0 = ym.get(r.y), y1 = ym.get(r.y + r.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  });
}

// ---------- rectangle union PERIMETER (v4.1 — geometry fix) ----------
// The wall component of a room's surface is perimeter x height, NOT area x height. Summing
// area*H treated the footprint number as if it were a perimeter, which is only true when
// L*W == 2*(L+W) (a 4x4 m room). Small rooms were UNDER-read (1x1: -62%), large rooms
// OVER-read (10x10: +49%). Exact for axis-aligned rects: compress coordinates, mark filled
// cells, and count the boundary edges between a filled cell and empty space.
export function unionPerimeterPx(rawRects) {
  if (!rawRects.length) return 0;
  const rects = snapRects(rawRects);
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx <= 0 || ny <= 0) return 0;
  const filled = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h);
  };
  let per = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!filled(i, j)) continue;
      const w = xs[i + 1] - xs[i], h = ys[j + 1] - ys[j];
      if (!filled(i, j - 1)) per += w;   // top edge exposed
      if (!filled(i, j + 1)) per += w;   // bottom
      if (!filled(i - 1, j)) per += h;   // left
      if (!filled(i + 1, j)) per += h;   // right
    }
  }
  return per;
}

// ---------- rectangle union area (D1.2 — overlap/abutment netting) ----------
// Coordinate-compression sweep in raw px space (scale is uniform, so unioning in px then
// squaring the scale afterward is equivalent and avoids per-rect conversions). Overlapping
// C2 shapes must never have their overlap counted twice; abutting shapes sum exactly.
export function unionAreaPx(rawRects) {
  const rects = snapRects(rawRects);   // v4.2 — same snapped geometry as the perimeter
  if (!rects.length) return 0;
  if (rects.length === 1) return rects[0].w * rects[0].h;
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1], dx = x1 - x0;
    if (dx <= 0) continue;
    const cx = (x0 + x1) / 2;
    for (let j = 0; j < ys.length - 1; j++) {
      const y0 = ys[j], y1 = ys[j + 1], dy = y1 - y0;
      if (dy <= 0) continue;
      const cy = (y0 + y1) / 2;
      if (rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h)) area += dx * dy;
    }
  }
  return area;
}

// All per-job quantity maths. `state` is the job exactly as the editor holds it.
export function makeQuantities({ jobName = "", rooms = [], shapes = [], markers = [], floors = [], activeFloor = null, property = DEFAULT_PROPERTY }) {
  // The ACTIVE floor's calibration feeds only the legacy top-level `calibration` block; every
  // quantity goes through scaleOf(shape) (the floor the shape was drawn on).
  const activeFloorRec = floors.find((f) => f.id === activeFloor) || floors[0] || null;
  const calLine = activeFloorRec?.calLine ?? null;
  const scale = activeFloorRec?.scale ?? null;
  const calPx = calLine ? Math.hypot(calLine.x2 - calLine.x1, calLine.y2 - calLine.y1) : 0;
  const scaleOfFloor = (floorId) => floors.find((f) => f.id === floorId)?.scale ?? null;
  const scaleOf = (s) => scaleOfFloor(s?.floorId ?? activeFloor);

  // ---------- quantities ----------
  const fmt = (v, d = 2) => v.toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d });
  const chOf = (room) => parseFloat(room?.ch) || 2.4; // room.ch is stored as a raw string (decimal-entry fix, v3.2)
  const roomCH = (roomId) => chOf(rooms.find((r) => r.id === roomId));
  const wallEffHeight = (s) => (s.hgt === "full" || s.hgt == null ? roomCH(s.room) : s.hgt);
  // v7.5 item 3 — a wall-strip line carries cavity insulation removal (never on skirting-only)
  const wallInsulationOn = (s) => s.cat === "wall_strip" && !!s.insulationRemoval && !s.skirtingOnly;
  const lenOf = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * (scaleOf(s) || 0); // m, at THIS shape's floor scale
  // v4.0 — cabinetry FACE area. Cabinetry is priced on the VERTICAL FACE it presents, never on
  // its plan footprint: a 2.4 m full-height unit and a 0.9 m base unit with identical footprints
  // are not the same job. face = perimeter x height (Jordan ruling, 26 Jul 2026 — supersedes the
  // footprint/depth-ratio method). Height comes from the shape's own selector (s.cabH), so it is
  // chosen in the app and computed BEFORE export.
  const cabHOf = (s) => parseFloat(s.cabH) || null;      // null = not yet selected
  const cabFaceOf = (s) => {
    const sc = scaleOf(s);
    if (!sc) return 0;
    const h = cabHOf(s); if (!h) return 0;               // unset height -> 0 + a hard validation flag
    const Lm = s.w * sc, Wm = s.h * sc;
    // v4.1 (Jordan ruling 26 Jul): face = vertical wrap + TOP. The top is a real removed/cleaned
    // surface. Base is excluded (sits on the floor). Shelves, drawers and carcass divisions are
    // still excluded — this stays a deliberately CONSERVATIVE convention, not a true surface total.
    return 2 * (Lm + Wm) * h + Lm * Wm;                  // perimeter x height + top
  };
  // Primary priced quantity per shape. v4.0: condition2 returns its FOOTPRINT only — the surface
  // factor is applied ONCE per room after all shape footprints are combined (see roomRows).
  // Computing a surface per shape gave every shape its own perimeter and FABRICATED internal walls
  // that do not physically exist, inflating decon on every multi-shape room (BMLJ00685 A2).
  const qtyOf = (s) => {
    const sc = scaleOf(s);
    if (!sc) return null;
    if (s.type === "rect") {
      const area = s.w * s.h * sc * sc;
      if (s.cat === "cabinetry") return cabFaceOf(s);     // FACE m², not footprint
      return area;                                       // condition2 -> footprint (combined later)
    }
    const len = lenOf(s);
    if (s.cat === "wall_strip") return s.skirtingOnly ? 0 : len * wallEffHeight(s);
    return len;
  };
  const shapeLabel = (s) => {
    const sc = scaleOf(s);
    if (!sc) return "no scale";
    if (s.cat === "containment") return "containment";
    if (s.cat === "wall_strip" && s.skirtingOnly) return `${fmt(lenOf(s))} m skirting`;
    const q = qtyOf(s);
    if (s.cat === "cabinetry") {
      const L = s.w * sc, W = s.h * sc, h = cabHOf(s);
      if (!h) return `${fmt(L)}×${fmt(W)} m — set height ⚠`;
      return `${fmt(L)}×${fmt(W)} m, h=${fmt(h, 2)} = ${fmt(q)} m² face`;
    }
    if (s.type === "rect") {
      const L = s.w * sc, W = s.h * sc;
      return s.cat === "condition2" ? `${fmt(L)}×${fmt(W)} m = ${fmt(q)} m² fp` : `${fmt(L)}×${fmt(W)} m = ${fmt(q)} m²`;
    }
    if (s.cat === "wall_strip") {
      const len = lenOf(s), ch = wallEffHeight(s);
      return `${fmt(len)}×${fmt(ch)} m = ${fmt(q)} m²${wallInsulationOn(s) ? " + cavity insulation" : ""}`;
    }
    return `${fmt(q)} m`;
  };
  const roomRows = () => {
    const ids = [...rooms.map((r) => r.id), null];
    return ids.map((rid) => {
      const room = rooms.find((r) => r.id === rid);
      // property-scope shapes (roof void / floor protection) never belong to a per-room row
      // Property-scope shapes (roof void / floor protection) normally never belong to a per-room
      // row. The ONE exception is roof-void decon drawn inside an explicit VOID ROOM (v5.0): that
      // is the whole point of void-as-room, so it flows through the ordinary per-room pipeline
      // instead of being aggregated job-wide with the other floor's void.
      const isVoid = !!room?.void_type;
      const rs = shapes.filter((s) => (s.room ?? null) === rid &&
        (!catById(s.cat)?.propertyScope || (isVoid && s.cat === "roof_void_decon")));
      if (!room && rs.length === 0) return null;
      // Room-level scale: every shape in a room is measured at that ROOM's floor's scale.
      // Per-shape helpers (qtyOf/lenOf) resolve it themselves; the C2 union and the raw
      // w/l dimension strings below operate on a GROUP of rects and so need one scale.
      // The "Unassigned" pseudo-row has no room and therefore no floor, so it falls back to
      // its first shape's floor — it is a flagged, not-for-pricing row either way.
      const rowScale = (room ? scaleOfFloor(room.floorId) : (rs.length ? scaleOf(rs[0]) : null)) || 0;
      const row = {
        name: room ? room.name : "Unassigned", ch: room ? chOf(room) : 2.4, isUnassigned: !room,
        // v6.0 — chOf() silently defaults a blank/unparseable ceiling height to 2.4, so `ch` is
        // ALWAYS truthy and the D1.6 "C2 drawn with no ceiling height" check could never fire.
        // It had been dead since v4.0. Track whether a height was actually SET, separately from
        // the value used for the maths, so that validation works as intended.
        chSet: room ? (parseFloat(room.ch) > 0) : true,
        plumbIso: room ? !!room.plumbIso : false, elecIso: room ? !!room.elecIso : false,
        // v7.0 item 9 — per-room counts entered on the room row (raw strings, decimal-entry fix idiom)
        elecFittings: room ? (parseFloat(room.elecFittings) || 0) : 0,
        plumbFixtures: room ? (parseFloat(room.plumbFixtures) || 0) : 0,
        counts: {}, wallLinm: 0, corniceLinm: 0, skirtingLinm: 0, any: rs.length > 0,
        roomId: rid,
        floorId: room ? room.floorId : null,
        voidType: room?.void_type || null,
        // a shape whose own floor disagrees with its room's is a data defect, never averaged
        floorMismatch: !!room && rs.some((s) => (s.floorId ?? room.floorId) !== room.floorId),
      };
      // v7.0 item 1 — floor covering, per room, from this room's floor-strip shapes.
      // Every floor-strip shape carries its own floorCov; a room's exported type is the
      // AREA-DOMINANT covering. Mixed coverings and unset shapes are flagged, never guessed.
      {
        const fsShapes = rs.filter((s) => s.cat === "floor_strip");
        const areaByCov = new Map();
        let unset = false;
        for (const s of fsShapes) {
          if (!s.floorCov) { unset = true; continue; }
          areaByCov.set(s.floorCov, (areaByCov.get(s.floorCov) || 0) + (qtyOf(s) || 0));
        }
        const ranked = [...areaByCov.entries()].sort((a, b) => b[1] - a[1]);
        row.floorCovDetail = ranked[0]?.[0] || null;
        row.floorCovClass = row.floorCovDetail ? (floorCovById(row.floorCovDetail)?.cls ?? null) : null;
        row.floorCovMixed = ranked.length > 1;
        row.floorCovUnset = unset && fsShapes.length > 0;
        row.hasFloorStrip = fsShapes.length > 0;
      }
      for (const c of CATS) {
        const cs = rs.filter((s) => s.cat === c.id);
        if (c.id === "containment") { row.counts[c.id] = cs.length; continue; }
        if (c.id === "wall_strip") {
          row.counts[c.id] = cs.reduce((a, s) => a + (qtyOf(s) || 0), 0); // m² (0 for skirting-only)
          row.wallLinm = cs.filter((s) => !s.skirtingOnly).reduce((a, s) => a + (lenOf(s) || 0), 0);
          row.corniceLinm = cs.filter((s) => s.cornice && !s.skirtingOnly).reduce((a, s) => a + (lenOf(s) || 0), 0);
          row.skirtingLinm = cs.filter((s) => s.skirtingOnly || s.skirting).reduce((a, s) => a + (lenOf(s) || 0), 0);
          // v4.2 PRODUCTIVITY COUNTS (internal review only - never a client-facing figure and
          // never priced by this app). A long continuous wall strips faster per m2 than several
          // short sections, and every separate run costs a reposition. Counting the RUNS lets the
          // working figures show where that time is going.
          row.wallRuns = cs.filter((s) => !s.skirtingOnly).length;
          row.wallRunAvgLinm = row.wallRuns ? row.wallLinm / row.wallRuns : 0;
          // D1.3 — wall-strip working (per-line length × its own height).
          // v7.5 item 3 — wall-CAVITY insulation removal, per line. Area basis = that line's own
          // m² (length × its removal height). A skirting-only line never opens the cavity, so it
          // is always false there. Summed like wall_strip.m2 itself (no new geometry). Kept OUT of
          // property.insulation_removal, which is the netted roof-void / strip-ceiling (horizontal
          // plane) union with the batts / blown-in split that quantify prices from.
          const insLines = cs.filter(wallInsulationOn);
          row.wallInsulM2 = insLines.reduce((a, s) => a + (qtyOf(s) || 0), 0);
          row.wallWorking = {
            lines: cs.map((s) => ({ length_m: round2(lenOf(s)), height_m: s.skirtingOnly ? null : round2(wallEffHeight(s)),
              m2: round2(qtyOf(s) || 0), cornice: !!s.cornice, skirting: !!s.skirting, skirtingOnly: !!s.skirtingOnly,
              insulation_removal: wallInsulationOn(s) })),
            linm: 0, m2: 0, // filled in after loop once row.wallLinm/counts settle
            working: cs.length
              ? cs.map((s) => s.skirtingOnly ? `${round2(lenOf(s))}m skirting-only` : `${round2(lenOf(s))}×${round2(wallEffHeight(s))}`).join(" + ")
              : "no wall strip drawn",
          };
          continue;
        }
        row.counts[c.id] = cs.reduce((a, s) => a + (qtyOf(s) || 0), 0);
      }
      if (row.wallWorking) {
        row.wallWorking.linm = round2(row.wallLinm);
        row.wallWorking.m2 = round2(row.counts.wall_strip);
        row.wallWorking.working += ` = ${round2(row.counts.wall_strip)} m²`;
        if (row.wallInsulM2 > 0) {
          const ins = rs.filter((s) => s.cat === "wall_strip" && wallInsulationOn(s));
          row.wallWorking.working += `; insulation: ${ins.map((s) => `${round2(lenOf(s))}×${round2(wallEffHeight(s))}`).join(" + ")} = ${round2(row.wallInsulM2)} m²`;
        }
      }
      // ---- v4.0 CONDITION 2: UNION footprints per height-group FIRST, apply the factor ONCE
      // per group, then NET. A shape's own height override (D1.5 — stairwell/raked/void) puts
      // it in its own group so it gets its own surface factor instead of averaging into the room.
      // Overlapping/abutting shapes within a group are netted via unionAreaPx (D1.2) — summing
      // raw footprints would double-count any overlap.
      const c2s = rs.filter((s) => s.cat === "condition2");
      const c2Shapes = c2s.map((s) => ({
        s, w: round2(s.w * rowScale), l: round2(s.h * rowScale), m2: round2(s.w * s.h * rowScale * rowScale),
        h_override: parseFloat(s.c2H) || null,
      }));
      const groups = new Map(); // effective height -> shape entries
      c2Shapes.forEach((cs2) => {
        const h = cs2.h_override || row.ch;
        if (!groups.has(h)) groups.set(h, []);
        groups.get(h).push(cs2);
      });
      const groupEntries = [...groups.entries()];
      let c2Footprint = 0, c2Surface = 0, overlapNetted = false;
      const heightGroups = [];
      for (const [h, group] of groupEntries) {
        const rects = group.map((g) => ({ x: g.s.x, y: g.s.y, w: g.s.w, h: g.s.h }));
        const sumFootprints = group.reduce((a, g) => a + g.m2, 0);
        const unionM2raw = unionAreaPx(rects) * rowScale * rowScale;
        const unionPerimM = unionPerimeterPx(rects) * rowScale;
        const gNetted = round2(unionM2raw) < round2(sumFootprints);
        if (gNetted) overlapNetted = true;
        c2Footprint += unionM2raw;
        // v4.1 GEOMETRY: floor + ceiling are AREAS (2 x union area); walls are PERIMETER x height.
        const gSurface = 2 * unionM2raw + unionPerimM * h;
        c2Surface += gSurface;
        heightGroups.push({ height: h, footprint_m2: round2(unionM2raw), perimeter_m: round2(unionPerimM),
          floor_ceiling_m2: round2(2 * unionM2raw), walls_m2: round2(unionPerimM * h),
          surface_m2: round2(gSurface), shape_count: group.length, overlap_netted: gNetted });
      }
      const c2Deduct = (row.counts.wall_strip || 0) + (row.counts.ceiling_strip || 0) + (row.counts.floor_strip || 0);
      const c2Net = c2Surface - c2Deduct;
      // D1.3 — the working string must reflect the H actually used per shape. A single group at
      // the room's own ceiling height keeps the original compact form; any height override (D1.5)
      // switches to a per-group breakdown so the string stays hand-reproducible (never claim
      // "×(2+2.4H)" for a shape that was actually costed at a different H).
      const singleRoomGroup = groupEntries.length === 1 && groupEntries[0][0] === row.ch;
      let c2Working;
      if (!c2Shapes.length) {
        c2Working = "no Condition 2 zone drawn";
      } else if (singleRoomGroup) {
        c2Working = `${c2Shapes.map((cs2) => `(${cs2.w}×${cs2.l})`).join("+")}${overlapNetted ? " [overlap netted]" : ""} = ${round2(c2Footprint)} m² fp (union) → ×(2+${row.ch}H) = ${round2(c2Surface)} → −(${round2(c2Deduct)}) = ${round2(c2Net)}`;
      } else {
        const parts = groupEntries.map(([h, group]) => {
          const label = group.length > 1 ? `[${group.map((g) => `(${g.w}×${g.l})`).join("+")}]` : `(${group[0].w}×${group[0].l})`;
          const gFp = round2(unionAreaPx(group.map((g) => ({ x: g.s.x, y: g.s.y, w: g.s.w, h: g.s.h }))) * rowScale * rowScale);
          return `${label} fp=${gFp} ×(2+${h}H) = ${round2(gFp * (2 + h))}`;
        });
        c2Working = `${parts.join(" + ")} → surface Σ = ${round2(c2Surface)} → −(${round2(c2Deduct)}) = ${round2(c2Net)}`;
      }
      row.c2 = {
        shapes: c2Shapes.map(({ w, l, m2, h_override }) => ({ w, l, m2, h_override })),
        footprint_m2: round2(c2Footprint), overlap_netted: overlapNetted,
        ceiling_height: row.ch, factor: singleRoomGroup ? `(2 + ${row.ch}H)` : "(2 + H) per shape group — see height_groups / working",
        height_groups: heightGroups,
        surface_m2: round2(c2Surface),
        deductions: { wall_strip: round2(row.counts.wall_strip || 0),
                      ceiling_strip: round2(row.counts.ceiling_strip || 0),
                      floor_strip: round2(row.counts.floor_strip || 0) },
        net_m2: round2(c2Net),
        working: c2Working,
      };
      // NET is the priced figure — but ONLY when a C2 zone is actually drawn. A room with strip
      // and NO C2 zone has no Condition 2 scope at all, not a negative one: 0 − stripped used to
      // export here as a negative condition2_net_m2, which the engine correctly refuses as the
      // double-height signature. Surfaced by the v7.0 acceptance run (a strip-only synthetic
      // room hard-errored the engine); latent since v4.0 because every real room had a C2 zone.
      row.counts.condition2 = c2Shapes.length ? round2(c2Net) : 0;
      // D1.3 — cabinetry working (footprint -> perimeter x height -> face).
      const cabShapes = rs.filter((s) => s.cat === "cabinetry");
      row.cabMissingH = cabShapes.some((s) => !cabHOf(s));
      row.cabFootprint = cabShapes.reduce((a, s) => a + s.w * s.h * rowScale * rowScale, 0);
      row.cabWorking = {
        shapes: cabShapes.map((s) => {
          const L = round2(s.w * rowScale), W = round2(s.h * rowScale), h = cabHOf(s), perimeter_m = round2(2 * (L + W));
          // face = vertical wrap + TOP. The top must appear here AND in the working string below:
          // showing the wrap-only expression beside a total that includes the top makes the working
          // figures internally inconsistent, and the working figures are the control.
          const top_m2 = round2(L * W);
          return { w: L, l: W, perimeter_m, height_m: h, top_m2,
                   face_m2: h ? round2(perimeter_m * h + L * W) : 0 };
        }),
        footprint_m2: round2(row.cabFootprint), face_m2: round2(row.counts.cabinetry),
        working: cabShapes.length
          ? cabShapes.map((s) => {
              const L = round2(s.w * rowScale), W = round2(s.h * rowScale), h = cabHOf(s);
              return h ? `(2×(${L}+${W}))×${h} + (${L}×${W}) top` : `(${L}×${W}) NO HEIGHT`;
            }).join(" + ") + ` = ${round2(row.counts.cabinetry)} m² face`
          : "no cabinetry drawn",
      };
      // v5.0 — a VOID ROOM carries its own decon + insulation rather than feeding the job-wide
      // bucket. Batts and blown-in are reported separately: different removal rates.
      if (isVoid) {
        const vs = rs.filter((s) => s.cat === "roof_void_decon");
        const dec = vs.reduce((a, s) => a + (qtyOf(s) || 0), 0);
        const batts = vs.filter((s) => s.insulation && s.insulationType === "batts").reduce((a, s) => a + (qtyOf(s) || 0), 0);
        const blown = vs.filter((s) => s.insulation && s.insulationType === "blown_in").reduce((a, s) => a + (qtyOf(s) || 0), 0);
        row.voidWork = {
          void_type: room.void_type,
          decon_m2: round2(dec), insulation_batts_m2: round2(batts), insulation_blown_m2: round2(blown),
          shapes: vs.map((s) => ({ w: round2(s.w * rowScale), l: round2(s.h * rowScale), m2: round2(qtyOf(s) || 0),
            insulation: !!s.insulation, insulationType: s.insulation ? s.insulationType : null })),
          working: vs.length
            ? vs.map((s) => `(${round2(s.w * rowScale)}×${round2(s.h * rowScale)})`).join(" + ") + ` = ${round2(dec)} m² decon`
            : "no void decon zone drawn",
        };
      }
      return row;
    }).filter(Boolean);
  };
  // Global totals for the two property-scope drawn categories (room assignment ignored).
  const computePropertyTotals = () => {
    // v5.0 — roof-void shapes that sit inside an explicit VOID ROOM are that room's, not the
    // job's. Excluding them here is what stops a void being counted twice once phase 5 drops
    // the property.roof_void path entirely. Shapes NOT in a void room keep the old behaviour,
    // so a v4.x job that has never been touched exports exactly as it did.
    const voidRoomIds = new Set(rooms.filter((r) => r.void_type).map((r) => r.id));
    const roofShapes = shapes.filter((s) => s.cat === "roof_void_decon" && !voidRoomIds.has(s.room));
    const decon_m2 = roofShapes.reduce((a, s) => a + (qtyOf(s) || 0), 0);
    const insBatts = roofShapes.filter((s) => s.insulation && s.insulationType === "batts").reduce((a, s) => a + (qtyOf(s) || 0), 0);
    const insBlown = roofShapes.filter((s) => s.insulation && s.insulationType === "blown_in").reduce((a, s) => a + (qtyOf(s) || 0), 0);
    // floor protection stays genuinely job-wide and is SUMMED across every floor
    const floorProt = shapes.filter((s) => s.cat === "floor_protection").reduce((a, s) => a + (qtyOf(s) || 0), 0);
    // D1.3 — roof-void working (shape list + human-readable calculation).
    const roofWorking = {
      // property-scope shapes can sit on ANY floor, so each is dimensioned at its own floor's scale
      shapes: roofShapes.map((s) => ({ w: round2(s.w * (scaleOf(s) || 0)), l: round2(s.h * (scaleOf(s) || 0)), m2: round2(qtyOf(s) || 0),
        insulation: !!s.insulation, insulationType: s.insulation ? s.insulationType : null })),
      decon_m2: round2(decon_m2), insulation_batts_m2: round2(insBatts), insulation_blown_m2: round2(insBlown),
      working: roofShapes.length
        ? roofShapes.map((s) => `(${round2(s.w * (scaleOf(s) || 0))}×${round2(s.h * (scaleOf(s) || 0))})`).join(" + ") + ` = ${round2(decon_m2)} m² decon`
        : "no roof void zone drawn",
    };
    return { decon_m2, insBatts, insBlown, floorProt, roofWorking };
  };
  // ---------- v6.0 item 3: insulation removal, DE-DUPLICATED ----------
  // A strip-ceiling shape and a roof-void shape routinely cover the same void from two
  // directions. Summing them over-charges the client by the overlap, and it is INVISIBLE on
  // inspection because each shape looks individually correct — the same failure mode as the
  // Condition 2 double-count. So the area is the geometric UNION, never the sum.
  //
  // Unioned PER FLOOR (shape coordinates only share a pixel space within one floor) and PER
  // TYPE (you cannot pull batts and blown-in out of the same square metre, and they price
  // differently). Where the two types overlap, that is physically contradictory and almost
  // certainly a markup error, so it is FLAGGED rather than silently resolved either way.
  // unionAreaPx snaps near-coincident edges first — without that, hand-drawn shapes meant to
  // coincide sit 12.9-19.3 mm apart and the union degenerates back to the sum.
  const computeInsulationRemoval = () => {
    const flagged = shapes.filter((s) => s.type === "rect" && s.insulation && INSULATION_CATS.has(s.cat));
    const byFloor = [];
    let batts = 0, blown = 0, all = 0, crossOverlap = false;
    for (const f of floors) {
      const fs = flagged.filter((s) => (s.floorId ?? f.id) === f.id && s.floorId === f.id);
      if (!fs.length) continue;
      const sc = f.scale;
      const toRect = (s) => ({ x: s.x, y: s.y, w: s.w, h: s.h });
      const areaOf = (arr) => sc ? unionAreaPx(arr.map(toRect)) * sc * sc : 0;
      const bShapes = fs.filter((s) => s.insulationType !== "blown_in");   // default/batts
      const nShapes = fs.filter((s) => s.insulationType === "blown_in");
      const bA = areaOf(bShapes), nA = areaOf(nShapes), allA = areaOf(fs);
      // union(all) < union(batts)+union(blown) means the two TYPES overlap each other
      const cross = round2(allA) < round2(bA + nA);
      if (cross) crossOverlap = true;
      const rawSum = sc ? fs.reduce((a, s) => a + s.w * s.h * sc * sc, 0) : 0;
      batts += bA; blown += nA; all += allA;
      byFloor.push({
        floor: f.name || "", batts_m2: round2(bA), blown_in_m2: round2(nA),
        raw_sum_m2: round2(rawSum), netted_m2: round2(allA),
        overlap_netted: round2(allA) < round2(rawSum), cross_type_overlap: cross,
        shape_ids: fs.map((s) => s.id),
        working: `union of ${fs.length} insulation-flagged shape(s) [${fs.map((s) => s.id).join(", ")}] = ${round2(allA)} m² (raw sum ${round2(rawSum)} m²)`,
      });
    }
    // total_m2 is the union of ALL insulation shapes, so it can NEVER be overstated — not the
    // sum of the per-type unions, which would double-count any area where the two types overlap.
    // When they do overlap the SPLIT is what becomes unreliable, and that is what gets flagged.
    return { batts_m2: round2(batts), blown_in_m2: round2(blown), total_m2: round2(all),
             cross_type_overlap: crossOverlap, by_floor: byFloor,
             split_exceeds_total: round2(batts + blown) > round2(all),
             overlap_netted: byFloor.some((b) => b.overlap_netted) };
  };

  // ---------- v7.0 item 8: equipment marker aggregation ----------
  // Counts come from PLACED MARKERS, per room, plus property-level totals (sum of rooms) so
  // existing consumers keep a single number. heat_mats_m2 rides on drymatic markers and is
  // REQUIRED — a blank one contributes 0 and raises a flag, never a silent default.
  const computeEquipment = () => {
    const byRoom = new Map();   // room id -> { <exportKey>: n..., heat_mats_m2 }
    const totals = {};
    for (const k of MARKER_KINDS) totals[k.exportKey] = 0;
    totals.heat_mats_m2 = 0;
    let heatUnset = 0, unassigned = 0;
    for (const m of markers) {
      const kind = markerKindById(m.kind); if (!kind) continue;
      if (m.room == null) unassigned++;
      const key = m.room ?? null;
      if (!byRoom.has(key)) { const o = {}; for (const k of MARKER_KINDS) o[k.exportKey] = 0; o.heat_mats_m2 = 0; byRoom.set(key, o); }
      const rec = byRoom.get(key);
      rec[kind.exportKey]++; totals[kind.exportKey]++;
      if (kind.hasHeatMats) {
        const hm = parseFloat(m.heatMatsM2);
        if (hm > 0) { rec.heat_mats_m2 = round2(rec.heat_mats_m2 + hm); totals.heat_mats_m2 = round2(totals.heat_mats_m2 + hm); }
        else heatUnset++;
      }
    }
    return { byRoom, totals, heatUnset, unassigned, any: markers.length > 0 };
  };

  // ---------- v7.0 item 9: containment zone consolidation ----------
  // Drawn containment barriers can carry a zone id/name (free text on the selected shape).
  // Named zones consolidate across rooms so a multi-room zone exports as ONE zone — this is
  // what quantify v7.03 currently reconstructs with a CONFIRM; the explicit id kills the ask.
  // Unzoned barriers stay per-room-only (containment_count keeps working regardless).
  const computeContainmentZones = () => {
    const zones = new Map();   // zone name -> { rooms:Set, barrier_count }
    let unzoned = 0;
    for (const s of shapes) {
      if (s.cat !== "containment") continue;
      const z = (s.zone || "").trim();
      if (!z) { unzoned++; continue; }
      if (!zones.has(z)) zones.set(z, { rooms: new Set(), barrier_count: 0 });
      const rec = zones.get(z);
      rec.barrier_count++;
      const rm = rooms.find((r) => r.id === s.room);
      if (rm) rec.rooms.add(rm.name || "(unnamed)");
    }
    return {
      zones: [...zones.entries()].map(([zone_id, v]) => ({ zone_id, rooms: [...v.rooms], barrier_count: v.barrier_count })),
      unzoned_barrier_count: unzoned,
    };
  };

  // ---------- export (real downloads — self-hosted, no sandbox; copy/paste modal kept for Cowork paste-in) ----------
  const round2 = (v) => Math.round(v * 100) / 100;
  const buildExport = () => {
    const exportRows = roomRows().filter((r) => !r.isUnassigned || r.any);
    const pt = computePropertyTotals();
    const ins = computeInsulationRemoval();
    const eq = computeEquipment();
    const cz = computeContainmentZones();
    const legacyEquip = {};
    for (const k of LEGACY_EQUIP_KEYS) {
      const v = parseFloat(property[`legacy_${k}`]);
      if (v > 0) legacyEquip[k] = v;
    }
    return {
      job: jobName || "UNNAMED JOB",
      exported_at: new Date().toISOString(),
      source: `bml-floorplan-markup ${APP_VERSION}`,
      pricing: "QUANTITIES ONLY — this tool never applies rates or pricing. Any pricing engine consumes this JSON.",
      calibration: scale ? { scale_m_per_px: scale, reference_px: calPx, reference_m: calPx * scale } : null,
      // v5.0 — every floor's own calibration. Rooms reference a floor by its TYPED label.
      floors: floors.map((f, i) => ({
        id: f.id, name: f.name || "", order: i + 1,
        scale_m_per_px: f.scale ?? null,
        calibration: f.scale && f.calLine
          ? { reference_px: Math.hypot(f.calLine.x2 - f.calLine.x1, f.calLine.y2 - f.calLine.y1),
              reference_m: Math.hypot(f.calLine.x2 - f.calLine.x1, f.calLine.y2 - f.calLine.y1) * f.scale }
          : null,
      })),
      // VERSION HANDSHAKE. The engine asserts on this exact string and must REJECT a convention
      // it does not recognise rather than infer one. String taken verbatim from
      // BML_Markup_App_v5_0_MULTIFLOOR_PLAN.md §5 — note it drops the
      // "(bml-floorplan-quantify-quote)" qualifier that v4.x carried.
      markup_convention: "BML v7.0 — MULTI-FLOOR; C2 NETTED; INSULATION DE-DUPLICATED; EQUIPMENT MARKERS; FLOOR COVERINGS",
      equipment_model: "v7.0 (CO 2026-08-27 item 8) — equipment counts come from PLACED MARKERS, per room. Each room carries split_ac_decon_insitu_count / split_ac_decommission_count / afd_count / dehumidifier_count / drymatic_boost_count / heat_mats_m2; property carries the TOTALS (sum of rooms) under the same names. LEGACY ALIASES: property.afd_units, dehum_units, drymatic_units, ac_split_units are now DERIVED from marker totals (afd_units=afd_count, dehum_units=dehumidifier_count, drymatic_units=drymatic_boost_count, ac_split_units=split_ac_decon_insitu_count) so pre-v7 consumers keep reading a number — update to the *_count keys. The ×days inputs remain property-level (equipment duration is job-level). drying_mat_units/drying_mat_days are DEAD, and per the 27 Aug addendum the property-level mats m² input is gone too: drying/heat mats area rides ONLY on Drymatic Boost markers as heat_mats_m2 (property.drying_mats_m2 is DEPRECATED and always 0). A job saved before v7.0 that still carries old unit counts exports them under property.equipment_legacy with a hard flag — they are never silently dropped and never silently converted (counts have no positions; units are not m²).",
      insulation_model: "v6.0 — INSULATION REMOVAL IS DE-DUPLICATED. Both a strip-ceiling shape and a roof-void shape can carry an insulation-removal flag, and they routinely cover the SAME void from two directions. property.insulation_removal is the AUTHORITATIVE, already-netted figure: the geometric UNION per floor and per type, with near-coincident edges snapped first. PRICE total_m2 / batts_m2 / blown_in_m2 FROM THERE. The per-room insulation_batts_m2 / insulation_blown_m2 exist ONLY on void rooms and are kept for audit ONLY: they omit every insulation-flagged strip-ceiling shape outside a void room (so summing them UNDER-charges), and within one void room they are a plain per-shape sum (so overlapping shapes there OVER-charge). Never derive insulation from them. total_m2 is the union of ALL insulation shapes and can never be overstated; where the two TYPES overlap the batts/blown split is unreliable and a hard ERROR flag says so, because the same square metre cannot have both removed. v6.0 also RETIRES ceiling_void as a room type: a ceiling void between storeys is scoped with the strip-ceiling shape and its insulation option, not as its own room. Only roof_void remains, and a roof-void shape is bound to a roof-void room by void_type — never by room name.",
      multifloor_model: "v5.0 — a job has FLOORS. floors[] carries each floor's own calibration; every room carries `floor` (the floor's TYPED label, never invented by the app — it may be \"\" if unlabelled) and `void_type`. PROPERTY SCOPE IS ENTERED ONCE PER JOB and is therefore already a combined total across every floor, including floor_protection_m2 — there is nothing to merge or de-duplicate, and a consumer must NOT attempt to. VOID ROOMS: void_type is `ceiling_void` (between an upper and a lower floor) or `roof_void` (between the top floor and the roof), and is ALWAYS an explicit human selection. Key off void_type ONLY — NEVER off the room name, which is free text: a room named \"understair void\" with void_type null is an ORDINARY room and is flagged, not reinterpreted. A void room carries decon_m2 + insulation_batts_m2 + insulation_blown_m2 + void_decon{} and is otherwise an ordinary room (own ceiling height, containment, strip). property.roof_void is GONE unless a legacy job still has roof-void shapes outside a void room, in which case it is present AND a hard ERROR flag is raised — never silently dropped.",
      condition2_model: "v5.0 — condition2_net_m2 is the PRICED figure and it is ALREADY NETTED. SURFACE: all Condition 2 shapes in a room are UNIONED (with near-coincident edges snapped within ~25 mm first, because shapes drawn by hand to abut are never numerically coincident — measured 12.9 mm and 19.3 mm on real markup — and an un-snapped union keeps the internal wall it exists to remove), then surface = 2 x union_area + union_perimeter x ceiling_height. Floor and ceiling are AREAS (2 x union area); walls are PERIMETER x height. The earlier footprint x (2 + H) form is DEAD: it multiplied the floor AREA by the height to get the wall term, which is only correct in a 4 x 4 m room — it under-read small rooms (1x1: -62%) and over-read large ones (10x10: +49%). NET: surface minus (wall_strip + ceiling_strip + floor_strip), because a stripped surface is already paid for twice (strip rate + cavity remediation) and must not be charged a third time as a Condition 2 clean. A per-shape height override (c2H) puts a shape in its own height group for double-height stairwells and raked ceilings. condition2_m2 is an ALIAS OF THE NET so no consumer can accidentally read the gross; the gross is condition2_surface_m2 (audit only). 'Full strip' no longer exists — floor_strip and ceiling_strip are separate overlays.",
      rooms: exportRows.map((r) => {
        const rEq = eq.byRoom.get(r.roomId ?? null) || null;
        return {
        name: r.name, ceiling_height: r.ch,
        // the floor's TYPED label (never invented by the app); "" if Jordan hasn't labelled it yet
        floor: r.floorId ? (floors.find((f) => f.id === r.floorId)?.name || "") : null,
        // v5.0 VOID ROOM. The engine keys off void_type ONLY — never off the room name, which is
        // free text. An ordinary room is null here; a room merely NAMED "void" is an ordinary room.
        void_type: r.voidType || null,
        ...(r.voidWork ? {
          decon_m2: r.voidWork.decon_m2,
          insulation_batts_m2: r.voidWork.insulation_batts_m2,
          insulation_blown_m2: r.voidWork.insulation_blown_m2,
          void_decon: r.voidWork,
        } : {}),
        strip_room: (r.counts.floor_strip > 0 || r.counts.ceiling_strip > 0 || r.counts.wall_strip > 0),
        floor_strip_m2: round2(r.counts.floor_strip),
        ceiling_strip_m2: round2(r.counts.ceiling_strip),
        // NETTED figure (authoritative). condition2_m2 is an alias of the NET so that a consumer
        // reading the old key can never pick up the un-netted gross.
        condition2_net_m2: round2(r.counts.condition2),
        condition2_m2: round2(r.counts.condition2),
        condition2_surface_m2: r.c2 ? r.c2.surface_m2 : 0,
        // null when NO C2 zone is drawn — the nested audit object must agree with the
        // top-level 0, not carry a negative net the flat keys deny (found by the v7.0
        // close-out review: t3 lounge showed top-level 0 with nested net_m2 -10.7).
        condition2: r.c2 && r.c2.shapes.length ? r.c2 : null,
        cabinetry_face_m2: round2(r.counts.cabinetry),
        cabinetry_footprint_m2: round2(r.cabFootprint || 0),   // audit only — never priced
        cabinetry: r.cabWorking || null,
        contingent_m2: round2(r.counts.contingent),
        wall_strip_linm: round2(r.wallLinm), wall_strip_m2: round2(r.counts.wall_strip),
        wall_strip: r.wallWorking || null,
        // v7.5 item 3 — wall-CAVITY insulation removal (sum of the flagged lines' m²). Never part of
        // property.insulation_removal (roof-void / strip-ceiling, netted, batts vs blown split).
        wall_insulation_removal_m2: round2(r.wallInsulM2 || 0),
        cornice_linm: round2(r.corniceLinm), skirting_linm: round2(r.skirtingLinm),
        containment_count: r.counts.containment,
        // v7.0 item 1 — floor covering (detail verbatim from the selector; type is the 3-class
        // enum quantify already consumes). null when no floor-strip in the room or none chosen.
        floor_covering_detail: r.floorCovDetail,
        floor_covering_type: r.floorCovClass,
        // v7.0 item 9 — entered on the room row; quantify v7.06/v7.03 reads these and confirms
        // loudly when absent, so 0 is a REAL zero, not a default.
        electrical_fitting_count: r.elecFittings,
        plumbing_fixture_count: r.plumbFixtures,
        // v7.0 item 8 — equipment marker counts for THIS room (only present when markers exist)
        ...(rEq ? {
          split_ac_decon_insitu_count: rEq.split_ac_decon_insitu_count,
          split_ac_decommission_count: rEq.split_ac_decommission_count,
          afd_count: rEq.afd_count,
          dehumidifier_count: rEq.dehumidifier_count,
          drymatic_boost_count: rEq.drymatic_boost_count,
          heat_mats_m2: rEq.heat_mats_m2,
        } : {}),
        // v4.2 - internal productivity signals (QUANTITIES ONLY, never priced here)
        productivity: {
          setups: r.any ? 1 : 0,                       // one mobilisation per room entered
          wall_runs: r.wallRuns || 0,                  // separate strip runs / angle changes
          wall_run_avg_linm: round2(r.wallRunAvgLinm || 0),
          c2_shapes: r.c2 ? r.c2.shapes.length : 0,
          _note: "Set-up = one per room entered. wall_runs = separate drawn strip runs; a 90-degree change of angle is a new run. Short average run length and many set-ups = slower per m2; long continuous runs = faster per m2. For Jordan's internal judgement on the rate/hours only - NOT a client-facing figure and NOT priced by this app.",
        },
        plumbing_iso: r.plumbIso, electrical_iso: r.elecIso,
      };}),
      // Property scope is entered ONCE per job and is therefore already a combined total across
      // every floor — there is nothing for a downstream consumer to merge or de-duplicate.
      property: {
        // v7.0 item 8 — equipment TOTALS derived from placed markers (sum of rooms), under the
        // per-room names, PLUS legacy aliases so pre-v7 consumers keep reading a single number.
        split_ac_decon_insitu_count: eq.totals.split_ac_decon_insitu_count,
        split_ac_decommission_count: eq.totals.split_ac_decommission_count,
        afd_count: eq.totals.afd_count,
        dehumidifier_count: eq.totals.dehumidifier_count,
        drymatic_boost_count: eq.totals.drymatic_boost_count,
        heat_mats_m2: eq.totals.heat_mats_m2,
        // legacy aliases (DERIVED — see equipment_model; drop after the engine moves to *_count)
        afd_units: eq.totals.afd_count, adf_units: eq.totals.afd_count,
        dehum_units: eq.totals.dehumidifier_count,
        drymatic_units: eq.totals.drymatic_boost_count,
        ac_split_units: eq.totals.split_ac_decon_insitu_count,
        // ×days stay as job-level inputs (equipment duration is not a per-room fact)
        afd_days: parseFloat(property.afd_days) || 0, adf_days: parseFloat(property.afd_days) || 0,
        dehum_days: parseFloat(property.dehum_days) || 0,
        dbkii_days: parseFloat(property.dbkii_days) || 0,
        drymatic_days: parseFloat(property.drymatic_days) || 0,
        // v7.0 item 4 + 27 Aug ADDENDUM — drying_mat_units/days are DEAD, and the property
        // m² box is gone too: mats area rides ONLY on Drymatic markers (heat_mats_m2). This
        // key is DEPRECATED and always 0; the engine ignores it and CONFIRMs on non-zero.
        drying_mats_m2: 0,
        air_mover_units: parseFloat(property.air_mover_units) || 0, air_mover_days: parseFloat(property.air_mover_days) || 0,
        ac_ducted_units: parseFloat(property.ac_ducted_units) || 0,
        ac_duct_removal_rooms: parseFloat(property.ac_duct_removal_rooms) || 0,
        // v7.0 — pre-v7 unit counts that can NEVER be silently converted (counts have no marker
        // positions; drying-mat units are not m²). Present only when a legacy job carries them,
        // always with a hard flag. Gone once Jordan places the markers / enters the m².
        ...(Object.keys(legacyEquip).length ? { equipment_legacy: legacyEquip } : {}),
        // v7.0 item 9 — named containment zones (multi-room zones consolidated at the source;
        // per-room containment_count is retained for backward compatibility).
        containment_zones: cz.zones,
        prv_areas: parseFloat(property.prv_areas) || 0,
        contents_packout: !!property.contents_packout, contents_inventory: !!property.contents_inventory,
        contents_storage: property.contents_storage,
        skip_bin: !!property.skip_bin, asbestos_testing: !!property.asbestos_testing,
        // v5.0 — the void is a ROOM. This block is OMITTED ENTIRELY on a clean job. It survives
        // only while a legacy job still has roof-void shapes sitting outside a void room, so that
        // migrating cannot silently drop a quantity; whenever it appears, a hard ERROR flag
        // appears with it telling Jordan to move those shapes into an explicit void room.
        // Deleting the data instead of exporting it would be the silent-loss failure this whole
        // cycle exists to prevent — so it is omitted only when there is genuinely nothing in it.
        ...(pt.decon_m2 > 0 || pt.insBatts > 0 || pt.insBlown > 0 ? {
          roof_void_LEGACY_UNMIGRATED: {
            decon_m2: round2(pt.decon_m2), decon_mode: property.roof_void_mode,
            insulation_batts_m2: round2(pt.insBatts), insulation_blown_m2: round2(pt.insBlown),
            shapes: pt.roofWorking.shapes, working: pt.roofWorking.working,
          },
        } : {}),
        floor_protection_m2: round2(pt.floorProt),   // SUMMED across every floor
        // v6.0 item 3 — AUTHORITATIVE insulation-removal quantity. Already de-duplicated: the
        // geometric UNION per floor and per type of every insulation-flagged shape, whether it
        // came from a strip-ceiling or a roof-void shape. PRICE THIS. The per-room
        // insulation_batts_m2 / insulation_blown_m2 on void rooms are AUDIT ONLY and will
        // double-charge the overlap if summed — they are the un-netted per-room contributions.
        // v7.5 item 3 — wall-cavity insulation, summed over rooms. SEPARATE from insulation_removal
        // below: never add it into total_m2 / batts_m2 / blown_in_m2.
        wall_insulation_removal_m2: round2(exportRows.reduce((a, r) => a + (r.wallInsulM2 || 0), 0)),
        insulation_removal: { ...ins,
          _note: "AUTHORITATIVE and ALREADY NETTED (geometric union per floor, per type, with near-coincident edges snapped). Price total_m2 / batts_m2 / blown_in_m2 from HERE. NEVER derive insulation by summing the per-room insulation_batts_m2 / insulation_blown_m2 figures. Those exist ONLY on void rooms, so they OMIT every insulation-flagged strip-ceiling shape outside a void room — summing them UNDER-charges, and does so silently. Within a single void room they are also a plain per-shape sum, so two overlapping shapes there OVER-charge. The error runs in both directions depending on the markup, which is exactly why the netted figure here is the only pricing basis.",
        },
      },
      flags: [
        ...(shapes.some((s) => s.room == null && !catById(s.cat)?.propertyScope)
          ? [mkFlag("UNASSIGNED_SHAPES", "ERROR", "UNASSIGNED shapes present — reassign before pricing")] : []),
        // v7.0 item 8 — markers with no room would export counts against no room (orphan lines).
        ...(eq.unassigned > 0
          ? [mkFlag("UNASSIGNED_MARKERS", "ERROR", `ERROR — ${eq.unassigned} equipment marker(s) have NO ROOM. Select each marker and assign its room — an unassigned marker's count reaches the quote as an orphan line.`)] : []),
        // v7.0 item 8 — heat mats m² is REQUIRED on every drymatic marker; blank contributes 0.
        ...(eq.heatUnset > 0
          ? [mkFlag("HEAT_MATS_NOT_SET", "ERROR", `ERROR — ${eq.heatUnset} Drymatic boost marker(s) have NO heat mats m² entered. The marker counts, but its heat-mat area is contributing ZERO — enter the m² on each marker.`)] : []),
        // v7.0 — legacy unit counts riding along from a pre-v7 job. Never silently dropped,
        // never silently converted; Jordan places markers / enters m² and they disappear.
        ...(Object.keys(legacyEquip).length
          ? [mkFlag("EQUIPMENT_LEGACY_COUNTS", "ERROR", `ERROR — this job carries pre-v7.0 equipment unit counts (${Object.entries(legacyEquip).map(([k, v]) => `${k}=${v}`).join(", ")}) which CANNOT be auto-converted (counts have no positions; drying-mat units are not m²). They are exported under property.equipment_legacy. Place the equivalent markers / enter drying mats m², then clear the old values via a fresh save — do not price both.`)] : []),
        // v7.0 item 1 — floor covering is REQUIRED on floor-strip scope; never defaulted.
        ...roomRows().filter((r) => r.floorCovUnset)
          .map((r) => mkFlag("FLOOR_COVERING_NOT_SET", "ERROR",
            `ERROR — ${r.name}: floor-strip drawn with NO floor covering selected. Select the covering on each floor-strip shape — the strip rate depends on it, and the engine will not guess.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        ...roomRows().filter((r) => r.floorCovMixed)
          .map((r) => mkFlag("FLOOR_COVERING_MIXED", "FLAG",
            `FLAG — ${r.name}: floor-strip shapes carry MORE THAN ONE covering type. The room exports the area-dominant type (${r.floorCovDetail}); check that is what should price, or split the room.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        // Job-wide "nothing is calibrated at all". Per-floor gaps are reported separately below,
        // so adding an uncalibrated second floor never invalidates a calibrated first one.
        ...(!floors.some((f) => f.scale)
          ? [mkFlag("NOT_CALIBRATED", "ERROR", "NOT CALIBRATED — quantities invalid")] : []),
        // v5.0 per-floor guards. Only emit once a job genuinely has more than one floor, so a
        // single-floor v4.x job still exports byte-identically to v4.2.
        ...(floors.length > 1
          ? floors.filter((f) => !f.scale && shapes.some((s) => s.floorId === f.id))
              .map((f) => mkFlag("FLOOR_NOT_CALIBRATED", "ERROR",
                `ERROR — floor "${f.name || f.id}" has markup but NO CALIBRATION. Its quantities are invalid; calibrate that floor's plan.`,
                { floor: f.name || "" }))
          : []),
        // A floor carrying markup but never labelled — rooms would export floor:"" and the quote
        // could not say which storey they are on. Never auto-named, so it must be flagged.
        ...(floors.length > 1
          ? floors.filter((f) => !f.name?.trim() && (rooms.some((r) => r.floorId === f.id) || shapes.some((s) => s.floorId === f.id)))
              .map(() => mkFlag("FLOOR_NOT_LABELLED", "ERROR",
                `ERROR — a floor has markup but NO LABEL. Type its label (e.g. G / L1 / L2) — the app never names a floor for you.`,
                { floor: "" }))
          : []),
        // v5.0 — legacy roof-void shapes still outside a void room. NOT auto-migrated: creating a
        // void room would mean the app choosing its TYPE, and ceiling-vs-roof is a fact about the
        // building that only Jordan knows. Guessing it would set the wrong decon rate.
        ...(pt.decon_m2 > 0 || pt.insBatts > 0 || pt.insBlown > 0
          ? [mkFlag("ROOF_VOID_UNMIGRATED", "ERROR",
              `ERROR — ${round2(pt.decon_m2)} m² of roof-void decon is NOT inside a roof void room, so it is exported under property.roof_void_LEGACY_UNMIGRATED instead of against a floor and will read as an orphan line. On the floor it belongs to, use "+ Add roof void room", then reassign those shapes to it via the room selector. Existing shapes are never silently rebound — only you can say which room and floor they belong to.`)]
          : []),
        // v6.0 item 3 — batts and blown-in cannot both come out of the same square metre.
        ...(ins.cross_type_overlap
          ? [mkFlag("INSULATION_CROSS_TYPE_OVERLAP", "ERROR",
              `ERROR — insulation shapes of DIFFERENT types (batts vs blown-in) OVERLAP by ${round2(ins.batts_m2 + ins.blown_in_m2 - ins.total_m2)} m². The same area cannot have both removed, so one of them is wrong. total_m2 (${ins.total_m2}) is the union of everything and is safe to price; the batts/blown-in SPLIT is NOT — those two figures sum to more than the total, and they price differently. Fix the markup before relying on the split.`)]
          : []),
        // v6.0 — ceiling_void rooms are RETIRED. Existing ones are flagged, never silently
        // rebound or deleted: their decon belongs on strip-ceiling shapes now, and only Jordan
        // can decide how that scope should be redrawn.
        ...rooms.filter((r) => RETIRED_VOID_TYPES.has(r.void_type))
          .map((r) => mkFlag("CEILING_VOID_RETIRED", "ERROR",
            `ERROR — room "${r.name || "(unnamed)"}" is a CEILING VOID, which v6.0 retired. A ceiling void between storeys is now scoped with the strip-ceiling shape and its insulation option, not as its own room. Re-draw that scope and delete this room. Its quantities are still exported — nothing has been silently moved or dropped.`,
            { room: r.name || "", floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        // A void room with no name typed — it would export name:"" and the quote could not
        // identify it. Never auto-named, so it must be flagged.
        ...rooms.filter((r) => r.void_type && !r.name?.trim())
          .map((r) => mkFlag("VOID_ROOM_NOT_NAMED", "ERROR",
            `ERROR — a ${r.void_type === "roof_void" ? "roof" : "ceiling"} void room has NO NAME. Type one — the app never names a room for you.`,
            { room: "", floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        // A room NAMED like a void but with no void_type is an ordinary room. Flag it rather than
        // reinterpret it — inferring scope from a room name is the BMLJ00685 A6 defect class.
        ...rooms.filter((r) => !r.void_type && /\bvoid\b/i.test(r.name || ""))
          .map((r) => mkFlag("ROOM_NAMED_VOID_NO_TYPE", "FLAG",
            `FLAG — "${r.name}" is named like a void but has NO void_type, so it prices as an ORDINARY room. If it is a void, delete it and re-add it with + Add void room. The engine never infers a void from a name.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        ...roomRows().filter((r) => r.voidType && r.counts.roof_void_decon > 0 && property.roof_void_mode === "none")
          .map((r) => mkFlag("VOID_DECON_MODE_NONE", "FLAG",
            `FLAG — void room "${r.name}" has ${round2(r.counts.roof_void_decon)} m² drawn but Roof void decon is set to "None". The area is exported, NOT zeroed — reconcile before pricing.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        ...roomRows().filter((r) => r.floorMismatch)
          .map((r) => mkFlag("ROOM_FLOOR_MISMATCH", "ERROR",
            `ERROR — ${r.name}: contains shapes drawn on a different floor to the room itself. Those shapes' coordinates and scale disagree — reassign them, do not price this room.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        // ---- v4.0 D1.6 hard-error validations. A quantity that is not physically plausible must
        // never leave the app silently: every one of these passed every downstream gate before.
        ...roomRows().filter((r) => r.any && r.c2 && r.c2.shapes.length && r.c2.net_m2 <= 0)
          .map((r) => mkFlag("C2_NET_NOT_POSITIVE", "ERROR",
            `ERROR — ${r.name}: Condition 2 NET is ${r.c2.net_m2} m² (<= 0). Stripped area (${round2((r.counts.wall_strip||0)+(r.counts.ceiling_strip||0)+(r.counts.floor_strip||0))} m²) meets or exceeds the computed C2 surface (${r.c2.surface_m2} m²). This is the double-height / stairwell signature — set a per-shape height override (c2H) or supply a manual C2 total. DO NOT PRICE THIS AS ZERO.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        ...roomRows().filter((r) => r.any && r.c2 && r.c2.shapes.length && r.c2.surface_m2 > 6 * ((r.counts.wall_strip||0)+(r.counts.ceiling_strip||0)+(r.counts.floor_strip||0)) && ((r.counts.wall_strip||0)+(r.counts.ceiling_strip||0)+(r.counts.floor_strip||0)) > 0)
          .map((r) => mkFlag("C2_SURFACE_OVER_STRIPPED", "FLAG",
            `FLAG — ${r.name}: C2 surface ${r.c2.surface_m2} m² exceeds 6x the stripped area — possible whole-room over-read.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        ...roomRows().filter((r) => r.any && r.c2 && r.c2.shapes.length && !r.chSet)
          .map((r) => mkFlag("C2_NO_CEILING_HEIGHT", "ERROR",
            `ERROR — ${r.name}: Condition 2 zone drawn with NO ceiling height set. The surface has been computed at the 2.4 m default — set the real height or confirm 2.4 is correct.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
        ...roomRows().filter((r) => r.cabMissingH)
          .map((r) => mkFlag("CABINETRY_NO_HEIGHT", "ERROR",
            `ERROR — ${r.name}: cabinetry drawn with NO height selected. Cabinetry prices on FACE area (perimeter x height) — a footprint cannot be priced.`,
            { room: r.name, floor: floors.find((f) => f.id === r.floorId)?.name || "" })),
      ],
    };
  };

  // v6.0 item 4 — STRUCTURED FLAGS.
  // `code` is the stable machine key: assert on it, NEVER on `message`. Message prose gets
  // reworded (three were reworded during the v6.0 build alone, one of them in the same session
  // that introduced it), and an assertion keyed to prose breaks on a change that looks purely
  // cosmetic from the app side.
  // `severity` uses the app's own long-standing vocabulary, matching the message prefixes:
  //   "ERROR" — do not price this; something is wrong or missing.
  //   "FLAG"  — price it, but a human should look first.
  // `room` / `floor` are present where the flag is attributable to one. `floor` is the floor's
  // TYPED label, so it is "" precisely when FLOOR_NOT_LABELLED fires — use floors[] order there.
  const mkFlag = (code, severity, message, extra) => ({ code, severity, message, ...(extra || {}) });

  return { scaleOfFloor, scaleOf, wallInsulationOn, fmt, chOf, roomCH, wallEffHeight, lenOf, cabHOf, cabFaceOf, qtyOf, shapeLabel,
           roomRows, computePropertyTotals, computeInsulationRemoval, computeEquipment, computeContainmentZones,
           round2, buildExport, mkFlag };
}
