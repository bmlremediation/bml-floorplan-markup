import React, { useState, useRef, useEffect, useCallback } from "react";
import { listJobs, getJob, putJob, deleteJob as dbDeleteJob, getImageBlob, putImageBlob, dataURLToBlob, blobToDataURL } from "./db.js";

// ---------- BML markup convention (v3.2 — mirrors bml-floorplan-quantify-quote) ----------
// "Full strip" removed (v3.1): floor_strip + ceiling_strip drawn separately instead.
// roof_void_decon / floor_protection (v3.2) are PROPERTY-SCOPE: room assignment is ignored,
// they're excluded from every per-room row and from the UNASSIGNED flag, and are aggregated
// globally into the Property-wide block / export.property block instead.
const CATS = [
  { id: "floor_strip",   label: "Strip floor coverings + remediate subfloor surface",              kind: "fill", color: "#FF00FF" },
  { id: "ceiling_strip", label: "Strip ceiling linings + remediate cavity surfaces then contain",   kind: "fill", color: "#FFFF00" },
  { id: "condition2",    label: "Condition 2 clean all surfaces",                                   kind: "fill", color: "#00B0F0" },
  { id: "cabinetry",     label: "Cabinetry strip",                                                   kind: "fill", color: "#6600FF" },
  { id: "contingent",    label: "Contingent (provisional)",                                          kind: "fill", color: "#FF9900" },
  { id: "wall_strip",    label: "Wall strip",                                                        kind: "line", color: "#EE0000" },
  { id: "containment",   label: "Containment set-up",                                                kind: "line", color: "#4EA72E" },
  { id: "roof_void_decon", label: "Roof void / ceiling cavity decontamination", kind: "fill", color: "#795548", propertyScope: true },
  { id: "floor_protection", label: "Floor protection",                          kind: "fill", color: "#9E9E9E", propertyScope: true },
];
const catById = (id) => CATS.find((c) => c.id === id);
const FILL_OPACITY = 0.35;
const MIN_PX = 4;

// Wall-strip removal-height options. 'full' means "use the room's ceiling height".
const HEIGHTS = [
  { value: "full", label: "Full height" },
  { value: 1.2,    label: "1200 mm" },
  { value: 0.6,    label: "600 mm" },
  { value: 0.3,    label: "300 mm" },
];
const INSULATION_TYPES = [
  { value: "batts",    label: "Batts" },
  { value: "blown_in", label: "Blown-in fill" },
];
const ROOF_VOID_MODES = [
  { value: "all_surfaces",     label: "All surfaces" },
  { value: "visibly_affected", label: "Visibly affected only" },
];
const STORAGE_MODES = [
  { value: "none",    label: "None" },
  { value: "onsite",  label: "Onsite" },
  { value: "offsite", label: "Offsite" },
];
const DEFAULT_PROPERTY = {
  adf_units: "", adf_days: "", dehum_units: "", dehum_days: "", dbkii_days: "",
  ac_ducted_units: "", ac_split_units: "", prv_areas: "",
  contents_packout: false, contents_inventory: false, skip_bin: false, asbestos_testing: false,
  contents_storage: "none", roof_void_mode: "all_surfaces",
};
// Cabinetry face-height presets (D1.4, Jordan ruling 26 Jul 2026 — perimeter × height).
// "" = not yet selected (validation flag); "custom" is a UI-only sentinel, never priced itself.
const CAB_HEIGHTS = [
  { value: "0.9", label: "Base 0.9 m" },
  { value: "2.1", label: "Tall 2.1 m" },
  { value: "2.4", label: "Full 2.4 m" },
];

const APP_VERSION = "v4.0";
const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";

// ---------- edge snapping (v4.2) ----------
// Shapes drawn by hand to visually abut are never numerically coincident. Measured on the real
// BMLJ00685 garage markup: 12.9 mm and 19.3 mm between edges that are plainly the same wall.
// A strict union therefore treats them as separate islands and KEEPS the internal wall that the
// union exists to remove. So: cluster near-coincident edge coordinates onto a shared value
// FIRST, then union. SNAP_PX is in raw plan px; at a typical calibration that is ~25 mm, which
// is below drawing precision but well above pixel noise.
const SNAP_PX = 3;
function snapRects(rects) {
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
function unionPerimeterPx(rawRects) {
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
function unionAreaPx(rawRects) {
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

export default function App() {
  const [view, setView] = useState("home"); // home | editor
  const [index, setIndex] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [storageOk] = useState(typeof window !== "undefined" && !!window.indexedDB);
  const [saveState, setSaveState] = useState("idle"); // idle | dirty | saving | saved | error
  const [busy, setBusy] = useState(false);

  // image + view
  const [img, setImg] = useState(null); // {src, w, h}
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // job + rooms
  const [jobName, setJobName] = useState("");
  const [rooms, setRooms] = useState([]); // {id, name, ch, plumbIso, elecIso}
  const [activeRoom, setActiveRoom] = useState(null);
  // tools
  const [tool, setTool] = useState("select");
  const [activeCat, setActiveCat] = useState("floor_strip");
  const [wallHgt, setWallHgt] = useState("full"); // default removal height for NEW wall_strip lines
  const [wallCornice, setWallCornice] = useState(false);
  const [wallSkirting, setWallSkirting] = useState(false);
  const [wallSkirtingOnly, setWallSkirtingOnly] = useState(false);
  const [roofInsulation, setRoofInsulation] = useState(false);
  const [roofInsulationType, setRoofInsulationType] = useState("batts");
  const [cabHgt, setCabHgt] = useState("");        // default cabH for NEW cabinetry shapes: "" | "0.9" | "2.1" | "2.4" | "custom"
  const [cabHgtCustom, setCabHgtCustom] = useState("");
  // shapes
  const [shapes, setShapes] = useState([]);
  const [selId, setSelId] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  // calibration
  const [calLine, setCalLine] = useState(null);
  const [calInput, setCalInput] = useState("");
  const [calUnit, setCalUnit] = useState("m");
  const [scale, setScale] = useState(null);
  const [measure, setMeasure] = useState(null);
  // property-wide scope (v3.2 — quantities/checkboxes only, never priced)
  const [property, setProperty] = useState(DEFAULT_PROPERTY);
  // visibility toggles (cosmetic only — canvas display, never affects quantities/export)
  const [hiddenCats, setHiddenCats] = useState(() => new Set());
  const [hiddenRooms, setHiddenRooms] = useState(() => new Set());
  // collapsible panel sections (not persisted)
  const [collapsed, setCollapsed] = useState({});
  // export / import modals (copy/paste kept for Cowork paste-in convenience)
  const [exportModal, setExportModal] = useState(null); // {title, hint, text, filename}
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [copyMsg, setCopyMsg] = useState("");

  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const drag = useRef(null);
  const spaceDown = useRef(false);
  const idRef = useRef(1);
  const nid = () => idRef.current++;
  const saveTimer = useRef(null);
  const loadedRef = useRef(false); // suppress autosave during hydration
  const pendingRescale = useRef(null); // {w,h} of original image when importing a markup-only project
  const taRef = useRef(null);

  // ---------- home: load job index ----------
  useEffect(() => { if (storageOk) listJobs().then(setIndex).catch(() => setIndex([])); }, [storageOk]);

  // ---------- job lifecycle ----------
  const newJob = () => {
    const id = String(Date.now());
    setJobId(id); setJobName(""); setRooms([]); setActiveRoom(null);
    setShapes([]); setCalLine(null); setScale(null); setSelId(null); setUndoStack([]);
    setImg(null); idRef.current = 1; loadedRef.current = true;
    pendingRescale.current = null;
    setProperty(DEFAULT_PROPERTY);
    setHiddenCats(new Set()); setHiddenRooms(new Set());
    setSaveState("idle"); setView("editor");
  };

  const openJob = async (id) => {
    setBusy(true); loadedRef.current = false;
    const meta = await getJob(id);
    if (!meta) { setBusy(false); alert("Job data missing or corrupted."); return; }
    let src = null;
    if (meta.imgW) {
      const blob = await getImageBlob(id);
      if (!blob) alert("Floor plan image missing — re-load the image; markup is intact.");
      else src = await blobToDataURL(blob);
    }
    setJobId(id); setJobName(meta.name || ""); setRooms(meta.rooms || []);
    setActiveRoom(meta.rooms?.[0]?.id ?? null);
    setShapes(meta.shapes || []); setCalLine(meta.calLine || null); setScale(meta.scale ?? null);
    setSelId(null); setUndoStack([]);
    setProperty({ ...DEFAULT_PROPERTY, ...(meta.property || {}) });
    setHiddenCats(new Set()); setHiddenRooms(new Set());
    pendingRescale.current = null;
    idRef.current = Math.max(1, ...(meta.shapes || []).map((s) => s.id + 1), ...(meta.rooms || []).map((r) => r.id + 1));
    if (src && meta.imgW) {
      setImg({ src, w: meta.imgW, h: meta.imgH });
      requestAnimationFrame(() => fitView(meta.imgW, meta.imgH));
    } else setImg(null);
    setSaveState("saved"); setBusy(false); loadedRef.current = true; setView("editor");
  };

  const deleteJob = async (id) => {
    if (!window.confirm("Delete this job and its markup permanently?")) return;
    await dbDeleteJob(id);
    const next = index.filter((j) => j.id !== id);
    setIndex(next);
  };

  const persistMeta = useCallback(async (imgW, imgH) => {
    if (!storageOk || !jobId) return;
    setSaveState("saving");
    try {
      const meta = {
        id: jobId, name: jobName, rooms, shapes, calLine, scale, property,
        imgW: imgW ?? img?.w ?? 0, imgH: imgH ?? img?.h ?? 0,
        savedAt: new Date().toISOString(),
      };
      await putJob(meta);
      const entry = { id: jobId, name: jobName || "Unnamed job", savedAt: meta.savedAt };
      setIndex((prev) => [entry, ...prev.filter((j) => j.id !== jobId)]);
      setSaveState("saved");
    } catch { setSaveState("error"); }
  }, [storageOk, jobId, jobName, rooms, shapes, calLine, scale, property, img]);

  // autosave (debounced) on any markup change
  useEffect(() => {
    if (view !== "editor" || !storageOk || !loadedRef.current || !jobId) return;
    setSaveState("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistMeta(), 1200);
    return () => clearTimeout(saveTimer.current);
  }, [shapes, rooms, jobName, scale, calLine, property]); // eslint-disable-line

  // ---------- image input (compress -> persist as Blob) ----------
  const loadImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = async () => {
        let { src, w, h } = normaliseImage(im, r.result);
        setImg({ src, w, h });
        setSelId(null);
        // If a markup-only project was imported, rescale its coordinates to this image
        const pr = pendingRescale.current;
        if (pr && pr.w > 0) {
          const f = w / pr.w;
          const aspectOk = Math.abs(h / w - pr.h / pr.w) < 0.02;
          if (f !== 1) {
            setShapes((prev) => prev.map((s) => s.type === "rect"
              ? { ...s, x: s.x * f, y: s.y * f, w: s.w * f, h: s.h * f }
              : { ...s, x1: s.x1 * f, y1: s.y1 * f, x2: s.x2 * f, y2: s.y2 * f }));
            setCalLine((c) => c ? { x1: c.x1 * f, y1: c.y1 * f, x2: c.x2 * f, y2: c.y2 * f } : c);
            setScale((sc) => (sc ? sc / f : sc));
          }
          if (!aspectOk) alert("Warning: this image's aspect ratio differs from the original plan — markup may be misaligned. Verify against the plan and re-check calibration with Measure before exporting.");
          pendingRescale.current = null;
        }
        requestAnimationFrame(() => fitView(w, h));
        // persist image blob
        if (storageOk && jobId) {
          setSaveState("saving");
          try {
            const blob = dataURLToBlob(src);
            await putImageBlob(jobId, blob);
            await persistMeta(w, h);
          } catch { setSaveState("error"); }
        }
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  };

  // cap dimensions + re-encode large PNGs to JPEG to fit storage comfortably
  const normaliseImage = (im, dataURL) => {
    const MAXDIM = 3000;
    let w = im.naturalWidth, h = im.naturalHeight;
    const needScale = Math.max(w, h) > MAXDIM;
    const needRecode = dataURL.length > 6_000_000;
    if (!needScale && !needRecode) return { src: dataURL, w, h };
    const f = needScale ? MAXDIM / Math.max(w, h) : 1;
    w = Math.round(w * f); h = Math.round(h * f);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(im, 0, 0, w, h);
    let out = cv.toDataURL("image/jpeg", 0.85);
    if (out.length > 9_000_000) out = cv.toDataURL("image/jpeg", 0.7);
    return { src: out, w, h };
  };

  useEffect(() => {
    const onPaste = (e) => {
      if (view !== "editor" || importOpen || exportModal) return;
      for (const it of e.clipboardData?.items || []) {
        if (it.type.startsWith("image/")) { loadImageFile(it.getAsFile()); e.preventDefault(); return; }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // re-bind each render so jobId is fresh

  const fitView = (w, h) => {
    const el = wrapRef.current; if (!el) return;
    const z = Math.min((el.clientWidth - 40) / w, (el.clientHeight - 40) / h, 2);
    setZoom(z > 0 ? z : 1);
    setPan({ x: (el.clientWidth - w * z) / 2, y: (el.clientHeight - h * z) / 2 });
  };

  // ---------- coordinate helpers ----------
  const toImg = (e) => {
    const r = innerRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const pushUndo = useCallback(() => setUndoStack((s) => [...s.slice(-49), shapes]), [shapes]);

  // ---------- pointer handling ----------
  const onPointerDown = (e) => {
    if (!img) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (tool === "pan" || spaceDown.current || e.button === 1) {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, p: { ...pan } }; return;
    }
    const pt = toImg(e);
    if (tool === "select") {
      const sel = shapes.find((s) => s.id === selId);
      if (sel) {
        const h = hitHandle(sel, pt);
        if (h !== null) { pushUndo(); drag.current = { mode: "handle", h, id: sel.id }; return; }
      }
      // Click-to-cycle-underneath: collect every shape under the point, topmost first (z-order
      // = draw order, so reverse). If the current selection is among them, advance to the next
      // one down (wrapping back to the top) so a shape hidden underneath another is reachable by
      // clicking the same spot again. A fresh click (no prior selection at this point) always
      // grabs the topmost hit, so normal click-drag is unaffected.
      const hits = [...shapes].reverse().filter((s) => hitShape(s, pt));
      let hit = null;
      if (hits.length) {
        const idx = selId != null ? hits.findIndex((s) => s.id === selId) : -1;
        hit = idx === -1 ? hits[0] : hits[(idx + 1) % hits.length];
      }
      if (hit) { setSelId(hit.id); pushUndo(); drag.current = { mode: "move", id: hit.id, sx: pt.x, sy: pt.y, orig: { ...hit } }; }
      else setSelId(null);
      return;
    }
    if (tool === "draw") {
      const cat = catById(activeCat);
      pushUndo();
      const s = cat.kind === "fill"
        ? { id: nid(), type: "rect", cat: cat.id, room: activeRoom, x: pt.x, y: pt.y, w: 0, h: 0,
            ...(cat.id === "roof_void_decon" ? { insulation: roofInsulation, insulationType: roofInsulationType } : {}),
            ...(cat.id === "cabinetry" ? { cabH: cabHgt === "custom" ? cabHgtCustom : cabHgt } : {}) }
        : { id: nid(), type: "line", cat: cat.id, room: activeRoom, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
            ...(cat.id === "wall_strip" ? { hgt: wallHgt, cornice: wallCornice, skirting: wallSkirting, skirtingOnly: wallSkirtingOnly } : {}) };
      setShapes((a) => [...a, s]);
      drag.current = { mode: "new", id: s.id, sx: pt.x, sy: pt.y };
      return;
    }
    if (tool === "calibrate") { setCalLine({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }); drag.current = { mode: "cal" }; return; }
    if (tool === "measure")   { setMeasure({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }); drag.current = { mode: "meas" }; return; }
  };

  const onPointerMove = (e) => {
    const d = drag.current; if (!d) return;
    if (d.mode === "pan") { setPan({ x: d.p.x + e.clientX - d.sx, y: d.p.y + e.clientY - d.sy }); return; }
    const pt = toImg(e);
    const axis = (p1, p) => e.shiftKey
      ? (Math.abs(p.x - p1.x) > Math.abs(p.y - p1.y) ? { x: p.x, y: p1.y } : { x: p1.x, y: p.y })
      : p;
    if (d.mode === "new") {
      setShapes((a) => a.map((s) => {
        if (s.id !== d.id) return s;
        if (s.type === "rect") return { ...s, x: Math.min(d.sx, pt.x), y: Math.min(d.sy, pt.y), w: Math.abs(pt.x - d.sx), h: Math.abs(pt.y - d.sy) };
        const p2 = axis({ x: s.x1, y: s.y1 }, pt);
        return { ...s, x2: p2.x, y2: p2.y };
      }));
    } else if (d.mode === "move") {
      const dx = pt.x - d.sx, dy = pt.y - d.sy, o = d.orig;
      setShapes((a) => a.map((s) => s.id !== d.id ? s :
        s.type === "rect" ? { ...s, x: o.x + dx, y: o.y + dy }
                          : { ...s, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }));
    } else if (d.mode === "handle") {
      setShapes((a) => a.map((s) => {
        if (s.id !== d.id) return s;
        if (s.type === "rect") {
          const x2 = s.x + s.w, y2 = s.y + s.h;
          if (d.h === 0) return norm(pt.x, pt.y, x2, y2, s);
          if (d.h === 1) return norm(s.x, pt.y, pt.x, y2, s);
          if (d.h === 2) return norm(pt.x, s.y, x2, pt.y, s);
          return norm(s.x, s.y, pt.x, pt.y, s);
        }
        const p = d.h === 0 ? axis({ x: s.x2, y: s.y2 }, pt) : axis({ x: s.x1, y: s.y1 }, pt);
        return d.h === 0 ? { ...s, x1: p.x, y1: p.y } : { ...s, x2: p.x, y2: p.y };
      }));
    } else if (d.mode === "cal") {
      setCalLine((c) => { const p = axis({ x: c.x1, y: c.y1 }, pt); return { ...c, x2: p.x, y2: p.y }; });
    } else if (d.mode === "meas") {
      setMeasure((c) => { const p = axis({ x: c.x1, y: c.y1 }, pt); return { ...c, x2: p.x, y2: p.y }; });
    }
  };
  const norm = (ax, ay, bx, by, s) => ({ ...s, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });

  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (d?.mode === "new") {
      setShapes((a) => a.filter((s) => {
        if (s.id !== d.id) return true;
        const ok = s.type === "rect" ? (s.w > MIN_PX && s.h > MIN_PX) : Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > MIN_PX;
        if (!ok) setUndoStack((u) => u.slice(0, -1));
        return ok;
      }));
    }
  };

  const onWheel = (e) => {
    if (!img) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nz = Math.min(8, Math.max(0.05, zoom * factor));
    const r = wrapRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    setPan({ x: cx - (cx - pan.x) * (nz / zoom), y: cy - (cy - pan.y) * (nz / zoom) });
    setZoom(nz);
  };

  useEffect(() => {
    const kd = (e) => {
      if (e.code === "Space") spaceDown.current = true;
      if ((e.key === "Delete" || e.key === "Backspace") && selId && !isTyping(e)) {
        pushUndo(); setShapes((a) => a.filter((s) => s.id !== selId)); setSelId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !isTyping(e)) {
        setUndoStack((u) => { if (!u.length) return u; setShapes(u[u.length - 1]); return u.slice(0, -1); });
      }
    };
    const ku = (e) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [selId, pushUndo]);
  const isTyping = (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

  // hit tests
  const hitShape = (s, p) => {
    const t = 6 / zoom;
    if (s.type === "rect") return p.x >= s.x - t && p.x <= s.x + s.w + t && p.y >= s.y - t && p.y <= s.y + s.h + t;
    return distToSeg(p, s) < t + 4 / zoom;
  };
  const distToSeg = (p, s) => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(p.x - s.x1, p.y - s.y1);
    let t = ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy));
  };
  const handlesOf = (s) => s.type === "rect"
    ? [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x, y: s.y + s.h }, { x: s.x + s.w, y: s.y + s.h }]
    : [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
  const hitHandle = (s, p) => {
    const hs = handlesOf(s), t = 8 / zoom;
    for (let i = 0; i < hs.length; i++) if (Math.hypot(p.x - hs[i].x, p.y - hs[i].y) < t) return i;
    return null;
  };

  // ---------- calibration ----------
  const calPx = calLine ? Math.hypot(calLine.x2 - calLine.x1, calLine.y2 - calLine.y1) : 0;
  const applyScale = () => {
    const v = parseFloat(calInput);
    if (!v || !calPx) return;
    setScale((calUnit === "mm" ? v / 1000 : v) / calPx);
    setTool("select");
  };

  // ---------- quantities ----------
  const fmt = (v, d = 2) => v.toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d });
  const chOf = (room) => parseFloat(room?.ch) || 2.4; // room.ch is stored as a raw string (decimal-entry fix, v3.2)
  const roomCH = (roomId) => chOf(rooms.find((r) => r.id === roomId));
  const wallEffHeight = (s) => (s.hgt === "full" || s.hgt == null ? roomCH(s.room) : s.hgt);
  const lenOf = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * scale; // raw line length in m
  // v4.0 — cabinetry FACE area. Cabinetry is priced on the VERTICAL FACE it presents, never on
  // its plan footprint: a 2.4 m full-height unit and a 0.9 m base unit with identical footprints
  // are not the same job. face = perimeter x height (Jordan ruling, 26 Jul 2026 — supersedes the
  // footprint/depth-ratio method). Height comes from the shape's own selector (s.cabH), so it is
  // chosen in the app and computed BEFORE export.
  const cabHOf = (s) => parseFloat(s.cabH) || null;      // null = not yet selected
  const cabFaceOf = (s) => {
    if (!scale) return 0;
    const h = cabHOf(s); if (!h) return 0;               // unset height -> 0 + a hard validation flag
    const Lm = s.w * scale, Wm = s.h * scale;
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
    if (!scale) return null;
    if (s.type === "rect") {
      const area = s.w * s.h * scale * scale;
      if (s.cat === "cabinetry") return cabFaceOf(s);     // FACE m², not footprint
      return area;                                       // condition2 -> footprint (combined later)
    }
    const len = lenOf(s);
    if (s.cat === "wall_strip") return s.skirtingOnly ? 0 : len * wallEffHeight(s);
    return len;
  };
  const shapeLabel = (s) => {
    if (!scale) return "no scale";
    if (s.cat === "containment") return "containment";
    if (s.cat === "wall_strip" && s.skirtingOnly) return `${fmt(lenOf(s))} m skirting`;
    const q = qtyOf(s);
    if (s.cat === "cabinetry") {
      const L = s.w * scale, W = s.h * scale, h = cabHOf(s);
      if (!h) return `${fmt(L)}×${fmt(W)} m — set height ⚠`;
      return `${fmt(L)}×${fmt(W)} m, h=${fmt(h, 2)} = ${fmt(q)} m² face`;
    }
    if (s.type === "rect") {
      const L = s.w * scale, W = s.h * scale;
      return s.cat === "condition2" ? `${fmt(L)}×${fmt(W)} m = ${fmt(q)} m² fp` : `${fmt(L)}×${fmt(W)} m = ${fmt(q)} m²`;
    }
    if (s.cat === "wall_strip") {
      const len = lenOf(s), ch = wallEffHeight(s);
      return `${fmt(len)}×${fmt(ch)} m = ${fmt(q)} m²`;
    }
    return `${fmt(q)} m`;
  };
  const roomRows = () => {
    const ids = [...rooms.map((r) => r.id), null];
    return ids.map((rid) => {
      const room = rooms.find((r) => r.id === rid);
      // property-scope shapes (roof void / floor protection) never belong to a per-room row
      const rs = shapes.filter((s) => (s.room ?? null) === rid && !catById(s.cat)?.propertyScope);
      if (!room && rs.length === 0) return null;
      const row = {
        name: room ? room.name : "Unassigned", ch: room ? chOf(room) : 2.4, isUnassigned: !room,
        plumbIso: room ? !!room.plumbIso : false, elecIso: room ? !!room.elecIso : false,
        counts: {}, wallLinm: 0, corniceLinm: 0, skirtingLinm: 0, any: rs.length > 0,
      };
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
          row.wallWorking = {
            lines: cs.map((s) => ({ length_m: round2(lenOf(s)), height_m: s.skirtingOnly ? null : round2(wallEffHeight(s)),
              m2: round2(qtyOf(s) || 0), cornice: !!s.cornice, skirting: !!s.skirting, skirtingOnly: !!s.skirtingOnly })),
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
      }
      // ---- v4.0 CONDITION 2: UNION footprints per height-group FIRST, apply the factor ONCE
      // per group, then NET. A shape's own height override (D1.5 — stairwell/raked/void) puts
      // it in its own group so it gets its own surface factor instead of averaging into the room.
      // Overlapping/abutting shapes within a group are netted via unionAreaPx (D1.2) — summing
      // raw footprints would double-count any overlap.
      const c2s = rs.filter((s) => s.cat === "condition2");
      const c2Shapes = c2s.map((s) => ({
        s, w: round2(s.w * scale), l: round2(s.h * scale), m2: round2(s.w * s.h * scale * scale),
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
        const unionM2raw = unionAreaPx(rects) * scale * scale;
        const unionPerimM = unionPerimeterPx(rects) * scale;
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
          const gFp = round2(unionAreaPx(group.map((g) => ({ x: g.s.x, y: g.s.y, w: g.s.w, h: g.s.h }))) * scale * scale);
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
      row.counts.condition2 = round2(c2Net);   // NET is the priced figure
      // D1.3 — cabinetry working (footprint -> perimeter x height -> face).
      const cabShapes = rs.filter((s) => s.cat === "cabinetry");
      row.cabMissingH = cabShapes.some((s) => !cabHOf(s));
      row.cabFootprint = cabShapes.reduce((a, s) => a + s.w * s.h * scale * scale, 0);
      row.cabWorking = {
        shapes: cabShapes.map((s) => {
          const L = round2(s.w * scale), W = round2(s.h * scale), h = cabHOf(s), perimeter_m = round2(2 * (L + W));
          return { w: L, l: W, perimeter_m, height_m: h, face_m2: h ? round2(perimeter_m * h) : 0 };
        }),
        footprint_m2: round2(row.cabFootprint), face_m2: round2(row.counts.cabinetry),
        working: cabShapes.length
          ? cabShapes.map((s) => {
              const L = round2(s.w * scale), W = round2(s.h * scale), h = cabHOf(s);
              return h ? `(2×(${L}+${W}))×${h}` : `(${L}×${W}) NO HEIGHT`;
            }).join(" + ") + ` = ${round2(row.counts.cabinetry)} m² face`
          : "no cabinetry drawn",
      };
      return row;
    }).filter(Boolean);
  };
  // Global totals for the two property-scope drawn categories (room assignment ignored).
  const computePropertyTotals = () => {
    const roofShapes = shapes.filter((s) => s.cat === "roof_void_decon");
    const decon_m2 = roofShapes.reduce((a, s) => a + (qtyOf(s) || 0), 0);
    const insBatts = roofShapes.filter((s) => s.insulation && s.insulationType === "batts").reduce((a, s) => a + (qtyOf(s) || 0), 0);
    const insBlown = roofShapes.filter((s) => s.insulation && s.insulationType === "blown_in").reduce((a, s) => a + (qtyOf(s) || 0), 0);
    const floorProt = shapes.filter((s) => s.cat === "floor_protection").reduce((a, s) => a + (qtyOf(s) || 0), 0);
    // D1.3 — roof-void working (shape list + human-readable calculation).
    const roofWorking = {
      shapes: roofShapes.map((s) => ({ w: round2(s.w * scale), l: round2(s.h * scale), m2: round2(qtyOf(s) || 0),
        insulation: !!s.insulation, insulationType: s.insulation ? s.insulationType : null })),
      decon_m2: round2(decon_m2), insulation_batts_m2: round2(insBatts), insulation_blown_m2: round2(insBlown),
      working: roofShapes.length
        ? roofShapes.map((s) => `(${round2(s.w * scale)}×${round2(s.h * scale)})`).join(" + ") + ` = ${round2(decon_m2)} m² decon`
        : "no roof void zone drawn",
    };
    return { decon_m2, insBatts, insBlown, floorProt, roofWorking };
  };
  // Per-category display lines for the quantities panel — floor/ceiling strip each
  // produce two labelled outputs from the same underlying figure (strip + matching decon).
  const categoryLines = (c, row) => {
    if (c.id === "containment") {
      const v = row.counts.containment;
      return v ? [{ label: "Containment set-up", text: `${v} ×` }] : [];
    }
    if (c.id === "wall_strip") {
      const lines = [];
      if (row.wallLinm) lines.push({ label: "Wall strip", text: `${fmt(row.wallLinm)} lm → ${fmt(row.counts.wall_strip)} m²` });
      if (row.corniceLinm) lines.push({ label: "Cornice removal", text: `${fmt(row.corniceLinm)} lm` });
      if (row.skirtingLinm) lines.push({ label: "Skirting removal", text: `${fmt(row.skirtingLinm)} lm` });
      return lines;
    }
    // v4.0 — Condition 2 is NETTED; the headline IS the priced figure. Shown even when
    // net <= 0 (never silently hidden — D1.6) with a sub-line showing the working.
    if (c.id === "condition2") {
      if (!row.c2 || !row.c2.shapes.length) return [];
      const isBad = row.c2.net_m2 <= 0;
      const stripTotal = round2(row.c2.deductions.wall_strip + row.c2.deductions.ceiling_strip + row.c2.deductions.floor_strip);
      return [
        { label: "Condition 2 clean (NET)", text: `${fmt(row.c2.net_m2)} m²`, danger: isBad },
        { label: "  surface − strip", text: `${fmt(row.c2.surface_m2)} − ${fmt(stripTotal)}`, sub: true },
      ];
    }
    // v4.0 — cabinetry prices on FACE area; unset height is a hard-error state, shown loudly
    // rather than as a silent 0.
    if (c.id === "cabinetry") {
      if (!row.counts.cabinetry && !row.cabMissingH) return [];
      return [{ label: "Cabinetry face", text: row.cabMissingH ? "set height ⚠" : `${fmt(row.counts.cabinetry)} m²`, danger: row.cabMissingH }];
    }
    const v = row.counts[c.id];
    if (!v) return [];
    if (c.id === "floor_strip") return [
      { label: "Floor lining strip", text: `${fmt(v)} m²` },
      { label: "Subfloor decontamination", text: `${fmt(v)} m²` },
    ];
    if (c.id === "ceiling_strip") return [
      { label: "Ceiling lining strip", text: `${fmt(v)} m²` },
      { label: "Ceiling cavity decontamination", text: `${fmt(v)} m²` },
    ];
    if (c.id === "contingent") return [{ label: "Contingent (provisional)", text: `${fmt(v)} m²` }];
    return [{ label: c.label, text: `${fmt(v)} m²` }];
  };

  // ---------- visibility toggles (cosmetic only) ----------
  const toggleHiddenCat = (id) => setHiddenCats((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleHiddenRoom = (id) => setHiddenRooms((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const showAll = () => { setHiddenCats(new Set()); setHiddenRooms(new Set()); };

  // ---------- collapsible sections ----------
  const toggleSection = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const sectionHead = (id, title) => (
    <div style={{ ...st.h, cursor: "pointer", userSelect: "none" }} onClick={() => toggleSection(id)}>
      {collapsed[id] ? "▸" : "▾"} {title}
    </div>
  );

  // ---------- property scope field helpers ----------
  const setProp = (k, v) => setProperty((p) => ({ ...p, [k]: v }));
  const propNumField = (label, k) => (
    <label key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, gap: 4 }}>
      {label}
      <input value={property[k]} onChange={(e) => setProp(k, e.target.value)} inputMode="decimal"
        style={{ width: 46, background: "#15171b", border: "1px solid #2b2f37", color: "#e8e6e1", borderRadius: 4, padding: "2px 4px", textAlign: "right", fontSize: 11.5 }} />
    </label>
  );
  const propCheckField = (label, k) => (
    <label key={k} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11.5 }}>
      <input type="checkbox" checked={!!property[k]} onChange={(e) => setProp(k, e.target.checked)} /> {label}
    </label>
  );
  const qline = (label, text, color) => (
    <div key={label} style={st.qLine}>
      {color ? <span style={{ ...st.swatch, background: color }} /> : <span style={{ width: 12 }} />}
      <span style={{ flex: 1 }}>{label}</span>
      <span style={st.num}>{text}</span>
    </div>
  );

  // ---------- export (real downloads — self-hosted, no sandbox; copy/paste modal kept for Cowork paste-in) ----------
  const round2 = (v) => Math.round(v * 100) / 100;
  const buildExport = () => {
    const pt = computePropertyTotals();
    return {
      job: jobName || "UNNAMED JOB",
      exported_at: new Date().toISOString(),
      source: `bml-floorplan-markup ${APP_VERSION}`,
      pricing: "QUANTITIES ONLY — this tool never applies rates or pricing. Any pricing engine consumes this JSON.",
      calibration: scale ? { scale_m_per_px: scale, reference_px: calPx, reference_m: calPx * scale } : null,
      markup_convention: "BML v4.0 (bml-floorplan-quantify-quote) — CONDITION 2 IS NETTED",
      condition2_model: "v4.0 — condition2_net_m2 is the PRICED figure and it is ALREADY NETTED. Method: all C2 shape footprints in a room are COMBINED FIRST, then the surface factor is applied ONCE as (Sum footprints) x (2 + ceiling_height); the stripped areas (wall + ceiling + floor) are then DEDUCTED. Computing a surface per shape (v3.1/v3.2) gave every shape its own perimeter and fabricated internal walls that do not exist, inflating decon on every multi-shape room. Netting matters because a stripped surface is already paid for twice (strip rate + cavity remediation) and must not be charged a third time as a Condition 2 clean. condition2_m2 is retained as an ALIAS OF THE NET figure so no consumer can accidentally read the gross; the gross is condition2_surface_m2 (audit only). A per-shape height override (c2H) supports double-height stairwells and raked ceilings. 'Full strip' no longer exists — floor_strip and ceiling_strip are separate overlays.",
      rooms: roomRows().filter((r) => !r.isUnassigned || r.any).map((r) => ({
        name: r.name, ceiling_height: r.ch,
        strip_room: (r.counts.floor_strip > 0 || r.counts.ceiling_strip > 0 || r.counts.wall_strip > 0),
        floor_strip_m2: round2(r.counts.floor_strip),
        ceiling_strip_m2: round2(r.counts.ceiling_strip),
        // NETTED figure (authoritative). condition2_m2 is an alias of the NET so that a consumer
        // reading the old key can never pick up the un-netted gross.
        condition2_net_m2: round2(r.counts.condition2),
        condition2_m2: round2(r.counts.condition2),
        condition2_surface_m2: r.c2 ? r.c2.surface_m2 : 0,
        condition2: r.c2 || null,
        cabinetry_face_m2: round2(r.counts.cabinetry),
        cabinetry_footprint_m2: round2(r.cabFootprint || 0),   // audit only — never priced
        cabinetry: r.cabWorking || null,
        contingent_m2: round2(r.counts.contingent),
        wall_strip_linm: round2(r.wallLinm), wall_strip_m2: round2(r.counts.wall_strip),
        wall_strip: r.wallWorking || null,
        cornice_linm: round2(r.corniceLinm), skirting_linm: round2(r.skirtingLinm),
        containment_count: r.counts.containment,
        // v4.2 - internal productivity signals (QUANTITIES ONLY, never priced here)
        productivity: {
          setups: r.any ? 1 : 0,                       // one mobilisation per room entered
          wall_runs: r.wallRuns || 0,                  // separate strip runs / angle changes
          wall_run_avg_linm: round2(r.wallRunAvgLinm || 0),
          c2_shapes: r.c2 ? r.c2.shapes.length : 0,
          _note: "Set-up = one per room entered. wall_runs = separate drawn strip runs; a 90-degree change of angle is a new run. Short average run length and many set-ups = slower per m2; long continuous runs = faster per m2. For Jordan's internal judgement on the rate/hours only - NOT a client-facing figure and NOT priced by this app.",
        },
        plumbing_iso: r.plumbIso, electrical_iso: r.elecIso,
      })),
      property: {
        adf_units: parseFloat(property.adf_units) || 0, adf_days: parseFloat(property.adf_days) || 0,
        dehum_units: parseFloat(property.dehum_units) || 0, dehum_days: parseFloat(property.dehum_days) || 0,
        dbkii_days: parseFloat(property.dbkii_days) || 0,
        ac_ducted_units: parseFloat(property.ac_ducted_units) || 0, ac_split_units: parseFloat(property.ac_split_units) || 0,
        prv_areas: parseFloat(property.prv_areas) || 0,
        contents_packout: !!property.contents_packout, contents_inventory: !!property.contents_inventory,
        contents_storage: property.contents_storage,
        skip_bin: !!property.skip_bin, asbestos_testing: !!property.asbestos_testing,
        roof_void: {
          decon_m2: round2(pt.decon_m2), decon_mode: property.roof_void_mode,
          insulation_batts_m2: round2(pt.insBatts), insulation_blown_m2: round2(pt.insBlown),
          shapes: pt.roofWorking.shapes, working: pt.roofWorking.working,
        },
        floor_protection_m2: round2(pt.floorProt),
      },
      flags: [
        ...(shapes.some((s) => s.room == null && !catById(s.cat)?.propertyScope) ? ["UNASSIGNED shapes present — reassign before pricing"] : []),
        ...(!scale ? ["NOT CALIBRATED — quantities invalid"] : []),
        // ---- v4.0 D1.6 hard-error validations. A quantity that is not physically plausible must
        // never leave the app silently: every one of these passed every downstream gate before.
        ...roomRows().filter((r) => r.any && r.c2 && r.c2.shapes.length && r.c2.net_m2 <= 0)
          .map((r) => `ERROR — ${r.name}: Condition 2 NET is ${r.c2.net_m2} m² (<= 0). Stripped area (${round2((r.counts.wall_strip||0)+(r.counts.ceiling_strip||0)+(r.counts.floor_strip||0))} m²) meets or exceeds the computed C2 surface (${r.c2.surface_m2} m²). This is the double-height / stairwell signature — set a per-shape height override (c2H) or supply a manual C2 total. DO NOT PRICE THIS AS ZERO.`),
        ...roomRows().filter((r) => r.any && r.c2 && r.c2.shapes.length && r.c2.surface_m2 > 3 * ((r.counts.wall_strip||0)+(r.counts.ceiling_strip||0)+(r.counts.floor_strip||0)) && ((r.counts.wall_strip||0)+(r.counts.ceiling_strip||0)+(r.counts.floor_strip||0)) > 0)
          .map((r) => `FLAG — ${r.name}: C2 surface ${r.c2.surface_m2} m² exceeds 3x the stripped area — possible whole-room over-read.`),
        ...roomRows().filter((r) => r.any && r.c2 && r.c2.shapes.length && !r.ch)
          .map((r) => `ERROR — ${r.name}: Condition 2 zone drawn with NO ceiling height set.`),
        ...roomRows().filter((r) => r.cabMissingH)
          .map((r) => `ERROR — ${r.name}: cabinetry drawn with NO height selected. Cabinetry prices on FACE area (perimeter x height) — a footprint cannot be priced.`),
      ],
    };
  };

  const downloadFile = (filename, text) => {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportQuantities = () => {
    const filename = `${(jobName || "job").replace(/\s+/g, "_")}_markup_quantities.json`;
    const text = JSON.stringify(buildExport(), null, 2);
    downloadFile(filename, text);
    setCopyMsg("");
    setExportModal({
      title: "Quantities JSON",
      hint: `Downloaded ${filename} to your browser's downloads folder — move it into the job folder. Or copy below to paste straight into the Cowork report chat.`,
      text, filename,
    });
  };

  const exportProject = () => {
    const filename = `${(jobName || "job").replace(/\s+/g, "_")}_markup_PROJECT.json`;
    const data = {
      format: "bml-markup-project", version: 3, image_embedded: false,
      savedAt: new Date().toISOString(),
      imgW: img?.w || 0, imgH: img?.h || 0,
      jobName, rooms, shapes, calLine, scale, property,
    };
    const text = JSON.stringify(data);
    downloadFile(filename, text);
    setCopyMsg("");
    setExportModal({
      title: "Project file JSON (markup backup)",
      hint: `Downloaded ${filename} — move it into the Drive job folder. On import you re-load the plan image from the job folder; markup auto-rescales to it.`,
      text, filename,
    });
  };

  const doCopy = async () => {
    const text = exportModal?.text || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg("Copied ✓");
    } catch {
      try {
        taRef.current.focus(); taRef.current.select();
        const ok = document.execCommand("copy");
        setCopyMsg(ok ? "Copied ✓" : "Text selected — press Ctrl+C now");
      } catch { setCopyMsg("Select the text and press Ctrl+C"); }
    }
    setTimeout(() => setCopyMsg(""), 3000);
  };

  // ---------- import project (paste text or file) ----------
  const importProject = (raw) => {
    try {
      const d = JSON.parse(raw);
      if (d.format !== "bml-markup-project") throw new Error("bad format");
      const id = view === "editor" && jobId ? jobId : String(Date.now());
      loadedRef.current = false;
      // v3.1: legacy full_strip shapes convert to floor_strip (overlay ceiling separately);
      // legacy wall_strip lines without a height default to "full" (room ceiling height).
      let convertedFullStrip = false;
      const shapes = (d.shapes || []).map((s) => {
        let out = s;
        if (out.cat === "full_strip") { out = { ...out, cat: "floor_strip" }; convertedFullStrip = true; }
        if (out.cat === "wall_strip" && out.hgt == null) out = { ...out, hgt: "full" };
        return out;
      });
      setJobId(id); setJobName(d.jobName || ""); setRooms(d.rooms || []);
      setActiveRoom(d.rooms?.[0]?.id ?? null);
      setShapes(shapes); setCalLine(d.calLine || null); setScale(d.scale ?? null);
      setSelId(null); setUndoStack([]);
      setProperty({ ...DEFAULT_PROPERTY, ...(d.property || {}) });
      setHiddenCats(new Set()); setHiddenRooms(new Set());
      idRef.current = Math.max(1, ...shapes.map((s) => s.id + 1), ...(d.rooms || []).map((x) => x.id + 1));
      if (d.img?.src) {
        // legacy v2.1 project files with embedded image
        setImg(d.img);
        pendingRescale.current = null;
        requestAnimationFrame(() => fitView(d.img.w, d.img.h));
        if (storageOk) {
          (async () => {
            try {
              const blob = dataURLToBlob(d.img.src);
              await putImageBlob(id, blob);
            } catch {}
          })();
        }
      } else {
        setImg(null);
        pendingRescale.current = d.imgW ? { w: d.imgW, h: d.imgH } : null;
      }
      loadedRef.current = true;
      setImportOpen(false); setImportText("");
      setView("editor");
      setSaveState("dirty"); // autosave writes it back into IndexedDB
      const msgs = [];
      if (convertedFullStrip) msgs.push("Legacy full-strip shapes were converted to floor strip — overlay ceiling strip separately.");
      if (!d.img?.src) msgs.push("Markup restored. Now load the floor plan image (paste/drop/upload) — the same plan from the job folder. Markup will auto-align.");
      if (msgs.length) alert(msgs.join("\n\n"));
    } catch { alert("Not a valid BML markup project file / JSON."); }
  };

  const importFromFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => importProject(r.result);
    r.readAsText(file);
  };

  // ---------- rooms ----------
  const [newRoom, setNewRoom] = useState("");
  const addRoom = () => {
    const n = newRoom.trim(); if (!n) return;
    const r = { id: nid(), name: n, ch: "2.4", plumbIso: false, elecIso: false };
    setRooms((a) => [...a, r]); setActiveRoom(r.id); setNewRoom("");
  };

  const sel = shapes.find((s) => s.id === selId);
  const measLen = measure ? Math.hypot(measure.x2 - measure.x1, measure.y2 - measure.y1) : 0;
  const labelFs = Math.max(11 / zoom, 2);
  const saveLabel = { idle: "", dirty: "Unsaved…", saving: "Saving…", saved: "Saved ✓", error: "SAVE FAILED — export project JSON now" }[saveState];
  const versionStamp = `${APP_VERSION}${BUILD_DATE ? ` · ${BUILD_DATE}` : ""}`;

  // ---------- modals (shared between views) ----------
  const modals = (
    <>
      {exportModal && (
        <div style={st.overlay} onClick={() => setExportModal(null)}>
          <div style={st.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...st.h, fontSize: 13 }}>{exportModal.title}</div>
            <div style={st.meta}>{exportModal.hint}</div>
            <textarea ref={taRef} readOnly value={exportModal.text} style={st.ta}
              onFocus={(e) => e.target.select()} />
            <div style={st.row}>
              <button style={{ ...btn(false), flex: 1, background: "#2f6df6", borderColor: "#2f6df6", color: "#fff" }} onClick={doCopy}>
                {copyMsg || "Copy to clipboard"}
              </button>
              <button style={btn(false)} onClick={() => downloadFile(exportModal.filename, exportModal.text)}>Download again</button>
              <button style={btn(false)} onClick={() => setExportModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <div style={st.overlay} onClick={() => setImportOpen(false)}>
          <div style={st.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...st.h, fontSize: 13 }}>Import project</div>
            <div style={st.meta}>Paste the project JSON (from the job folder file) below, or pick the .json file.</div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} style={st.ta} placeholder='{"format":"bml-markup-project", ...}' />
            <div style={st.row}>
              <button style={{ ...btn(false), flex: 1, background: "#2f6df6", borderColor: "#2f6df6", color: "#fff" }}
                onClick={() => importText.trim() && importProject(importText.trim())}>Load pasted JSON</button>
              <label style={{ ...btn(false), flex: 1, textAlign: "center" }}>
                Pick .json file
                <input type="file" accept=".json,application/json,text/plain" style={{ display: "none" }}
                  onChange={(e) => { importFromFile(e.target.files[0]); e.target.value = ""; }} />
              </label>
              <button style={btn(false)} onClick={() => setImportOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ================= HOME (job list) =================
  if (view === "home") {
    return (
      <div style={{ ...st.app, flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 60 }}>
        <div style={{ width: 460, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={st.brand}>BML · FLOOR PLAN MARKUP</div>
            <div style={st.meta}>{versionStamp}</div>
          </div>
          {!storageOk && <div style={st.warn}>Persistent storage unavailable in this browser — jobs cannot be saved. You can still mark up and export in one sitting.</div>}
          <button style={{ ...btn(false), background: "#2f6df6", borderColor: "#2f6df6", color: "#fff", padding: "12px" }} onClick={newJob}>
            + New job
          </button>
          <button style={{ ...btn(false), padding: "12px" }} onClick={() => { setCopyMsg(""); setImportOpen(true); }}>
            Import project (paste JSON or pick file)
          </button>
          <div style={st.h}>Saved jobs</div>
          {index.length === 0 && <div style={st.meta}>No saved jobs yet. Markup autosaves — you can close and return any time.</div>}
          {index.map((j) => (
            <div key={j.id} style={{ ...st.roomRow, padding: "10px 12px" }}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openJob(j.id)}>
                <div style={{ fontWeight: 600 }}>{j.name || "Unnamed job"}</div>
                <div style={st.meta}>Saved {new Date(j.savedAt).toLocaleString("en-AU")}</div>
              </div>
              <button style={btn(false)} onClick={() => openJob(j.id)}>Open</button>
              <button style={{ ...btn(false), color: "#e86a6a" }} onClick={() => deleteJob(j.id)}>Delete</button>
            </div>
          ))}
          {busy && <div style={st.meta}>Loading…</div>}
        </div>
        {modals}
      </div>
    );
  }

  const propertyTotals = computePropertyTotals();
  const anyPropertyEntered = propertyTotals.decon_m2 > 0 || propertyTotals.insBatts > 0 || propertyTotals.insBlown > 0 ||
    propertyTotals.floorProt > 0 || parseFloat(property.adf_units) > 0 || parseFloat(property.dehum_units) > 0 ||
    parseFloat(property.dbkii_days) > 0 || parseFloat(property.ac_ducted_units) > 0 || parseFloat(property.ac_split_units) > 0 ||
    parseFloat(property.prv_areas) > 0 || property.contents_packout || property.contents_inventory ||
    property.skip_bin || property.asbestos_testing || property.contents_storage !== "none";

  // ================= EDITOR =================
  return (
    <div style={st.app}>
      <div style={st.panel}>
        <div style={{ ...st.row, justifyContent: "space-between" }}>
          <span style={{ ...st.brand, cursor: "pointer" }} onClick={() => { persistMeta(); listJobs().then(setIndex); setView("home"); }}>← JOBS</span>
          <span style={{ ...st.meta, color: saveState === "error" ? "#e86a6a" : "#8b909a" }}>{saveLabel}</span>
        </div>
        {!storageOk && <div style={st.warn}>No persistence in this browser — export project JSON before closing.</div>}

        <input style={st.input} placeholder="Job — e.g. BMLJ00652 — 12 Sample St" value={jobName} onChange={(e) => setJobName(e.target.value)} />

        {!img && (
          <label style={st.drop}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); loadImageFile(e.dataTransfer.files[0]); }}>
            Paste (Ctrl+V), drop, or click to load a floor plan image
            <input type="file" accept="image/*" data-testid="plan-file-input" style={{ display: "none" }} onChange={(e) => loadImageFile(e.target.files[0])} />
          </label>
        )}

        <div style={st.section}>
          {sectionHead("cal", "1 · Calibrate")}
          {!collapsed.cal && (
            <>
              <button style={btn(tool === "calibrate")} onClick={() => setTool("calibrate")} disabled={!img}>
                Draw calibration line along a known wall
              </button>
              {calLine && (
                <div style={st.row}>
                  <input style={{ ...st.input, flex: 1 }} placeholder="Wall length" value={calInput} onChange={(e) => setCalInput(e.target.value)} inputMode="decimal" />
                  <select style={st.selectEl} value={calUnit} onChange={(e) => setCalUnit(e.target.value)}>
                    <option value="m">m</option><option value="mm">mm</option>
                  </select>
                  <button style={btn(false)} onClick={applyScale}>Set</button>
                </div>
              )}
              <div style={st.meta}>
                {scale
                  ? <>Scale locked: 1 px = {fmt(scale * 1000, 1)} mm. Cross-check with Measure before drawing.</>
                  : <span style={{ color: "#e8b34b" }}>Not calibrated — quantities disabled.</span>}
              </div>
              <button style={btn(tool === "measure")} onClick={() => setTool("measure")} disabled={!scale}>
                Measure (check tool){measure && scale ? ` — ${fmt(measLen * scale)} m` : ""}
              </button>
            </>
          )}
        </div>

        <div style={st.section}>
          {sectionHead("rooms", "2 · Rooms")}
          {!collapsed.rooms && (
            <>
              <div style={st.row}>
                <input style={{ ...st.input, flex: 1 }} placeholder="Add room…" value={newRoom}
                  onChange={(e) => setNewRoom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRoom()} />
                <button style={btn(false)} onClick={addRoom}>Add</button>
              </div>
              {rooms.map((r) => (
                <div key={r.id} style={{ ...st.roomRow, outline: activeRoom === r.id ? "1px solid #6ea8fe" : "none", opacity: hiddenRooms.has(r.id) ? 0.55 : 1 }}
                  onClick={() => setActiveRoom(r.id)}>
                  <input value={r.name} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRooms((a) => a.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x))}
                    style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", borderBottom: "1px dashed #3a3f49", color: "#e8e6e1", fontSize: 13, padding: "2px 0" }} />
                  <span style={st.meta}>CH</span>
                  <input style={st.chInput} value={r.ch}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRooms((a) => a.map((x) => x.id === r.id ? { ...x, ch: e.target.value } : x))} />
                  <span style={st.meta}>m</span>
                  <label title="Plumbing isolation" onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10.5, color: "#8b909a" }}>
                    <input type="checkbox" checked={!!r.plumbIso}
                      onChange={(e) => setRooms((a) => a.map((x) => x.id === r.id ? { ...x, plumbIso: e.target.checked } : x))} />PL
                  </label>
                  <label title="Electrical isolation" onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10.5, color: "#8b909a" }}>
                    <input type="checkbox" checked={!!r.elecIso}
                      onChange={(e) => setRooms((a) => a.map((x) => x.id === r.id ? { ...x, elecIso: e.target.checked } : x))} />EL
                  </label>
                  <span title="Toggle this room's shapes on canvas" style={{ cursor: "pointer", opacity: hiddenRooms.has(r.id) ? 1 : 0.5 }}
                    onClick={(e) => { e.stopPropagation(); toggleHiddenRoom(r.id); }}>👁</span>
                </div>
              ))}
              <div style={st.meta}>Active room is tagged onto every new shape.</div>
            </>
          )}
        </div>

        <div style={st.section}>
          {sectionHead("markup", "3 · Mark up scope")}
          {!collapsed.markup && (
            <>
              <div style={st.chips}>
                {CATS.map((c) => (
                  <button key={c.id} style={chip(c, tool === "draw" && activeCat === c.id)}
                    onClick={() => { setActiveCat(c.id); setTool("draw"); }} disabled={!img}>
                    <span style={{ ...st.swatch, background: c.color, opacity: (c.kind === "fill" ? 0.8 : 1) * (hiddenCats.has(c.id) ? 0.35 : 1), height: c.kind === "line" ? 3 : 12 }} />
                    <span style={{ opacity: hiddenCats.has(c.id) ? 0.5 : 1 }}>{c.label}</span>
                    <span onClick={(e) => { e.stopPropagation(); toggleHiddenCat(c.id); }} title="Toggle visibility on canvas"
                      style={{ marginLeft: 2, opacity: hiddenCats.has(c.id) ? 1 : 0.5, cursor: "pointer" }}>👁</span>
                  </button>
                ))}
              </div>
              {activeCat === "wall_strip" && (
                <div style={st.selBox}>
                  <div style={st.row}>
                    <span style={st.meta}>New wall height:</span>
                    <select style={{ ...st.selectEl, flex: 1 }} value={String(wallHgt)}
                      onChange={(e) => setWallHgt(e.target.value === "full" ? "full" : parseFloat(e.target.value))} disabled={wallSkirtingOnly}>
                      {HEIGHTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                    <input type="checkbox" checked={wallCornice} disabled={wallSkirtingOnly} onChange={(e) => setWallCornice(e.target.checked)} /> Include cornice
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                    <input type="checkbox" checked={wallSkirting} onChange={(e) => setWallSkirting(e.target.checked)} /> Include skirting
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                    <input type="checkbox" checked={wallSkirtingOnly} onChange={(e) => setWallSkirtingOnly(e.target.checked)} /> Skirting only (no wall lining)
                  </label>
                </div>
              )}
              {activeCat === "roof_void_decon" && (
                <div style={st.selBox}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                    <input type="checkbox" checked={roofInsulation} onChange={(e) => setRoofInsulation(e.target.checked)} /> Include insulation removal
                  </label>
                  {roofInsulation && (
                    <div style={st.row}>
                      <span style={st.meta}>Insulation type:</span>
                      <select style={{ ...st.selectEl, flex: 1 }} value={roofInsulationType} onChange={(e) => setRoofInsulationType(e.target.value)}>
                        {INSULATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {activeCat === "cabinetry" && (
                <div style={st.selBox}>
                  <div style={st.row}>
                    <span style={st.meta}>New cabinetry height:</span>
                    <select style={{ ...st.selectEl, flex: 1 }} value={cabHgt} onChange={(e) => setCabHgt(e.target.value)}>
                      <option value="">— select height —</option>
                      {CAB_HEIGHTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                      <option value="custom">Custom…</option>
                    </select>
                  </div>
                  {cabHgt === "custom" && (
                    <div style={st.row}>
                      <span style={st.meta}>Height (m):</span>
                      <input style={{ ...st.input, flex: 1 }} value={cabHgtCustom} onChange={(e) => setCabHgtCustom(e.target.value)} inputMode="decimal" />
                    </div>
                  )}
                  {!cabHgt && <div style={{ ...st.meta, color: "#e8b34b" }}>No height selected — new shapes will need one set before export (face area cannot price a footprint).</div>}
                </div>
              )}
              <div style={st.row}>
                <button style={btn(tool === "select")} onClick={() => setTool("select")}>Select / edit</button>
                <button style={btn(tool === "pan")} onClick={() => setTool("pan")}>Pan</button>
                <button style={btn(false)} onClick={showAll}>Show all</button>
              </div>
              <div style={st.meta}>Shift = straight lines · Del = delete selected · Ctrl+Z = undo · scroll = zoom · space-drag = pan</div>
              <div style={st.meta}>Click again on overlapping shapes (same spot) to select the one underneath — cycles through the stack.</div>
              <div style={st.meta}>Blue C2 = draw the remediation zone (part-room is fine). Total = floor + ceiling + walls of the zone — no automatic netting of stripped areas. Spot cuts: draw the ACTUAL cutout area (incl. your strip-past-contamination allowance) — quantities price what you draw.</div>
              {sel && (
                <div style={st.selBox}>
                  <div style={st.meta}>Selected: {catById(sel.cat).label} — {shapeLabel(sel)}</div>
                  {sel.cat === "wall_strip" && (
                    <>
                      <div style={st.row}>
                        <span style={st.meta}>Height:</span>
                        <select style={{ ...st.selectEl, flex: 1 }} value={String(sel.hgt ?? "full")} disabled={!!sel.skirtingOnly}
                          onChange={(e) => { pushUndo(); const v = e.target.value === "full" ? "full" : parseFloat(e.target.value); setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, hgt: v } : s)); }}>
                          {HEIGHTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                        </select>
                      </div>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                        <input type="checkbox" checked={!!sel.cornice} disabled={!!sel.skirtingOnly}
                          onChange={(e) => { pushUndo(); const v = e.target.checked; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, cornice: v } : s)); }} /> Include cornice
                      </label>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                        <input type="checkbox" checked={!!sel.skirting}
                          onChange={(e) => { pushUndo(); const v = e.target.checked; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, skirting: v } : s)); }} /> Include skirting
                      </label>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                        <input type="checkbox" checked={!!sel.skirtingOnly}
                          onChange={(e) => { pushUndo(); const v = e.target.checked; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, skirtingOnly: v } : s)); }} /> Skirting only
                      </label>
                    </>
                  )}
                  {sel.cat === "roof_void_decon" && (
                    <>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                        <input type="checkbox" checked={!!sel.insulation}
                          onChange={(e) => { pushUndo(); const v = e.target.checked; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, insulation: v } : s)); }} /> Include insulation removal
                      </label>
                      {sel.insulation && (
                        <div style={st.row}>
                          <span style={st.meta}>Insulation type:</span>
                          <select style={{ ...st.selectEl, flex: 1 }} value={sel.insulationType || "batts"}
                            onChange={(e) => { pushUndo(); const v = e.target.value; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, insulationType: v } : s)); }}>
                            {INSULATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                  {sel.cat === "cabinetry" && (() => {
                    const isPreset = CAB_HEIGHTS.some((h) => h.value === String(sel.cabH));
                    const selectVal = isPreset ? String(sel.cabH) : (sel.cabH ? "custom" : "");
                    return (
                      <>
                        <div style={st.row}>
                          <span style={st.meta}>Height:</span>
                          <select style={{ ...st.selectEl, flex: 1 }} value={selectVal}
                            onChange={(e) => { pushUndo(); const v = e.target.value; const next = v === "custom" ? "" : v; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, cabH: next } : s)); }}>
                            <option value="">— select height —</option>
                            {CAB_HEIGHTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                            <option value="custom">Custom…</option>
                          </select>
                        </div>
                        {(selectVal === "custom") && (
                          <div style={st.row}>
                            <span style={st.meta}>Height (m):</span>
                            <input style={{ ...st.input, flex: 1 }} value={sel.cabH ?? ""}
                              onChange={(e) => { pushUndo(); const v = e.target.value; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, cabH: v } : s)); }} inputMode="decimal" />
                          </div>
                        )}
                        {!sel.cabH && <div style={{ ...st.meta, color: "#e8b34b" }}>No height set — this shape exports as a hard ERROR (face area cannot price a footprint).</div>}
                      </>
                    );
                  })()}
                  {sel.cat === "condition2" && (
                    <div style={st.row}>
                      <span style={st.meta}>Height override (m):</span>
                      <input style={{ ...st.input, flex: 1 }} placeholder={`Room default (${roomCH(sel.room)})`} value={sel.c2H ?? ""}
                        onChange={(e) => { pushUndo(); const v = e.target.value; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, c2H: v } : s)); }} inputMode="decimal" />
                    </div>
                  )}
                  <div style={st.row}>
                    <select style={{ ...st.selectEl, flex: 1 }} value={sel.room ?? ""}
                      onChange={(e) => { pushUndo(); const v = e.target.value ? Number(e.target.value) : null; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, room: v } : s)); }}>
                      <option value="">Unassigned</option>
                      {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <button style={btn(false)} onClick={() => { pushUndo(); setShapes((a) => a.filter((s) => s.id !== sel.id)); setSelId(null); }}>Delete</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={st.section}>
          {sectionHead("property", "4 · Property scope")}
          {!collapsed.property && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {propNumField("ADF units", "adf_units")}
                {propNumField("× days", "adf_days")}
                {propNumField("Dehum units", "dehum_units")}
                {propNumField("× days", "dehum_days")}
                {propNumField("DBKII days", "dbkii_days")}
                {propNumField("PRV areas", "prv_areas")}
                {propNumField("AC ducted decontamination", "ac_ducted_units")}
                {propNumField("AC split decontamination", "ac_split_units")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                {propCheckField("Contents packout", "contents_packout")}
                {propCheckField("Contents inventory", "contents_inventory")}
                {propCheckField("Skip bin", "skip_bin")}
                {propCheckField("Asbestos testing", "asbestos_testing")}
              </div>
              <div style={st.row}>
                <span style={st.meta}>Contents storage:</span>
                <select style={{ ...st.selectEl, flex: 1 }} value={property.contents_storage} onChange={(e) => setProp("contents_storage", e.target.value)}>
                  {STORAGE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div style={st.row}>
                <span style={st.meta}>Roof void decon:</span>
                <select style={{ ...st.selectEl, flex: 1 }} value={property.roof_void_mode} onChange={(e) => setProp("roof_void_mode", e.target.value)}>
                  {ROOF_VOID_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        <div style={{ ...st.section, flex: 1, overflow: "auto" }}>
          {sectionHead("qty", "5 · Quantities")}
          {!collapsed.qty && (
            <>
              {roomRows().map((r) => r.any || !r.isUnassigned ? (
                <div key={r.name} style={st.qRoom}>
                  <div style={{ fontWeight: 600, color: r.isUnassigned && r.any ? "#e8b34b" : "#e8e6e1" }}>
                    {r.name}{r.isUnassigned && r.any ? " ⚠" : ""} <span style={st.meta}>CH {r.ch} m</span>
                  </div>
                  {(r.plumbIso || r.elecIso) && (
                    <div style={{ ...st.meta, fontSize: 11 }}>
                      {[r.plumbIso && "Plumbing iso", r.elecIso && "Electrical iso"].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {CATS.map((c) => categoryLines(c, r).map((line, i) => (
                    <div key={`${c.id}-${i}`} style={{ ...st.qLine, color: line.danger ? "#e86a6a" : undefined, fontSize: line.sub ? 11 : st.qLine.fontSize, opacity: line.sub ? 0.75 : 1 }}>
                      <span style={{ ...st.swatch, background: line.danger ? "#e86a6a" : c.color }} />
                      <span style={{ flex: 1 }}>{line.label}</span>
                      <span style={st.num}>{line.text}</span>
                    </div>
                  )))}
                </div>
              ) : null)}
              {anyPropertyEntered && (
                <div style={st.qRoom}>
                  <div style={{ fontWeight: 600 }}>Property-wide</div>
                  {propertyTotals.decon_m2 > 0 && qline(`Roof void / cavity decon (${property.roof_void_mode === "all_surfaces" ? "all surfaces" : "visibly affected"})`, `${fmt(propertyTotals.decon_m2)} m²`, "#795548")}
                  {propertyTotals.insBatts > 0 && qline("Insulation removal (batts)", `${fmt(propertyTotals.insBatts)} m²`, "#795548")}
                  {propertyTotals.insBlown > 0 && qline("Insulation removal (blown-in)", `${fmt(propertyTotals.insBlown)} m²`, "#795548")}
                  {propertyTotals.floorProt > 0 && qline("Floor protection", `${fmt(propertyTotals.floorProt)} m²`, "#9E9E9E")}
                  {parseFloat(property.adf_units) > 0 && qline("ADF", `${property.adf_units} × ${property.adf_days || 0} days`)}
                  {parseFloat(property.dehum_units) > 0 && qline("Dehumidifiers", `${property.dehum_units} × ${property.dehum_days || 0} days`)}
                  {parseFloat(property.dbkii_days) > 0 && qline("DBKII", `${property.dbkii_days} days`)}
                  {parseFloat(property.prv_areas) > 0 && qline("PRV areas", property.prv_areas)}
                  {parseFloat(property.ac_ducted_units) > 0 && qline("AC ducted decontamination", property.ac_ducted_units)}
                  {parseFloat(property.ac_split_units) > 0 && qline("AC split decontamination", property.ac_split_units)}
                  {property.contents_packout && qline("Contents packout", "✓")}
                  {property.contents_inventory && qline("Contents inventory", "✓")}
                  {property.contents_storage !== "none" && qline("Contents storage", property.contents_storage)}
                  {property.skip_bin && qline("Skip bin", "✓")}
                  {property.asbestos_testing && qline("Asbestos testing", "✓")}
                </div>
              )}
              {shapes.length === 0 && !anyPropertyEntered && <div style={st.meta}>Nothing marked up yet.</div>}
            </>
          )}
        </div>

        <div style={st.section}>
          <button style={{ ...btn(false), background: "#2f6df6", borderColor: "#2f6df6", color: "#fff" }}
            onClick={exportQuantities} disabled={!scale || !shapes.length}>
            Download quantities JSON
          </button>
          <div style={st.row}>
            <button style={{ ...btn(false), flex: 1 }} onClick={exportProject} disabled={!shapes.length && !rooms.length}>
              Save project (download)
            </button>
            <button style={{ ...btn(false), flex: 1 }} onClick={() => { setCopyMsg(""); setImportOpen(true); }}>
              Import project
            </button>
          </div>
          <div style={st.meta}>Project JSON = markup backup (no image — you re-load the plan on import). Save it as [Job]_markup_PROJECT.json in the Drive job folder at the end of every session — this is the durable, cross-device record. Autosave (IndexedDB) is per-browser/per-device convenience only.</div>
          <div style={st.meta}>Quantities only — this tool never applies rates or pricing. Any pricing engine consumes the exported JSON.</div>
          <div style={{ ...st.meta, textAlign: "right" }}>{versionStamp}</div>
        </div>
      </div>

      <div ref={wrapRef} data-testid="canvas-wrap" style={st.canvasWrap} onWheel={onWheel}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); loadImageFile(e.dataTransfer.files[0]); }}>
        {!img && <div style={st.empty}>Paste (Ctrl+V) or drop a floor plan image here</div>}
        {img && (
          <div ref={innerRef} data-testid="plan-canvas" style={{ position: "absolute", left: pan.x, top: pan.y, width: img.w, height: img.h, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
            <img src={img.src} width={img.w} height={img.h} draggable={false} style={{ display: "block", userSelect: "none" }} alt="floor plan" />
            <svg width={img.w} height={img.h} viewBox={`0 0 ${img.w} ${img.h}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              {shapes.filter((s) => !hiddenCats.has(s.cat) && !hiddenRooms.has(s.room)).map((s) => {
                const c = catById(s.cat);
                const isSel = s.id === selId;
                return (
                  <g key={s.id}>
                    {s.type === "rect" ? (
                      <rect x={s.x} y={s.y} width={s.w} height={s.h}
                        fill={c.color} fillOpacity={FILL_OPACITY}
                        stroke={c.color} strokeWidth={(isSel ? 2.5 : 1.2) / zoom} />
                    ) : (
                      <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                        stroke={c.color} strokeWidth={(isSel ? 5 : 3.5) / zoom} strokeLinecap="round"
                        strokeDasharray={s.skirtingOnly ? `${6 / zoom} ${4 / zoom}` : undefined} />
                    )}
                    {scale && (
                      <text x={s.type === "rect" ? s.x + s.w / 2 : (s.x1 + s.x2) / 2}
                        y={s.type === "rect" ? s.y + s.h / 2 : (s.y1 + s.y2) / 2 - 5 / zoom}
                        fontSize={labelFs} textAnchor="middle" fill="#111" stroke="#fff" strokeWidth={2.5 / zoom} paintOrder="stroke"
                        style={{ pointerEvents: "none", fontFamily: "ui-monospace, monospace" }}>
                        {shapeLabel(s)}
                      </text>
                    )}
                    {isSel && handlesOf(s).map((h, i) => (
                      <circle key={i} cx={h.x} cy={h.y} r={5 / zoom} fill="#fff" stroke="#2f6df6" strokeWidth={2 / zoom} />
                    ))}
                  </g>
                );
              })}
              {calLine && (
                <g>
                  <line x1={calLine.x1} y1={calLine.y1} x2={calLine.x2} y2={calLine.y2} stroke="#2f6df6" strokeWidth={2.5 / zoom} strokeDasharray={`${8 / zoom} ${5 / zoom}`} />
                  <text x={(calLine.x1 + calLine.x2) / 2} y={(calLine.y1 + calLine.y2) / 2 - 6 / zoom} fontSize={labelFs} textAnchor="middle"
                    fill="#2f6df6" stroke="#fff" strokeWidth={2.5 / zoom} paintOrder="stroke" style={{ fontFamily: "ui-monospace, monospace" }}>
                    CAL {scale ? `${fmt(calPx * scale)} m` : `${Math.round(calPx)} px`}
                  </text>
                </g>
              )}
              {measure && scale && tool === "measure" && (
                <g>
                  <line x1={measure.x1} y1={measure.y1} x2={measure.x2} y2={measure.y2} stroke="#111" strokeWidth={2 / zoom} strokeDasharray={`${5 / zoom} ${4 / zoom}`} />
                  <text x={(measure.x1 + measure.x2) / 2} y={(measure.y1 + measure.y2) / 2 - 6 / zoom} fontSize={labelFs} textAnchor="middle"
                    fill="#111" stroke="#fff" strokeWidth={2.5 / zoom} paintOrder="stroke" style={{ fontFamily: "ui-monospace, monospace" }}>
                    {fmt(measLen * scale)} m
                  </text>
                </g>
              )}
            </svg>
          </div>
        )}
        {img && (
          <div style={st.zoomBadge}>
            {Math.round(zoom * 100)}% · <span style={{ cursor: "pointer" }} onClick={() => fitView(img.w, img.h)}>fit</span>
          </div>
        )}
      </div>
      {modals}
    </div>
  );
}

// ---------- styles ----------
const st = {
  app: { display: "flex", height: "100vh", background: "#15171b", color: "#e8e6e1", fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13 },
  panel: { width: 340, minWidth: 340, display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "#1d2026", borderRight: "1px solid #2b2f37", overflow: "auto" },
  brand: { fontSize: 11, letterSpacing: "0.18em", color: "#8b909a", fontWeight: 700 },
  section: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid #2b2f37" },
  h: { fontSize: 11, letterSpacing: "0.12em", color: "#8b909a", fontWeight: 700 },
  input: { background: "#15171b", border: "1px solid #2b2f37", color: "#e8e6e1", borderRadius: 6, padding: "7px 9px", fontSize: 13, outline: "none" },
  selectEl: { background: "#15171b", border: "1px solid #2b2f37", color: "#e8e6e1", borderRadius: 6, padding: "6px", fontSize: 13 },
  row: { display: "flex", gap: 6, alignItems: "center" },
  meta: { fontSize: 11.5, color: "#8b909a", lineHeight: 1.45 },
  warn: { fontSize: 12, color: "#e8b34b", background: "#2a2415", border: "1px solid #4a3d1c", borderRadius: 6, padding: "8px 10px" },
  drop: { border: "1.5px dashed #3a3f49", borderRadius: 8, padding: "22px 12px", textAlign: "center", color: "#8b909a", cursor: "pointer", fontSize: 12.5 },
  chips: { display: "flex", flexWrap: "wrap", gap: 5 },
  swatch: { width: 12, height: 12, borderRadius: 2, display: "inline-block", flexShrink: 0 },
  roomRow: { display: "flex", gap: 6, alignItems: "center", background: "#15171b", border: "1px solid #2b2f37", borderRadius: 6, padding: "6px 8px", cursor: "pointer" },
  chInput: { width: 40, background: "transparent", border: "1px solid #2b2f37", color: "#e8e6e1", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "right" },
  selBox: { background: "#15171b", border: "1px solid #2b2f37", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 },
  qRoom: { display: "flex", flexDirection: "column", gap: 3, padding: "6px 0" },
  qLine: { display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 },
  num: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 },
  canvasWrap: { flex: 1, position: "relative", overflow: "hidden", background: "#101216", touchAction: "none", cursor: "crosshair" },
  empty: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#4a4f59", fontSize: 15 },
  zoomBadge: { position: "absolute", bottom: 10, right: 12, background: "#1d2026cc", border: "1px solid #2b2f37", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, color: "#8b909a" },
  overlay: { position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 },
  modal: { width: "min(680px, 92vw)", background: "#1d2026", border: "1px solid #2b2f37", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8 },
  ta: { width: "100%", height: 220, background: "#15171b", border: "1px solid #2b2f37", color: "#e8e6e1", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace", resize: "vertical", boxSizing: "border-box" },
};
const btn = (active) => ({
  background: active ? "#2f6df6" : "#15171b", color: active ? "#fff" : "#e8e6e1",
  border: `1px solid ${active ? "#2f6df6" : "#2b2f37"}`, borderRadius: 6,
  padding: "7px 10px", fontSize: 12.5, cursor: "pointer",
});
const chip = (c, active) => ({
  display: "flex", alignItems: "center", gap: 6,
  background: active ? "#262b34" : "#15171b", color: "#e8e6e1",
  border: `1px solid ${active ? c.color : "#2b2f37"}`, borderRadius: 6,
  padding: "6px 8px", fontSize: 12, cursor: "pointer",
});
