import React, { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import NumField from "./NumField.jsx";
import { flushNumFields } from "./numText.js";
import { listJobs, getJob, putJob, deleteJob as dbDeleteJob, getImageBlob, putImageBlob, deleteImageBlob, imageKeyFor, dataURLToBlob, blobToDataURL } from "./db.js";
// v7.0 item 8 — equipment marker icons (CO 2026-08-27, supplied in _Artifact and HTML App
// Masters/assets/, downscaled to 96px before bundling).
import iconSplitAcInsitu from "./assets/icon_split_ac_decon_insitu.png";
import iconSplitAcDecomm from "./assets/icon_split_ac_decommission.png";
import iconAfd from "./assets/icon_afd.png";
import iconDehum from "./assets/icon_dehumidifier.png";
import iconDrymatic from "./assets/icon_drymatic_boost.png";
import { CATS, LEFT_BAR_CATS, catById, INSULATION_CATS, DEFAULT_PROPERTY, FLOOR_COVERINGS, floorCovById, MARKER_KINDS as MARKER_KINDS_BASE,
         FIRST_FLOOR_ID, newFloor, migrateFloors, migrateProperty, migrateProjectFile, APP_VERSION, makeQuantities } from "./quantities.js";

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
  { value: "none",             label: "None" },
  { value: "all_surfaces",     label: "All surfaces" },
  { value: "visibly_affected", label: "Visibly affected only" },
];
const STORAGE_MODES = [
  { value: "none",    label: "None" },
  { value: "onsite",  label: "Onsite" },
  { value: "offsite", label: "Offsite" },
];
// Cabinetry face-height presets (D1.4, Jordan ruling 26 Jul 2026 — perimeter × height).
// "" = not yet selected (validation flag); "custom" is a UI-only sentinel, never priced itself.
const CAB_HEIGHTS = [
  { value: "0.9", label: "Base 0.9 m" },
  { value: "2.1", label: "Tall 2.1 m" },
  { value: "2.4", label: "Full 2.4 m" },
];

// v7.0 item 8 — marker kinds are defined (without icons) in quantities.js; the icons are a UI
// concern and are attached here.
const MARKER_ICONS = {
  split_ac_decon_insitu: iconSplitAcInsitu, split_ac_decommission: iconSplitAcDecomm,
  afd: iconAfd, dehumidifier: iconDehum, drymatic_boost: iconDrymatic,
};
const MARKER_KINDS = MARKER_KINDS_BASE.map((k) => ({ ...k, icon: MARKER_ICONS[k.id] }));
const markerKindById = (id) => MARKER_KINDS.find((k) => k.id === id);
// v7.3 — markers have a fixed PLAN size, not a fixed screen size. v7.0 rendered them at 26
// screen px, so zooming out on a large plan made them swallow rooms and walls, and the export
// sized them off the image width (worse again). A marker now occupies MARKER_SIZE_M of real
// floor via the floor's calibration — it scales exactly like the rooms it sits in, on screen
// and in every exported image. Uncalibrated floors fall back to a fixed image-pixel size.
// v7.4 — Jordan: 0.6 m still hid room detail. Size is now a per-browser preference (S/M/L) with a
// much smaller default, and the disc behind the icon is translucent so linework shows through.
const MARKER_SIZES_M = { S: 0.22, M: 0.32, L: 0.45 };
const MARKER_SIZE_DEFAULT = "M";
const MARKER_FALLBACK_PX = 40;
const MARKER_MIN_SCREEN_PX = 14;   // never smaller than this on screen — stays clickable when zoomed far out


// v7.1 — remember cosmetic panel state per browser (collapsed sections, last category, covering
// default). Never job data — that lives in IndexedDB. Any failure falls back to defaults.
const UI_PREFS_KEY = "bml-markup-ui-prefs-v1";
const loadUiPrefs = () => { try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY)) || {}; } catch { return {}; } };
const BUILD_DATE = typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "";


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
  const [activeCat, setActiveCat] = useState(() => (catById(loadUiPrefs().activeCat) ? loadUiPrefs().activeCat : "floor_strip"));
  const [wallHgt, setWallHgt] = useState("full"); // default removal height for NEW wall_strip lines
  const [wallCornice, setWallCornice] = useState(false);
  const [wallSkirting, setWallSkirting] = useState(false);
  const [wallSkirtingOnly, setWallSkirtingOnly] = useState(false);
  const [wallInsulation, setWallInsulation] = useState(false);   // v7.5 item 3 — default for NEW wall lines
  const [roofInsulation, setRoofInsulation] = useState(false);
  const [roofInsulationType, setRoofInsulationType] = useState("batts");
  const [cabHgt, setCabHgt] = useState("");        // default cabH for NEW cabinetry shapes: "" | "0.9" | "2.1" | "2.4" | "custom"
  const [cabHgtCustom, setCabHgtCustom] = useState("");
  const [floorCov, setFloorCov] = useState(() => (floorCovById(loadUiPrefs().floorCov) ? loadUiPrefs().floorCov : ""));    // default covering for NEW floor-strip shapes ("" = not chosen)
  const [isolate, setIsolate] = useState(false);   // v7.1 — dim every room except the active one (cosmetic only)
  const [jobQuery, setJobQuery] = useState("");    // v7.1 — home-screen job filter
  // shapes
  const [shapes, setShapes] = useState([]);
  const [selId, setSelId] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  // v7.0 — equipment markers: {id, kind, room, floorId, x, y, heatMatsM2?}. Flat + floor-tagged
  // exactly like shapes. selMarkerId is a SEPARATE selection channel from selId so shape and
  // marker selection can never point at each other's ids.
  const [markers, setMarkers] = useState([]);
  const [selMarkerId, setSelMarkerId] = useState(null);
  const [activeMarkerKind, setActiveMarkerKind] = useState(MARKER_KINDS[0].id);
  // v7.0 item 6 — instructions modal: shown once per NEW job, acknowledged explicitly.
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  // floors (v5.0) — calibration and plan image are PER FLOOR; plans are routinely at
  // different scales, so a job-wide scale would be silently wrong on every floor but one.
  const [floors, setFloors] = useState(() => [newFloor(FIRST_FLOOR_ID)]);
  const [activeFloor, setActiveFloor] = useState(FIRST_FLOOR_ID);
  // calibration
  const [calInput, setCalInput] = useState("");
  const [calUnit, setCalUnit] = useState("m");
  const [measure, setMeasure] = useState(null);
  // property-wide scope (v3.2 — quantities/checkboxes only, never priced)
  const [property, setProperty] = useState(DEFAULT_PROPERTY);
  // visibility toggles (cosmetic only — canvas display, never affects quantities/export)
  const [hiddenCats, setHiddenCats] = useState(() => new Set());
  const [hiddenRooms, setHiddenRooms] = useState(() => new Set());
  // collapsible panel sections (not persisted). Instructions starts COLLAPSED (v7.0 item 6):
  // the text lives in the first-open modal + this section, not permanently on screen.
  const [collapsed, setCollapsed] = useState(() => loadUiPrefs().collapsed || { instructions: true });
  const [markerSize, setMarkerSize] = useState(() => (MARKER_SIZES_M[loadUiPrefs().markerSize] ? loadUiPrefs().markerSize : MARKER_SIZE_DEFAULT));
  const markerSizeM = MARKER_SIZES_M[markerSize] || MARKER_SIZES_M[MARKER_SIZE_DEFAULT];
  useEffect(() => { try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ collapsed, activeCat, floorCov, markerSize })); } catch {} }, [collapsed, activeCat, floorCov, markerSize]);
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
  const latest = useRef({});   // v7.5 item 1 — this render's handlers (see fresh())
  const commitPendingEdits = () => flushSync(() => flushNumFields());
  const fresh = (name) => (...args) => { commitPendingEdits(); return latest.current[name](...args); };
  const loadedRef = useRef(false); // suppress autosave during hydration
  const pendingRescale = useRef(null); // {w,h} of original image when importing a markup-only project
  const taRef = useRef(null);

  // ---------- per-floor calibration (v5.0 phase 2) ----------
  // Two DELIBERATELY different readers of scale, and the distinction is the whole point:
  //   * `scale` / `calLine` below = the ACTIVE floor's. UI chrome only — the calibrate panel,
  //     the measure tool, the canvas overlay, the export-enabled check. Those are all about
  //     the floor currently on screen, so reading the active floor is correct.
  //   * `scaleOf(shape)` = the scale of the floor that shape was DRAWN on. Every quantity
  //     goes through this. Reading the active floor's scale to compute a quantity would
  //     price one floor at another floor's calibration the moment a second floor exists —
  //     the exact silent-mispricing class this cycle has been eliminating.
  const activeFloorRec = floors.find((f) => f.id === activeFloor) || floors[0] || null;
  const calLine = activeFloorRec?.calLine ?? null;
  const scale = activeFloorRec?.scale ?? null;
  const patchFloor = useCallback((floorId, patch) => {
    setFloors((a) => a.map((f) => f.id === floorId ? { ...f, ...(typeof patch === "function" ? patch(f) : patch) } : f));
  }, []);
  // Accept the functional-updater form so the import auto-rescale path keeps working.
  const setCalLine = (v) => patchFloor(activeFloor, (f) => ({ calLine: typeof v === "function" ? v(f.calLine) : v }));
  const setScale = (v) => patchFloor(activeFloor, (f) => ({ scale: typeof v === "function" ? v(f.scale) : v }));
  // v7.5 — all quantity maths lives in quantities.js (pure; shared with the headless re-export).
  const Q = makeQuantities({ jobName, rooms, shapes, markers, floors, activeFloor, property });
  const { scaleOf, wallInsulationOn, fmt, roomCH, lenOf, cabHOf, qtyOf, shapeLabel, roomRows, computePropertyTotals,
          computeInsulationRemoval, computeEquipment, round2, buildExport } = Q;

  // ---------- home: load job index ----------
  useEffect(() => { if (storageOk) listJobs().then(setIndex).catch(() => setIndex([])); }, [storageOk]);

  // ---------- job lifecycle ----------
  const newJob = () => {
    const id = String(Date.now());
    setJobId(id); setJobName(""); setRooms([]); setActiveRoom(null);
    setShapes([]); setSelId(null); setUndoStack([]);
    setMarkers([]); setSelMarkerId(null);
    setFloors([newFloor(FIRST_FLOOR_ID)]); setActiveFloor(FIRST_FLOOR_ID);
    setImg(null); idRef.current = 1; loadedRef.current = true;
    pendingRescale.current = null;
    setProperty(DEFAULT_PROPERTY);
    setHiddenCats(new Set()); setHiddenRooms(new Set());
    setSaveState("idle"); setView("editor");
    setInstructionsOpen(true);   // v7.0 item 6 — once per NEW job, dismissed with the acknowledge button
  };

  const openJob = async (id) => {
    setBusy(true); loadedRef.current = false;
    const meta = await getJob(id);
    if (!meta) { setBusy(false); alert("Job data missing or corrupted."); return; }
    // v5.0 — migrate in memory ONLY. The stored record is left exactly as it was until the
    // user actually changes something and autosave fires.
    const mig = migrateFloors(meta);
    const af = meta.activeFloor && mig.floors.some((f) => f.id === meta.activeFloor) ? meta.activeFloor : mig.floors[0].id;
    const afRec = mig.floors.find((f) => f.id === af);
    // only the ACTIVE floor's plan is loaded now; the rest load lazily on floor switch
    let src = null;
    if (afRec?.imgW) {
      const blob = await getImageBlob(imageKeyFor(id, af, FIRST_FLOOR_ID));
      if (!blob) alert("Floor plan image missing — re-load the image; markup is intact.");
      else src = await blobToDataURL(blob);
    }
    setJobId(id); setJobName(meta.name || ""); setRooms(mig.rooms);
    setActiveRoom(mig.rooms.find((r) => r.floorId === af)?.id ?? null);
    setShapes(mig.shapes); setFloors(mig.floors); setActiveFloor(af);
    setMarkers(mig.markers); setSelMarkerId(null);
    setSelId(null); setUndoStack([]);
    setProperty(migrateProperty(meta.property));
    setHiddenCats(new Set()); setHiddenRooms(new Set());
    pendingRescale.current = null;
    idRef.current = Math.max(1, ...(meta.shapes || []).map((s) => s.id + 1), ...(meta.rooms || []).map((r) => r.id + 1), ...(meta.markers || []).map((m) => m.id + 1));
    if (src && afRec?.imgW) {
      setImg({ src, w: afRec.imgW, h: afRec.imgH });
      requestAnimationFrame(() => fitView(afRec.imgW, afRec.imgH));
    } else setImg(null);
    setSaveState("saved"); setBusy(false); loadedRef.current = true; setView("editor");
  };

  // ---------- floors (v5.0) ----------
  // Switching floors swaps only the plan image + viewport. rooms[] and shapes[] are flat and
  // stay put; everything downstream filters on floorId, so nothing is written back on switch
  // and there is no stale-buffer to flush.
  const MAX_FLOORS = 4;
  const switchFloor = async (fid) => {
    if (fid === activeFloor) return;
    const f = floors.find((x) => x.id === fid); if (!f) return;
    setSelId(null); setSelMarkerId(null); setMeasure(null); setTool("select");
    setActiveFloor(fid);
    setActiveRoom(rooms.find((r) => r.floorId === fid)?.id ?? null);
    if (!f.imgW) { setImg(null); return; }
    try {
      const blob = await getImageBlob(imageKeyFor(jobId, fid, FIRST_FLOOR_ID));
      if (!blob) { setImg(null); return; }
      const src = await blobToDataURL(blob);
      setImg({ src, w: f.imgW, h: f.imgH });
      requestAnimationFrame(() => fitView(f.imgW, f.imgH));
    } catch { setImg(null); }
  };
  const addFloor = () => {
    if (floors.length >= MAX_FLOORS) { alert(`Maximum ${MAX_FLOORS} floors per job.`); return; }
    // NO AUTO-NAMING — the label starts empty and Jordan types it.
    const fid = `f${Date.now().toString(36)}`;
    setFloors((a) => [...a, newFloor(fid)]);
    setActiveFloor(fid); setActiveRoom(null); setSelId(null); setImg(null); setTool("select");
  };
  const renameFloor = (fid, name) => patchFloor(fid, { name });
  const moveFloor = (fid, dir) => setFloors((a) => {
    const i = a.findIndex((f) => f.id === fid), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return a;
    const out = [...a]; [out[i], out[j]] = [out[j], out[i]]; return out;
  });
  const deleteFloor = async (fid) => {
    if (floors.length <= 1) { alert("A job must have at least one floor."); return; }
    const f = floors.find((x) => x.id === fid);
    const nRooms = rooms.filter((r) => r.floorId === fid).length;
    const nShapes = shapes.filter((s) => s.floorId === fid).length;
    if (!window.confirm(`Delete floor "${f?.name || "(unnamed)"}" and its ${nRooms} room(s) and ${nShapes} shape(s)? This cannot be undone.`)) return;
    const remaining = floors.filter((x) => x.id !== fid);
    setRooms((a) => a.filter((r) => r.floorId !== fid));
    setShapes((a) => a.filter((s) => s.floorId !== fid));
    setMarkers((a) => a.filter((m) => m.floorId !== fid));
    setFloors(remaining);
    if (jobId) { try { await deleteImageBlob(imageKeyFor(jobId, fid, FIRST_FLOOR_ID)); } catch {} }
    if (activeFloor === fid) await switchFloor(remaining[0].id);
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
      const w = imgW ?? img?.w ?? 0, h = imgH ?? img?.h ?? 0;
      // keep the active floor's stored image size in step with what's on screen
      const outFloors = floors.map((f) => f.id === activeFloor ? { ...f, imgW: w, imgH: h } : f);
      const meta = {
        id: jobId, name: jobName, rooms, shapes, markers, property,
        floors: outFloors, activeFloor,
        // Legacy v4.x mirror — keeps this record readable by the live v4.2 app. Mirrors the
        // FIRST floor only, so once a job genuinely has multiple floors this is a lossy
        // back-read, not a backup. Dropped when v5.0 ships and the live app can read floors[].
        calLine: outFloors[0]?.calLine ?? null, scale: outFloors[0]?.scale ?? null,
        imgW: w, imgH: h,
        savedAt: new Date().toISOString(),
      };
      await putJob(meta);
      const entry = { id: jobId, name: jobName || "Unnamed job", savedAt: meta.savedAt };
      setIndex((prev) => [entry, ...prev.filter((j) => j.id !== jobId)]);
      setSaveState("saved");
    } catch { setSaveState("error"); }
  }, [storageOk, jobId, jobName, rooms, shapes, markers, floors, activeFloor, property, img]);

  // autosave (debounced) on any markup change.
  // v7.5 item 1 — 1200 ms -> 400 ms: a number box now commits ~120 ms after the last keystroke,
  // so a typed value reaches IndexedDB well inside a second (a reload 1 s after typing restores
  // it). persistMeta writes only the job record, never the plan image, so this is cheap.
  useEffect(() => {
    if (view !== "editor" || !storageOk || !loadedRef.current || !jobId) return;
    setSaveState("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistMeta(), 400);
    return () => clearTimeout(saveTimer.current);
  }, [shapes, rooms, markers, jobName, floors, property]); // eslint-disable-line

  // v7.5 item 1 — coverage is checked by SELECTOR over the left bar, not a hand-kept list: any
  // numeric box added later that is not a NumField (and not explicitly exempted) shouts in dev.
  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    const stray = document.querySelectorAll('[data-left-bar] input:is([inputmode="decimal"],[inputmode="numeric"],[type="number"]):not([data-numfield]):not([data-numfield-exempt])');
    if (stray.length) console.error(`v7.5 item 1: ${stray.length} numeric box(es) in the left bar do not save as typed — use <NumField>`, stray);
  });

  // v7.5 item 1 — leaving / reloading the page commits any pending number-box edit and saves at once
  // instead of waiting on the autosave debounce.
  useEffect(() => {
    const onLeave = () => { if (view === "editor" && loadedRef.current) fresh("persistMeta")(); };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("pagehide", onLeave); window.removeEventListener("beforeunload", onLeave); };
  }); // re-bind each render so view is fresh

  // ---------- image input (compress -> persist as Blob) ----------
  const loadImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = async () => {
        let { src, w, h } = normaliseImage(im, r.result);
        const fid = activeFloor;                      // the floor this plan is being loaded into
        setImg({ src, w, h });
        setSelId(null);
        // If a markup-only project was imported, rescale THIS FLOOR's coordinates to this image.
        // pendingRescale is keyed by floor: each floor is re-paired with its own plan separately
        // and they are routinely different sizes.
        const pr = pendingRescale.current?.[fid];
        if (pr && pr.w > 0) {
          const f = w / pr.w;
          const aspectOk = Math.abs(h / w - pr.h / pr.w) < 0.02;
          if (f !== 1) {
            setShapes((prev) => prev.map((s) => (s.floorId ?? fid) !== fid ? s : (s.type === "rect"
              ? { ...s, x: s.x * f, y: s.y * f, w: s.w * f, h: s.h * f }
              : { ...s, x1: s.x1 * f, y1: s.y1 * f, x2: s.x2 * f, y2: s.y2 * f })));
            patchFloor(fid, (fl) => ({
              calLine: fl.calLine ? { x1: fl.calLine.x1 * f, y1: fl.calLine.y1 * f, x2: fl.calLine.x2 * f, y2: fl.calLine.y2 * f } : fl.calLine,
              scale: fl.scale ? fl.scale / f : fl.scale,
            }));
          }
          if (!aspectOk) alert("Warning: this image's aspect ratio differs from the original plan — markup may be misaligned. Verify against the plan and re-check calibration with Measure before exporting.");
          delete pendingRescale.current[fid];
        }
        patchFloor(fid, { imgW: w, imgH: h });
        requestAnimationFrame(() => fitView(w, h));
        // persist image blob under THIS floor's key
        if (storageOk && jobId) {
          setSaveState("saving");
          try {
            const blob = dataURLToBlob(src);
            await putImageBlob(imageKeyFor(jobId, fid, FIRST_FLOOR_ID), blob);
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
  // v6.0 — an undo entry snapshots shapes AND rooms. Deleting a room removes both, so restoring
  // only the shapes would bring them back pointing at a room id that no longer exists, silently
  // turning them into orphans — worse than not undoing at all.
  // v7.1 — an undo entry snapshots ROOMS only when the operation itself mutates rooms
  // (deleteRoom). Every shape draw and even a select-click pushes an entry; typing a room
  // height is NOT an undo step. Snapshotting rooms on every entry meant any Ctrl+Z after a
  // height edit silently rolled the height back to the snapshot ("CH keeps resetting to 2.4"
  // — reproduced: edit 3.1 → undo a shape → 2.7). Restore therefore touches rooms only when
  // the entry carries them.
  const pushUndo = useCallback((withRooms = false) =>
    setUndoStack((s) => [...s.slice(-49), { shapes, markers, ...(withRooms ? { rooms } : {}) }]), [shapes, rooms, markers]);

  // ---------- pointer handling ----------
  const onPointerDown = (e) => {
    if (!img) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (tool === "pan" || spaceDown.current || e.button === 1) {
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, p: { ...pan } }; return;
    }
    const pt = toImg(e);
    if (tool === "select") {
      // v7.0 — markers are small and sit on top of everything, so they get first refusal on a
      // click. A marker hit selects/moves the marker; shape cycling is untouched underneath.
      const mHit = [...markers].reverse().find((m) => (m.floorId ?? activeFloor) === activeFloor && hitMarker(m, pt));
      if (mHit) {
        setSelMarkerId(mHit.id); setSelId(null);
        pushUndo();
        drag.current = { mode: "marker-move", id: mHit.id, sx: pt.x, sy: pt.y, orig: { ...mHit } };
        return;
      }
      setSelMarkerId(null);
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
      const hits = [...shapes].reverse().filter((s) => (s.floorId ?? activeFloor) === activeFloor && hitShape(s, pt));
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
      // v6.0 item 4 — a roof-void shape binds to a ROOF VOID room, resolved by void_type and
      // never by room name. If there is none it offers to create one; declining aborts the draw
      // rather than producing an unassigned shape that becomes an orphan line in the quote.
      let roomForShape = activeRoom;
      if (cat.id === "roof_void_decon") {
        const rv = ensureRoofVoidRoom();
        if (!rv) return;
        roomForShape = rv.id;
      }
      pushUndo();
      const s = cat.kind === "fill"
        ? { id: nid(), type: "rect", cat: cat.id, room: roomForShape, floorId: activeFloor, x: pt.x, y: pt.y, w: 0, h: 0,
            ...(INSULATION_CATS.has(cat.id) ? { insulation: roofInsulation, insulationType: roofInsulationType } : {}),
            ...(cat.id === "cabinetry" ? { cabH: cabHgt === "custom" ? cabHgtCustom : cabHgt } : {}),
            // v7.1 — the chip's covering default now actually lands on the shape (v7.0 omitted this)
            ...(cat.id === "floor_strip" ? { floorCov } : {}) }
        : { id: nid(), type: "line", cat: cat.id, room: roomForShape, floorId: activeFloor, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
            ...(cat.id === "wall_strip" ? { hgt: wallHgt, cornice: wallCornice, skirting: wallSkirting, skirtingOnly: wallSkirtingOnly,
                                           insulationRemoval: wallInsulation && !wallSkirtingOnly } : {}) };
      setShapes((a) => [...a, s]);
      drag.current = { mode: "new", id: s.id, sx: pt.x, sy: pt.y };
      return;
    }
    // v7.0 item 8 — place an equipment marker: one click, fixed size, room = active room.
    // Placement immediately starts a move-drag so a slightly-off click can be corrected in the
    // same gesture; drymatic markers start with heat mats UNSET (flagged, never defaulted).
    if (tool === "marker") {
      pushUndo();
      const kind = markerKindById(activeMarkerKind);
      const m = { id: nid(), kind: kind.id, room: activeRoom, floorId: activeFloor, x: pt.x, y: pt.y,
                  ...(kind.hasHeatMats ? { heatMatsM2: "" } : {}) };
      setMarkers((a) => [...a, m]);
      setSelMarkerId(m.id); setSelId(null);
      drag.current = { mode: "marker-move", id: m.id, sx: pt.x, sy: pt.y, orig: { ...m } };
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
    } else if (d.mode === "marker-move") {
      const dx = pt.x - d.sx, dy = pt.y - d.sy, o = d.orig;
      setMarkers((a) => a.map((m) => m.id !== d.id ? m : { ...m, x: o.x + dx, y: o.y + dy }));
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
      // Decide keep/discard from the live drag geometry so the selection can be set outside
      // the updater (updaters must stay pure).
      const cur = shapes.find((s) => s.id === d.id);
      const ok = cur && (cur.type === "rect" ? (cur.w > MIN_PX && cur.h > MIN_PX) : Math.hypot(cur.x2 - cur.x1, cur.y2 - cur.y1) > MIN_PX);
      if (!ok) { setShapes((a) => a.filter((s) => s.id !== d.id)); setUndoStack((u) => u.slice(0, -1)); }
      // v7.1 — a freshly drawn shape becomes the selection so its covering / height / zone can
      // be set immediately. The draw tool stays active so consecutive shapes still work.
      else { setSelId(d.id); setSelMarkerId(null); }
    }
  };

  // v7.1 — zoom about the viewport centre (buttons), same maths as the wheel handler
  const zoomAbout = (nz) => {
    const el = wrapRef.current; if (!el) return;
    const z = Math.min(8, Math.max(0.05, nz));
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setPan({ x: cx - (cx - pan.x) * (z / zoom), y: cy - (cy - pan.y) * (z / zoom) });
    setZoom(z);
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
      if ((e.key === "Delete" || e.key === "Backspace") && selMarkerId && !isTyping(e)) {
        pushUndo(); setMarkers((a) => a.filter((m) => m.id !== selMarkerId)); setSelMarkerId(null);
      }
      // v7.1 — Escape: drop the selection and return to the Select tool
      if (e.key === "Escape" && !isTyping(e)) { setSelId(null); setSelMarkerId(null); setMeasure(null); setTool("select"); }
      // v7.1 — arrow keys nudge the selected shape/marker by 1 SCREEN px (Shift = 10)
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && (selId || selMarkerId) && !isTyping(e)) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / zoom;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        pushUndo();
        if (selId) setShapes((a) => a.map((s) => s.id !== selId ? s : s.type === "rect"
          ? { ...s, x: s.x + dx, y: s.y + dy } : { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }));
        if (selMarkerId) setMarkers((a) => a.map((m) => m.id !== selMarkerId ? m : { ...m, x: m.x + dx, y: m.y + dy }));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !isTyping(e)) {
        setUndoStack((u) => {
          if (!u.length) return u;
          const prev = u[u.length - 1];
          setShapes(prev.shapes);
          if (prev.rooms) setRooms(prev.rooms);   // only room-mutating entries carry rooms (v7.1)
          setMarkers(prev.markers ?? []);
          setSelId(null); setSelMarkerId(null);   // the selection may be one of the items being restored/removed
          return u.slice(0, -1);
        });
      }
    };
    const ku = (e) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [selId, selMarkerId, pushUndo, zoom]);
  const isTyping = (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

  // hit tests
  // v7.3 — marker size in IMAGE px from the floor's scale (fixed real-world footprint), with a
  // screen-px floor so a far-zoomed-out marker is still visible and clickable.
  const markerSizePx = (m) => {
    const sc = scaleOf(m);
    const planPx = sc ? markerSizeM / sc : MARKER_FALLBACK_PX;
    return Math.max(planPx, MARKER_MIN_SCREEN_PX / zoom);
  };
  const hitMarker = (m, p) => Math.hypot(p.x - m.x, p.y - m.y) < markerSizePx(m) / 2 + 4 / zoom;
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
      if (row.wallInsulM2 > 0) lines.push({ label: "Wall insulation removal", text: `${fmt(row.wallInsulM2)} m²` });   // v7.5 item 3
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
      <NumField value={property[k]} onCommit={(v) => setProp(k, v)}
        style={{ ...st.chInput, width: 46, fontSize: 11.5 }} />
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



  const downloadFile = (filename, text) => {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- v6.0 item 1: scope image (PNG) ----------
  // The markup already carries the whole scope visually; today that picture only exists on
  // screen. This renders it as a figure for a quote or an ops handoff. ONE IMAGE PER FLOOR —
  // shape coordinates live in their own floor's plan pixel space, so floors cannot be combined.
  // Rendered at the STORED PLAN RESOLUTION, not the zoomed viewport, or text is unreadable on
  // a 4000 px plan. Not client-branded: it is a figure, not a standalone deliverable.
  const hexToRgba = (hex, a) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  // Legend quantities must match what the QUOTE says, or the image recreates the confusion it
  // exists to remove: Condition 2 is the NET, cabinetry is FACE, containment is a count.
  const scopeLegendEntries = (fid, fShapes) => {
    const rowsF = roomRows().filter((r) => r.floorId === fid);
    const out = [];
    for (const c of LEFT_BAR_CATS) {   // v7.5 item 2 — legend follows the left-bar order
      const cs = fShapes.filter((s) => s.cat === c.id);
      if (!cs.length) continue;
      const sum = (arr, fn) => arr.reduce((a, s) => a + (fn(s) || 0), 0);
      let text;
      if (c.id === "containment") text = `${cs.length} ×`;
      else if (c.id === "condition2") text = `${fmt(round2(rowsF.reduce((a, r) => a + (r.counts.condition2 || 0), 0)))} m² net`;
      // Cabinetry with no height set computes 0. Printing a confident "0.00 m²" onto a figure
      // that goes out with a quote is how a scope silently loses a line — say so instead.
      else if (c.id === "cabinetry") text = cs.some((s) => !cabHOf(s))
        ? "height not set ⚠" : `${fmt(round2(sum(cs, qtyOf)))} m² face`;
      else if (c.id === "wall_strip") text = `${fmt(round2(sum(cs, qtyOf)))} m² · ${fmt(round2(sum(cs.filter((s) => !s.skirtingOnly), lenOf)))} Lm`;
      else text = `${fmt(round2(sum(cs, qtyOf)))} m²`;
      out.push({ color: c.color, kind: c.kind, label: c.label, text });
      // v7.5 item 3 — the insulation-flagged wall strip gets its own swatch variant + line
      const ins = c.id === "wall_strip" ? cs.filter(wallInsulationOn) : [];
      if (ins.length) out.push({ color: c.color, kind: "line", insulation: true, label: "Wall strip + cavity insulation removal", text: `${fmt(round2(sum(ins, qtyOf)))} m²` });
    }
    return out;
  };
  // v7.0 item 2 — one image PER OVERLAY plus the combined. Where transparent fills overlap on
  // the combined image the colours blend, shapes disappear and the legend stops matching what
  // is visible; a single-layer image has no blending and its legend is exact by construction.
  // overlay: "ALL" | a category id | "equipment" (markers get their own layer).
  const loadImageEl = (src) => new Promise((res, rej) => {
    const el = new Image();
    el.onload = () => res(el); el.onerror = rej; el.src = src;
  });
  const renderScopeBlob = async (overlay) => {
    const fid = activeFloor;
    const fRec = activeFloorRec;
    const allShapes = shapes.filter((s) => (s.floorId ?? fid) === fid);
    const allMarkers = markers.filter((m) => (m.floorId ?? fid) === fid);
    const fShapes = overlay === "ALL" ? allShapes : overlay === "equipment" ? [] : allShapes.filter((s) => s.cat === overlay);
    const fMarkers = (overlay === "ALL" || overlay === "equipment") ? allMarkers : [];
    // legend: exactly what THIS image shows — a single-layer image never lists another layer
    let entries = overlay === "equipment" ? [] : scopeLegendEntries(fid, fShapes);
    const markerEntries = fMarkers.length
      ? MARKER_KINDS.map((k) => {
          const ms = fMarkers.filter((m) => m.kind === k.id);
          if (!ms.length) return null;
          const heat = k.hasHeatMats ? round2(ms.reduce((a, m) => a + (parseFloat(m.heatMatsM2) || 0), 0)) : 0;
          return { icon: k.icon, label: k.label, text: `${ms.length} ×${k.hasHeatMats ? (heat > 0 ? ` · ${fmt(heat)} m² heat mats` : " · heat mats NOT SET ⚠") : ""}` };
        }).filter(Boolean)
      : [];
    {
      const im = await loadImageEl(img.src);
      const iconEls = {};
      for (const k of MARKER_KINDS) if (fMarkers.some((m) => m.kind === k.id)) iconEls[k.id] = await loadImageEl(k.icon);
      const W0 = img.w, H0 = img.h;
      const fs = Math.max(13, Math.round(W0 / 85));          // scale type to the plan, not the screen
      const PAD = Math.round(fs * 1.2);
      const headerH = Math.round(fs * 3.4);
      const rowH = Math.round(fs * 1.75);
      const legendCount = entries.length + markerEntries.length;
      const cols = legendCount > 7 ? 2 : 1;
      const legendH = legendCount ? Math.round(fs * 1.6) + Math.ceil(legendCount / cols) * rowH : 0;
      const footerH = Math.round(fs * 2.2);
      const W = W0 + PAD * 2, H = headerH + H0 + legendH + footerH;
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const g = cv.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
      // header
      g.fillStyle = "#111"; g.textBaseline = "top";
      g.font = `600 ${Math.round(fs * 1.15)}px system-ui, sans-serif`;
      g.fillText(jobName || "UNNAMED JOB", PAD, Math.round(fs * 0.6));
      g.font = `${fs}px system-ui, sans-serif`; g.fillStyle = "#444";
      const overlayLabel = overlay === "ALL" ? "all layers" : overlay === "equipment" ? "Equipment" : (catById(overlay)?.label || overlay);
      g.fillText(`Scope markup${fRec?.name?.trim() ? ` — floor ${fRec.name.trim()}` : ""} — ${overlayLabel}`, PAD, Math.round(fs * 2.0));
      // plan + shapes
      g.drawImage(im, PAD, headerH, W0, H0);
      g.save();
      g.translate(PAD, headerH);
      for (const s of fShapes) {
        const c = catById(s.cat); if (!c) continue;
        if (s.type === "rect") {
          g.fillStyle = hexToRgba(c.color, FILL_OPACITY);
          g.fillRect(s.x, s.y, s.w, s.h);
          g.strokeStyle = c.color; g.lineWidth = Math.max(1.5, fs / 9); g.setLineDash([]);
          g.strokeRect(s.x, s.y, s.w, s.h);
        } else {
          g.strokeStyle = c.color; g.lineWidth = Math.max(3, fs / 4); g.lineCap = "round";
          g.setLineDash(s.skirtingOnly ? [fs / 2, fs / 3] : []);
          g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
          g.setLineDash([]);
          if (wallInsulationOn(s)) {   // v7.5 item 3 — same dashed inner stroke as on screen
            g.strokeStyle = "#fff"; g.lineWidth = Math.max(1, fs / 11); g.setLineDash([fs / 2.5, fs / 3.5]);
            g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
            g.setLineDash([]);
          }
        }
      }
      // v7.0 item 8 — equipment markers, sized relative to the plan (not the on-screen constant)
      // v7.3 — same real-world footprint as on the canvas (no screen-px floor here: the export is
      // the plan at full resolution, so the plan-size marker is always legible)
      for (const m of fMarkers) {
        const el = iconEls[m.kind]; if (!el) continue;
        const sc = scaleOf(m);
        const ms = Math.round(sc ? markerSizeM / sc : MARKER_FALLBACK_PX);
        g.fillStyle = "rgba(255,255,255,0.72)";
        g.beginPath(); g.arc(m.x, m.y, ms / 2 + Math.max(2, fs / 8), 0, Math.PI * 2); g.fill();
        g.strokeStyle = "#333"; g.lineWidth = Math.max(1, fs / 14); g.stroke();
        g.drawImage(el, m.x - ms / 2, m.y - ms / 2, ms, ms);
      }
      g.restore();
      // legend — only what is actually on THIS plan, never the full catalogue
      let y = headerH + H0 + Math.round(fs * 0.5);
      g.fillStyle = "#111"; g.font = `600 ${fs}px system-ui, sans-serif`;
      g.fillText("KEY", PAD, y);
      y += Math.round(fs * 1.5);
      const colW = Math.floor((W - PAD * 2) / cols);
      [...entries, ...markerEntries].forEach((e, i) => {
        const cx = PAD + (i % cols) * colW;
        const cy = y + Math.floor(i / cols) * rowH;
        const sw = Math.round(fs * 1.1);
        if (e.icon && iconEls[MARKER_KINDS.find((k) => k.icon === e.icon)?.id]) {
          g.drawImage(iconEls[MARKER_KINDS.find((k) => k.icon === e.icon).id], cx, cy, sw, sw);
        } else {
          g.fillStyle = hexToRgba(e.color, e.kind === "line" ? 1 : FILL_OPACITY);
          g.fillRect(cx, cy + Math.round(fs * 0.2), sw, e.kind === "line" ? Math.round(fs * 0.35) : sw);
          g.strokeStyle = e.color; g.lineWidth = 1.5;
          g.strokeRect(cx, cy + Math.round(fs * 0.2), sw, e.kind === "line" ? Math.round(fs * 0.35) : sw);
          if (e.insulation) {   // v7.5 item 3 — dashed white inner stroke, as on the plan
            const my = cy + Math.round(fs * 0.2) + Math.round(fs * 0.175);
            g.strokeStyle = "#fff"; g.lineWidth = Math.max(1, fs / 11); g.setLineDash([fs / 4, fs / 6]);
            g.beginPath(); g.moveTo(cx, my); g.lineTo(cx + sw, my); g.stroke(); g.setLineDash([]);
          }
        }
        g.fillStyle = "#111"; g.font = `${Math.round(fs * 0.92)}px system-ui, sans-serif`;
        g.fillText(e.label, cx + sw + Math.round(fs * 0.6), cy + Math.round(fs * 0.15));
        g.font = `600 ${Math.round(fs * 0.92)}px system-ui, sans-serif`;
        const tw = g.measureText(e.text).width;
        g.fillText(e.text, cx + colW - tw - Math.round(fs * 0.8), cy + Math.round(fs * 0.15));
      });
      // footer
      g.fillStyle = "#666"; g.font = `${Math.round(fs * 0.8)}px system-ui, sans-serif`;
      g.fillText(`${new Date().toLocaleDateString("en-AU")} · bml-floorplan-markup ${APP_VERSION} · quantities only, not a priced document`,
        PAD, H - footerH + Math.round(fs * 0.5));

      return await new Promise((res) => cv.toBlob(res, "image/png"));
    }
  };
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const scopeFileBase = () => {
    const jobNo = (jobName.match(/BMLJ\d+/i) || [])[0] || (jobName || "job").replace(/\s+/g, "_").slice(0, 40);
    const floorLbl = (activeFloorRec?.name?.trim() || "Floor").replace(/[^\w-]+/g, "_");
    return `${jobNo}_Scope_${floorLbl}`;
  };
  // The combined image alone (renamed *_ALL per the CO's convention).
  const exportScopeImage = async () => {
    if (!img) { alert("Load this floor's plan image first — the scope image is drawn on the plan."); return; }
    const fid = activeFloor;
    if (!shapes.some((s) => (s.floorId ?? fid) === fid) && !markers.some((m) => (m.floorId ?? fid) === fid)) { alert("Nothing is marked up on this floor yet."); return; }
    try {
      const blob = await renderScopeBlob("ALL");
      if (!blob) throw new Error("no blob");
      downloadBlob(blob, `${scopeFileBase()}_ALL.png`);
    } catch { alert("Could not render the scope image."); }
  };
  // v7.0 item 2 — one image per overlay actually used on this floor, PLUS the combined.
  // Sequential with a small gap: browsers throttle a burst of programmatic downloads.
  const exportScopeImagesPerOverlay = async () => {
    if (!img) { alert("Load this floor's plan image first — the scope images are drawn on the plan."); return; }
    const fid = activeFloor;
    const fShapes = shapes.filter((s) => (s.floorId ?? fid) === fid);
    const fMarkers = markers.filter((m) => (m.floorId ?? fid) === fid);
    if (!fShapes.length && !fMarkers.length) { alert("Nothing is marked up on this floor yet."); return; }
    const overlays = [
      ...LEFT_BAR_CATS.filter((c) => fShapes.some((s) => s.cat === c.id)).map((c) => ({ id: c.id, suffix: c.id })),
      ...(fMarkers.length ? [{ id: "equipment", suffix: "equipment" }] : []),
      { id: "ALL", suffix: "ALL" },
    ];
    try {
      for (const ov of overlays) {
        const blob = await renderScopeBlob(ov.id);
        if (!blob) throw new Error("no blob");
        downloadBlob(blob, `${scopeFileBase()}_${ov.suffix}.png`);
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch { alert("Could not render one of the scope images."); }
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
      // v7 adds markers[] (equipment), floorCov on floor-strip shapes, zone on containment
      // lines, elecFittings/plumbFixtures on rooms, and the reshaped property block.
      // Import accepts any version (it keys off `format`), so v2-v6 files still load.
      format: "bml-markup-project", version: 7, image_embedded: false,
      savedAt: new Date().toISOString(),
      imgW: img?.w || 0, imgH: img?.h || 0,
      // v5.0: floors[] plus floorId-tagged rooms/shapes. calLine/scale are still written as a
      // first-floor mirror so the live v4.2 app can still read a file saved from here.
      jobName, rooms, shapes, markers, property, floors, activeFloor,
      calLine: floors[0]?.calLine ?? null, scale: floors[0]?.scale ?? null,
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
      // v7.5 — the PROJECT-file migration is shared with the headless re-export (quantities.js).
      const mig = migrateProjectFile(d);
      const { shapes, convertedFullStrip, activeFloor: af } = mig;
      setJobId(id); setJobName(mig.jobName); setRooms(mig.rooms);
      setActiveRoom(mig.rooms.find((r) => r.floorId === af)?.id ?? null);
      setShapes(mig.shapes); setFloors(mig.floors); setActiveFloor(af);
      setMarkers(mig.markers); setSelMarkerId(null);
      setSelId(null); setUndoStack([]);
      setProperty(mig.property);
      setHiddenCats(new Set()); setHiddenRooms(new Set());
      idRef.current = Math.max(1, ...shapes.map((s) => s.id + 1), ...(d.rooms || []).map((x) => x.id + 1), ...(d.markers || []).map((m) => m.id + 1));
      if (d.img?.src) {
        // legacy v2.1 project files with embedded image (always single-floor)
        setImg(d.img);
        pendingRescale.current = null;
        requestAnimationFrame(() => fitView(d.img.w, d.img.h));
        if (storageOk) {
          (async () => {
            try {
              const blob = dataURLToBlob(d.img.src);
              await putImageBlob(imageKeyFor(id, af, FIRST_FLOOR_ID), blob);
            } catch {}
          })();
        }
      } else {
        setImg(null);
        // Each floor is re-paired with its OWN plan and auto-rescaled against the size it was
        // marked up at, so the pending sizes are keyed by floor rather than one job-wide pair.
        const pend = {};
        for (const f of mig.floors) if (f.imgW) pend[f.id] = { w: f.imgW, h: f.imgH };
        pendingRescale.current = Object.keys(pend).length ? pend : null;
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
    const r = { id: nid(), name: n, ch: "2.4", plumbIso: false, elecIso: false, floorId: activeFloor, void_type: null };
    setRooms((a) => [...a, r]); setActiveRoom(r.id); setNewRoom("");
  };
  // v5.0 void room — created MANUALLY on the active floor with an EXPLICITLY chosen type and a
  // typed name. Nothing here is inferred: the engine keys off void_type, never off the name.
  // v6.0 — only ROOF voids are rooms now. The name is typed (pre-filled, editable); the type is
  // no longer a choice because there is only one, so nothing is being guessed.
  const roofVoidRoomsHere = rooms.filter((r) => r.floorId === activeFloor && r.void_type === "roof_void");
  const addVoidRoom = (presetName) => {
    const n = (presetName ?? newRoom).trim();
    if (!n) { alert("Type a name for the roof void room first."); return; }
    const r = { id: nid(), name: n, ch: "2.4", plumbIso: false, elecIso: false, floorId: activeFloor, void_type: "roof_void" };
    setRooms((a) => [...a, r]); setActiveRoom(r.id); if (presetName == null) setNewRoom("");
    return r;
  };
  // v6.0 item 2 — delete a room. A room carrying shapes is NEVER deleted silently: the confirm
  // states exactly how many shapes and how much area go with it, because losing quantities
  // without a warning is how a quote ends up under-scoped. Undo-able (pushUndo) and totals
  // recompute immediately, since a stale total is worse than no total.
  const deleteRoom = (id) => {
    const r = rooms.find((x) => x.id === id); if (!r) return;
    const rs = shapes.filter((s) => s.room === id);
    const rMk = markers.filter((m) => m.room === id);   // equipment markers go with the room
    let msg = `Delete room "${r.name || "(unnamed)"}"?`;
    if (rs.length || rMk.length) {
      const area = rs.reduce((a, s) => a + (s.type === "rect" ? (qtyOf(s) || 0) : 0), 0);
      const lines = rs.filter((s) => s.type === "line").length;
      const parts = [];
      if (rs.length) parts.push(`${rs.length} shape${rs.length === 1 ? "" : "s"}`);
      if (area > 0) parts.push(`${fmt(round2(area))} m²`);
      if (lines) parts.push(`${lines} line${lines === 1 ? "" : "s"}`);
      if (rMk.length) parts.push(`${rMk.length} equipment marker${rMk.length === 1 ? "" : "s"}`);
      msg = `Delete room "${r.name || "(unnamed)"}" AND ITS MARKUP?\n\nThis destroys ${parts.join(" · ")}.\nThose quantities will disappear from the quote.\n\nCtrl+Z will undo it.`;
    }
    if (!window.confirm(msg)) return;
    pushUndo(true);   // this op mutates rooms — the only entry type that restores them
    setShapes((a) => a.filter((s) => s.room !== id));
    setMarkers((a) => a.filter((m) => m.room !== id));
    setRooms((a) => a.filter((x) => x.id !== id));
    if (activeRoom === id) setActiveRoom(rooms.find((x) => x.id !== id && x.floorId === activeFloor)?.id ?? null);
    if (selMarkerId != null && rMk.some((m) => m.id === selMarkerId)) setSelMarkerId(null);
    if (selId != null && rs.some((s) => s.id === selId)) setSelId(null);
    if (roofVoidTarget === id) setRoofVoidTarget(null);
  };

  // A roof-void shape must never be left unassigned — an unassigned one produces quantities with
  // no room, which lands in the quote as an orphan line. Binding is by void_type, NEVER by the
  // room's name: matching on a name is the inference class that v5.0 exists to forbid and flags.
  const [roofVoidTarget, setRoofVoidTarget] = useState(null);
  const resolvedRoofVoidRoom = roofVoidRoomsHere.find((r) => r.id === roofVoidTarget) || (roofVoidRoomsHere.length === 1 ? roofVoidRoomsHere[0] : null);
  const ensureRoofVoidRoom = () => {
    if (resolvedRoofVoidRoom) return resolvedRoofVoidRoom;
    if (roofVoidRoomsHere.length > 1) { alert("This floor has more than one roof void room — pick which one these shapes belong to first."); return null; }
    if (!window.confirm('This floor has no roof void room, and a roof-void shape cannot be left unassigned.\n\nCreate a room "Roof Void" on this floor now? (You can rename it afterwards.)')) return null;
    const r = addVoidRoom("Roof Void");
    if (r) setRoofVoidTarget(r.id);
    return r;
  };

  const sel = shapes.find((s) => s.id === selId);
  const selMarker = markers.find((m) => m.id === selMarkerId);
  const measLen = measure ? Math.hypot(measure.x2 - measure.x1, measure.y2 - measure.y1) : 0;
  const labelFs = Math.max(11 / zoom, 2);
  const saveLabel = { idle: "", dirty: "Unsaved…", saving: "Saving…", saved: "Saved ✓", error: "SAVE FAILED — export project JSON now" }[saveState];
  const versionStamp = `${APP_VERSION}${BUILD_DATE ? ` · ${BUILD_DATE}` : ""}`;

  // ---------- modals (shared between views) ----------
  // v7.0 items 6+7 — ALL instruction text in one place, shown in the first-open modal AND the
  // collapsible Instructions section. Nothing was deleted from the old always-visible copy; the
  // C2 netting line is REWORDED per the CO with one correction: the CO's draft said "the pricing
  // engine subtracts stripped surfaces" — since v4.0 the APP nets at export and the engine
  // asserts the netted figure. The instruction to Jordan (draw the full zone) is identical
  // under both mechanisms; the attribution is now the true one. Deviation logged for the PRC.
  const instructionsBody = (
    <>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Condition 2 (blue):</strong> C2 zone total = gross floor + ceiling + walls of the drawn zone. Do NOT try to exclude strip-out areas from the zone — stripped surfaces are subtracted automatically (the app nets them out of the exported C2 figure; the pricing engine asserts that netted figure, prices strip areas at strip rates and only the REMAINDER at decon rates). Drawing around strip areas double-nets and under-prices the decon. Part-room zones are fine.</div>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Spot cuts:</strong> draw the ACTUAL cutout area (incl. your strip-past-contamination allowance) — quantities price what you draw.</div>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Selecting:</strong> click again on overlapping shapes (same spot) to select the one underneath — cycles through the stack. Shift = straight lines · Del = delete selected · Ctrl+Z = undo · scroll = zoom · space-drag = pan.</div>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Floor strip:</strong> every floor-strip shape needs its floor covering selected — the strip rate depends on it and the export hard-errors without it.</div>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Equipment:</strong> place icon markers on the plan (section 3), tagged to the active room — counts export per room. Drymatic markers also need heat mats m². Days are entered once, in Property scope.</div>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Floors:</strong> each floor has its OWN plan image and calibration. Labels are yours — the app never names a floor. Roof-void shapes bind to a roof void room; a ceiling void between storeys is scoped with strip-ceiling + its insulation option.</div>
      <div style={st.meta}><strong style={{ color: "#1b1e24" }}>Never priced here:</strong> this tool exports quantities only — rates and pricing live in the engine.</div>
    </>
  );

  const modals = (
    <>
      <style>{GLOBAL_CSS}</style>
      {instructionsOpen && (
        <div style={st.overlay}>
          <div style={{ ...st.modal, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...st.h, fontSize: 13 }}>How to mark up (read once)</div>
            {instructionsBody}
            <div style={st.row}>
              <button style={{ ...btn(false), flex: 1, background: "#2f6df6", borderColor: "#2f6df6", color: "#fff" }}
                onClick={() => setInstructionsOpen(false)}>
                Got it — start marking up
              </button>
            </div>
            <div style={{ ...st.meta, fontSize: 10.5 }}>This text stays available under the "Instructions" section in the left bar.</div>
          </div>
        </div>
      )}
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

  // ---------- v7.5 item 1 — nothing reads state while a number box still has an edit pending ----------
  // commitPendingEdits() pushes every queued number-box value into state and re-renders
  // synchronously (flushSync). A handler that READS job state is then invoked through fresh(), which
  // runs the version of that handler from the render that already holds the committed values —
  // calling the old closure after the flush would read the pre-commit state and race the debounce.
  latest.current = { exportQuantities, exportProject, exportScopeImage, exportScopeImagesPerOverlay, switchFloor, persistMeta };

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
          <div style={{ ...st.row, justifyContent: "space-between" }}>
            <div style={st.h}>Saved jobs ({index.length})</div>
            <input style={{ ...st.input, padding: "5px 8px", fontSize: 12, width: 200 }} placeholder="Search job no. or name…"
              value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} />
          </div>
          {index.length === 0 && <div style={st.meta}>No saved jobs yet. Markup autosaves — you can close and return any time.</div>}
          {index.filter((j) => !jobQuery.trim() || (j.name || "Unnamed job").toLowerCase().includes(jobQuery.trim().toLowerCase())).map((j) => (
            <div key={j.id} style={{ ...st.roomRow, padding: "10px 12px" }}>
              <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openJob(j.id)}>
                <div style={{ fontWeight: 600 }}>{j.name || "Unnamed job"}</div>
                <div style={st.meta}>Saved {new Date(j.savedAt).toLocaleString("en-AU")}</div>
              </div>
              <button style={btn(false)} onClick={() => openJob(j.id)}>Open</button>
              <button style={{ ...btn(false), color: "#c62828" }} onClick={() => deleteJob(j.id)}>Delete</button>
            </div>
          ))}
          {busy && <div style={st.meta}>Loading…</div>}
        </div>
        {modals}
      </div>
    );
  }

  const propertyTotals = computePropertyTotals();
  const insulationTotals = computeInsulationRemoval();
  const equipTotals = computeEquipment();
  // v7.1 — the SAME flags the export carries, shown live. Until now they were invisible until
  // Jordan exported. Clicking a flag focuses the room/floor it names.
  const liveFlags = view === "editor" ? buildExport().flags : [];
  const liveErrors = liveFlags.filter((f) => f.severity === "ERROR").length;
  const focusFlag = async (f) => {
    if (f.floor != null && f.floor !== "") { const fl = floors.find((x) => (x.name || "") === f.floor); if (fl && fl.id !== activeFloor) await switchFloor(fl.id); }
    if (f.room) { const rm = rooms.find((x) => x.name === f.room && (!f.floor || (floors.find((fl) => fl.id === x.floorId)?.name || "") === f.floor)); if (rm) setActiveRoom(rm.id); }
    setCollapsed((c) => ({ ...c, rooms: false }));
  };
  const anyPropertyEntered = propertyTotals.decon_m2 > 0 || insulationTotals.total_m2 > 0 ||
    propertyTotals.floorProt > 0 || equipTotals.any ||
    parseFloat(property.air_mover_units) > 0 ||
    parseFloat(property.dbkii_days) > 0 || parseFloat(property.ac_ducted_units) > 0 ||
    parseFloat(property.ac_duct_removal_rooms) > 0 ||
    parseFloat(property.prv_areas) > 0 || property.contents_packout || property.contents_inventory ||
    property.skip_bin || property.asbestos_testing || property.contents_storage !== "none";

  // ================= EDITOR =================
  return (
    <div style={st.app}>
      <div style={st.panel} data-left-bar="">
        <div style={{ ...st.row, justifyContent: "space-between" }}>
          <span style={{ ...st.brand, cursor: "pointer" }} onClick={() => { fresh("persistMeta")(); listJobs().then(setIndex); setView("home"); }}>← JOBS</span>
          <span style={{ ...st.meta, color: saveState === "error" ? "#c62828" : "#5b6270" }}>{saveLabel}</span>
        </div>
        {!storageOk && <div style={st.warn}>No persistence in this browser — export project JSON before closing.</div>}

        <input style={st.input} placeholder="Job — e.g. BMLJ00652 — 12 Sample St" value={jobName} onChange={(e) => setJobName(e.target.value)} />

        {/* ---------- floors strip (v5.0) ---------- */}
        <div style={st.section}>
          <div style={{ ...st.h, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>FLOORS</span>
            <button style={{ ...btn(false), padding: "2px 6px", fontSize: 11 }} onClick={addFloor}
              disabled={floors.length >= MAX_FLOORS} title={`Up to ${MAX_FLOORS} floors per job`}>+ Add floor</button>
          </div>
          {floors.map((f, i) => {
            const active = f.id === activeFloor;
            const nR = rooms.filter((r) => r.floorId === f.id).length;
            const nS = shapes.filter((s) => s.floorId === f.id).length;
            return (
              <div key={f.id} style={{ ...st.roomRow, outline: active ? "1px solid #6ea8fe" : "none", cursor: "pointer" }}
                onClick={() => fresh("switchFloor")(f.id)}>
                <input value={f.name} onClick={(e) => e.stopPropagation()}
                  placeholder="label… (e.g. G / L1 / L2)"
                  onChange={(e) => renameFloor(f.id, e.target.value)}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", borderBottom: "1px dashed #9aa3b0", color: "#1b1e24", fontSize: 13, padding: "2px 0" }} />
                <span style={{ ...st.meta, fontSize: 10 }} title="rooms · shapes on this floor">{nR}r·{nS}s</span>
                {!f.scale && (nR > 0 || nS > 0) && <span title="This floor is not calibrated — its quantities are invalid" style={{ color: "#b7791f", fontSize: 11 }}>⚠</span>}
                <span title="Move up" style={{ cursor: "pointer", opacity: i === 0 ? 0.25 : 0.7 }}
                  onClick={(e) => { e.stopPropagation(); moveFloor(f.id, -1); }}>▲</span>
                <span title="Move down" style={{ cursor: "pointer", opacity: i === floors.length - 1 ? 0.25 : 0.7 }}
                  onClick={(e) => { e.stopPropagation(); moveFloor(f.id, 1); }}>▼</span>
                <span title="Delete this floor" style={{ cursor: "pointer", opacity: 0.7 }}
                  onClick={(e) => { e.stopPropagation(); deleteFloor(f.id); }}>✕</span>
              </div>
            );
          })}
          <div style={{ ...st.meta, fontSize: 10.5 }}>
            Each floor has its OWN plan image and calibration. Labels are yours — the app never names a floor.
          </div>
        </div>

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
                  {/* v7.5 item 1 — deliberately NOT a NumField: this is the argument to the Set
                      button, not stored job data. Committing it per keystroke would recalibrate
                      the floor mid-typing (e.g. "3" on the way to "3.6"). */}
                  <input data-numfield-exempt="calibration input — applied by Set" style={{ ...st.input, flex: 1 }} placeholder="Wall length" value={calInput} onChange={(e) => setCalInput(e.target.value)} inputMode="decimal" />
                  <select style={st.selectEl} value={calUnit} onChange={(e) => setCalUnit(e.target.value)}>
                    <option value="m">m</option><option value="mm">mm</option>
                  </select>
                  <button style={btn(false)} onClick={applyScale}>Set</button>
                </div>
              )}
              <div style={st.meta}>
                {scale
                  ? <>Scale locked: 1 px = {fmt(scale * 1000, 1)} mm. Cross-check with Measure before drawing.</>
                  : <span style={{ color: "#b7791f" }}>Not calibrated — quantities disabled.</span>}
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
              {/* v6.0 — only ROOF voids are rooms. A ceiling void between storeys is scoped with
                  the strip-ceiling shape and its insulation option, not as a room. */}
              <div style={st.row}>
                <button style={{ ...btn(false), flex: 1 }} onClick={() => addVoidRoom()}
                  title="Creates a roof void room on this floor using the name typed above">+ Add roof void room</button>
              </div>
              <div style={{ ...st.meta, fontSize: 10.5 }}>
                Roof void = between the top floor and the roof. A ceiling void between storeys is NOT a roof void —
                scope that with the strip-ceiling shape and its insulation option.
              </div>
              {/* v7.1 — two-line room row. v7.0 crammed name · CH · PL · EL · EF · PF · 👁 · ✕ into one
                  340 px line and the name input (flex:1, minWidth:0) collapsed to nothing. */}
              {rooms.filter((r) => (r.floorId ?? activeFloor) === activeFloor).map((r) => {
                const mk = markers.filter((m) => m.room === r.id).length;
                const upd = (patch) => setRooms((a) => a.map((x) => x.id === r.id ? { ...x, ...patch } : x));
                const tiny = { display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "#5b6270" };
                return (
                  <div key={r.id} style={{ ...st.roomRow, flexDirection: "column", alignItems: "stretch", gap: 5,
                      outline: activeRoom === r.id ? "1px solid #6ea8fe" : "none", opacity: hiddenRooms.has(r.id) ? 0.55 : 1 }}
                    onClick={() => { commitPendingEdits(); setActiveRoom(r.id); }}>
                    <div style={st.row}>
                      <input value={r.name} onClick={(e) => e.stopPropagation()} placeholder="room name"
                        onChange={(e) => upd({ name: e.target.value })}
                        style={{ flex: 1, minWidth: 80, background: "transparent", border: "none", borderBottom: "1px dashed #9aa3b0", color: "#1b1e24", fontSize: 13, padding: "2px 0" }} />
                      {r.void_type && (
                        <span title={`Exported as void_type "${r.void_type}" — the engine keys off this, not the name`}
                          style={{ fontSize: 9.5, padding: "1px 4px", borderRadius: 3, background: "#795548", color: "#fff", whiteSpace: "nowrap" }}>
                          {r.void_type === "roof_void" ? "ROOF VOID" : "CEILING VOID"}
                        </span>
                      )}
                      {mk > 0 && <span title={`${mk} equipment marker${mk === 1 ? "" : "s"} in this room`} style={{ ...st.meta, fontSize: 10.5, whiteSpace: "nowrap" }}>{mk} ⚙</span>}
                      <span title="Toggle this room's shapes on canvas" style={{ cursor: "pointer", opacity: hiddenRooms.has(r.id) ? 1 : 0.5 }}
                        onClick={(e) => { e.stopPropagation(); toggleHiddenRoom(r.id); }}>👁</span>
                      <span title="Delete this room" style={{ cursor: "pointer", opacity: 0.6 }}
                        onClick={(e) => { e.stopPropagation(); deleteRoom(r.id); }}>✕</span>
                    </div>
                    <div style={{ ...st.row, gap: 8, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                      <label style={tiny} title="Ceiling height (m)">CH
                        <NumField style={st.chInput} value={r.ch ?? ""} onCommit={(v) => upd({ ch: v })} />m
                      </label>
                      <label style={tiny} title="Plumbing isolation"><input type="checkbox" checked={!!r.plumbIso} onChange={(e) => upd({ plumbIso: e.target.checked })} />PL</label>
                      <label style={tiny} title="Electrical isolation"><input type="checkbox" checked={!!r.elecIso} onChange={(e) => upd({ elecIso: e.target.checked })} />EL</label>
                      {/* v7.0 item 9 — EF = electrical fittings on linings being stripped; PF = plumbing fixtures */}
                      <label style={tiny} title="Electrical fittings on linings being stripped (count)">EF
                        <NumField style={{ ...st.chInput, width: 30 }} value={r.elecFittings ?? ""} inputMode="numeric" onCommit={(v) => upd({ elecFittings: v })} />
                      </label>
                      <label style={tiny} title="Plumbing fixtures (count — plumbing prices base + per fixture)">PF
                        <NumField style={{ ...st.chInput, width: 30 }} value={r.plumbFixtures ?? ""} inputMode="numeric" onCommit={(v) => upd({ plumbFixtures: v })} />
                      </label>
                    </div>
                  </div>
                );
              })}
              <label style={{ ...st.meta, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }} title="Dim every room except the active one (display only — never affects quantities)">
                <input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} /> Isolate active room on canvas
              </label>
              <div style={st.meta}>Active room is tagged onto every new shape.</div>
            </>
          )}
        </div>

        <div style={st.section}>
          {sectionHead("markup", "3 · Mark up scope")}
          {!collapsed.markup && (
            <>
              <div style={st.chips}>
                {LEFT_BAR_CATS.map((c) => (
                  <button key={c.id} style={chip(c, tool === "draw" && activeCat === c.id)}
                    onClick={() => { setActiveCat(c.id); setTool("draw"); }} disabled={!img}>
                    <span style={{ ...st.swatch, background: c.color, opacity: (c.kind === "fill" ? 0.8 : 1) * (hiddenCats.has(c.id) ? 0.35 : 1), height: c.kind === "line" ? 3 : 12 }} />
                    <span style={{ opacity: hiddenCats.has(c.id) ? 0.5 : 1 }}>{c.label}</span>
                    <span onClick={(e) => { e.stopPropagation(); toggleHiddenCat(c.id); }} title="Toggle visibility on canvas"
                      style={{ marginLeft: 2, opacity: hiddenCats.has(c.id) ? 1 : 0.5, cursor: "pointer" }}>👁</span>
                  </button>
                ))}
              </div>
              {/* v7.0 item 1 — covering REQUIRED on floor-strip scope; strip rate depends on it */}
              {activeCat === "floor_strip" && (
                <div style={st.selBox}>
                  <div style={st.row}>
                    <span style={st.meta}>Floor covering:</span>
                    <select style={{ ...st.selectEl, flex: 1 }} value={floorCov} onChange={(e) => setFloorCov(e.target.value)}>
                      <option value="">— select covering —</option>
                      {FLOOR_COVERINGS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  {!floorCov && <div style={{ ...st.meta, color: "#b7791f" }}>No covering selected — new shapes will need one set before export (the strip rate depends on it).</div>}
                </div>
              )}
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
                  {/* v7.5 item 3 — a skirting-only removal never opens the cavity */}
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                    <input type="checkbox" checked={wallInsulation && !wallSkirtingOnly} disabled={wallSkirtingOnly} onChange={(e) => setWallInsulation(e.target.checked)} /> Remove insulation from wall cavity
                  </label>
                </div>
              )}
              {/* v6.0 — which roof void room new roof-void shapes bind to. Only needed when the
                  floor has more than one; with exactly one it binds automatically, with none the
                  draw offers to create it. */}
              {activeCat === "roof_void_decon" && (
                <div style={st.selBox}>
                  {roofVoidRoomsHere.length > 1 ? (
                    <div style={st.row}>
                      <span style={st.meta}>Roof void room:</span>
                      <select style={{ ...st.selectEl, flex: 1 }} value={resolvedRoofVoidRoom?.id ?? ""}
                        onChange={(e) => setRoofVoidTarget(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">— pick which —</option>
                        {roofVoidRoomsHere.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div style={{ ...st.meta, fontSize: 11 }}>
                      {roofVoidRoomsHere.length === 1
                        ? <>Binds to roof void room <strong>{roofVoidRoomsHere[0].name}</strong>.</>
                        : <span style={{ color: "#b7791f" }}>No roof void room on this floor — drawing will offer to create one.</span>}
                    </div>
                  )}
                </div>
              )}
              {INSULATION_CATS.has(activeCat) && (
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
                      <NumField style={{ ...st.input, flex: 1 }} value={cabHgtCustom} onCommit={setCabHgtCustom} />
                    </div>
                  )}
                  {!cabHgt && <div style={{ ...st.meta, color: "#b7791f" }}>No height selected — new shapes will need one set before export (face area cannot price a footprint).</div>}
                </div>
              )}
              {/* v7.0 item 8 — equipment markers: pick a kind, click the plan to place. Fixed-size
                  point markers, room = active room, multiple per room. */}
              <div style={{ ...st.row, marginTop: 4, justifyContent: "space-between" }}>
                <span style={st.meta}>Equipment markers (click plan to place — tagged to the active room):</span>
                <label style={{ ...st.meta, display: "flex", gap: 4, alignItems: "center" }} title="Marker footprint on the plan — S 0.22 m · M 0.32 m · L 0.45 m. Display preference; never affects quantities.">
                  Size
                  <select style={{ ...st.selectEl, padding: "2px 4px", fontSize: 11 }} value={markerSize} onChange={(e) => setMarkerSize(e.target.value)}>
                    {Object.keys(MARKER_SIZES_M).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              </div>
              <div style={st.chips}>
                {MARKER_KINDS.map((k) => (
                  <button key={k.id} style={chip({ color: "#5b6270" }, tool === "marker" && activeMarkerKind === k.id)}
                    onClick={() => { setActiveMarkerKind(k.id); setTool("marker"); }} disabled={!img}
                    title={k.label}>
                    <img src={k.icon} alt="" style={{ width: 16, height: 16 }} />
                    <span>{k.label}</span>
                  </button>
                ))}
              </div>
              <div style={st.row}>
                <button style={btn(tool === "select")} onClick={() => setTool("select")}>Select / edit</button>
                <button style={btn(tool === "pan")} onClick={() => setTool("pan")}>Pan</button>
                <button style={btn(false)} onClick={showAll}>Show all</button>
              </div>
              {/* v7.0 item 6 — the long instruction text moved to the Instructions section +
                  first-open modal; only the always-useful keyboard line stays here. */}
              <div style={st.meta}>Shift = straight lines · Del = delete selected · Ctrl+Z = undo · scroll = zoom · space-drag = pan</div>
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
                          onChange={(e) => { pushUndo(); const v = e.target.checked; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, skirtingOnly: v, ...(v ? { insulationRemoval: false } : {}) } : s)); }} /> Skirting only
                      </label>
                      {/* v7.5 item 3 — wall-cavity insulation on THIS line (disabled + false on skirting-only) */}
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                        <input type="checkbox" checked={wallInsulationOn(sel)} disabled={!!sel.skirtingOnly}
                          onChange={(e) => { pushUndo(); const v = e.target.checked; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, insulationRemoval: v } : s)); }} /> Remove insulation from wall cavity
                      </label>
                    </>
                  )}
                  {INSULATION_CATS.has(sel.cat) && (
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
                            <NumField key={sel.id} style={{ ...st.input, flex: 1 }} value={sel.cabH ?? ""}
                              onCommit={(v) => { pushUndo(); setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, cabH: v } : s)); }} />
                          </div>
                        )}
                        {!sel.cabH && <div style={{ ...st.meta, color: "#b7791f" }}>No height set — this shape exports as a hard ERROR (face area cannot price a footprint).</div>}
                      </>
                    );
                  })()}
                  {sel.cat === "condition2" && (
                    <div style={st.row}>
                      <span style={st.meta}>Height override (m):</span>
                      <NumField key={sel.id} allowEmpty style={{ ...st.input, flex: 1 }} placeholder={`Room default (${roomCH(sel.room)})`} value={sel.c2H ?? ""}
                        onCommit={(v) => { pushUndo(); setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, c2H: v } : s)); }} />
                    </div>
                  )}
                  {/* v7.0 item 1 — covering on THIS floor-strip shape (required before export) */}
                  {sel.cat === "floor_strip" && (
                    <>
                      <div style={st.row}>
                        <span style={st.meta}>Floor covering:</span>
                        <select style={{ ...st.selectEl, flex: 1 }} value={sel.floorCov ?? ""}
                          onChange={(e) => { pushUndo(); const v = e.target.value; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, floorCov: v } : s)); }}>
                          <option value="">— select covering —</option>
                          {FLOOR_COVERINGS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                      {!sel.floorCov && <div style={{ ...st.meta, color: "#b7791f" }}>No covering set — this shape exports as a hard ERROR (the strip rate depends on it).</div>}
                    </>
                  )}
                  {/* v7.0 item 9 — optional zone id so a multi-room containment zone exports as
                      ONE consolidated zone instead of a per-room reconstruction downstream */}
                  {sel.cat === "containment" && (
                    <div style={st.row}>
                      <span style={st.meta}>Zone (optional):</span>
                      <input style={{ ...st.input, flex: 1 }} placeholder="e.g. Zone A — kitchen + hall" value={sel.zone ?? ""}
                        onChange={(e) => { pushUndo(); const v = e.target.value; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, zone: v } : s)); }} />
                    </div>
                  )}
                  <div style={st.row}>
                    <select style={{ ...st.selectEl, flex: 1 }} value={sel.room ?? ""}
                      onChange={(e) => { pushUndo(); const v = e.target.value ? Number(e.target.value) : null; setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, room: v } : s)); }}>
                      <option value="">Unassigned</option>
                      {/* Active floor's rooms ONLY. Reassigning a shape to a room on another
                          floor would keep its coordinates in this floor's pixel space while
                          quantifying them at the other floor's scale — silent cross-floor
                          mispricing reached through the UI instead of a missed call site. */}
                      {rooms.filter((r) => (r.floorId ?? activeFloor) === activeFloor).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <button style={btn(false)} onClick={() => { pushUndo(); setShapes((a) => a.filter((s) => s.id !== sel.id)); setSelId(null); }}>Delete</button>
                  </div>
                </div>
              )}
              {/* v7.0 item 8 — selected equipment marker */}
              {selMarker && (() => {
                const kind = markerKindById(selMarker.kind);
                return (
                  <div style={st.selBox}>
                    <div style={{ ...st.meta, display: "flex", alignItems: "center", gap: 6 }}>
                      <img src={kind.icon} alt="" style={{ width: 18, height: 18 }} />
                      Selected marker: {kind.label}
                    </div>
                    {kind.hasHeatMats && (
                      <>
                        <div style={st.row}>
                          <span style={st.meta}>Heat mats (m²):</span>
                          <NumField key={selMarker.id} style={{ ...st.input, flex: 1 }} value={selMarker.heatMatsM2 ?? ""}
                            onCommit={(v) => { pushUndo(); setMarkers((a) => a.map((m) => m.id === selMarker.id ? { ...m, heatMatsM2: v } : m)); }} />
                        </div>
                        {!(parseFloat(selMarker.heatMatsM2) > 0) && <div style={{ ...st.meta, color: "#b7791f" }}>Heat mats m² is required — blank exports a hard ERROR and contributes zero.</div>}
                      </>
                    )}
                    <div style={st.row}>
                      <select style={{ ...st.selectEl, flex: 1 }} value={selMarker.room ?? ""}
                        onChange={(e) => { pushUndo(); const v = e.target.value ? Number(e.target.value) : null; setMarkers((a) => a.map((m) => m.id === selMarker.id ? { ...m, room: v } : m)); }}>
                        <option value="">Unassigned</option>
                        {rooms.filter((r) => (r.floorId ?? activeFloor) === activeFloor).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <button style={btn(false)} onClick={() => { pushUndo(); setMarkers((a) => a.filter((m) => m.id !== selMarker.id)); setSelMarkerId(null); }}>Delete</button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* v7.0 item 6 — the long instructions live here (collapsed by default) + in the
            first-open modal; they no longer squat permanently in the bar */}
        <div style={st.section}>
          {sectionHead("instructions", "Instructions")}
          {!collapsed.instructions && instructionsBody}
        </div>

        <div style={st.section}>
          {sectionHead("property", "4 · Property scope")}
          {!collapsed.property && (
            <>
              {/* v7.0 item 8 — unit counts now come from PLACED MARKERS (section 3); only the
                  job-level ×days inputs remain here. Live totals shown so what will export is
                  visible while placing. */}
              <div style={{ ...st.meta, fontSize: 10.5, marginTop: 2 }}>
                Equipment counts come from markers on the plan (section 3). Days are job-level:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {propNumField(`AFD days (${equipTotals.totals.afd_count} placed)`, "afd_days")}
                {propNumField(`Dehum days (${equipTotals.totals.dehumidifier_count} placed)`, "dehum_days")}
                {propNumField(`Drymatic days (${equipTotals.totals.drymatic_boost_count} placed)`, "drymatic_days")}
                {propNumField("DBKII days", "dbkii_days")}
                {propNumField("Air mover units", "air_mover_units")}
                {propNumField("× days", "air_mover_days")}
                {/* v7.0 item 3 — the entered number must match how PRV is priced: ALL sampled
                    areas, outdoor control included */}
                {propNumField("PRV areas — TOTAL sampled areas incl. the outdoor control (e.g. 6 indoor + 1 outdoor = enter 7)", "prv_areas")}
                {propNumField("AC ducted decontamination", "ac_ducted_units")}
                {propNumField("AC duct removal rooms", "ac_duct_removal_rooms")}
              </div>
              {Object.keys(property).some((k) => k.startsWith("legacy_") && parseFloat(property[k]) > 0) && (
                <div style={{ ...st.warn, fontSize: 11 }}>
                  This job carries pre-v7.0 equipment unit counts ({Object.keys(property).filter((k) => k.startsWith("legacy_") && parseFloat(property[k]) > 0).map((k) => `${k.replace("legacy_", "")}=${property[k]}`).join(", ")}).
                  They export under equipment_legacy with a hard ERROR until you place the equivalent markers / enter drying mats m² — then
                  <button style={{ ...btn(false), marginLeft: 6, padding: "1px 6px", fontSize: 10.5 }}
                    onClick={() => setProperty((p) => { const n = { ...p }; for (const k of Object.keys(n)) if (k.startsWith("legacy_")) delete n[k]; return n; })}>
                    clear legacy counts
                  </button>
                </div>
              )}
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

        {/* v7.0 item 5 — no private scroll trap: the section flows like every other one and the
            whole left bar is one continuous scroll, so nothing needs collapsing to be reached */}
        {/* v7.1 — live checks: identical to export.flags, colour-coded, click to focus */}
        <div style={st.section}>
          {sectionHead("checks", `Checks — ${liveErrors} error${liveErrors === 1 ? "" : "s"}, ${liveFlags.length - liveErrors} flag${liveFlags.length - liveErrors === 1 ? "" : "s"}`)}
          {!collapsed.checks && (
            liveFlags.length === 0
              ? <div style={{ ...st.meta, color: "#2e7d32" }}>No errors or flags — the export will be clean.</div>
              : liveFlags.map((f, i) => (
                <div key={`${f.code}-${i}`} onClick={() => focusFlag(f)} title={`${f.code}${f.room || f.floor ? " — click to focus" : ""}`}
                  style={{ ...st.meta, cursor: f.room || f.floor ? "pointer" : "default", padding: "5px 7px", borderRadius: 5,
                    background: f.severity === "ERROR" ? "#fdecec" : "#fff5dc",
                    borderLeft: `3px solid ${f.severity === "ERROR" ? "#c62828" : "#b7791f"}`, color: "#1b1e24", fontSize: 11 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: f.severity === "ERROR" ? "#c62828" : "#b7791f" }}>{f.severity} · {f.code}</span>
                  <div>{f.message.replace(/^(ERROR|FLAG) — /, "")}</div>
                </div>
              ))
          )}
        </div>

        <div style={st.section}>
          {sectionHead("qty", "5 · Quantities")}
          {!collapsed.qty && (
            <>
              {(() => {
                // Quantities span the WHOLE job (every floor), grouped under each floor's typed
                // label — that is what the quote is built from. Room names repeat across floors,
                // so the React key has to include the floor.
                const rows = roomRows().filter((r) => r.any || !r.isUnassigned);
                const renderRow = (r) => (
                  <div key={`${r.floorId || "none"}-${r.name}`} style={st.qRoom}>
                    <div style={{ fontWeight: 600, color: r.isUnassigned && r.any ? "#b7791f" : "#1b1e24" }}>
                      {r.name}{r.isUnassigned && r.any ? " ⚠" : ""}
                      {r.voidType && (
                        <span style={{ marginLeft: 4, fontSize: 9.5, padding: "1px 4px", borderRadius: 3, background: "#795548", color: "#fff" }}>
                          {r.voidType === "roof_void" ? "ROOF VOID" : "CEILING VOID"}
                        </span>
                      )}
                      {r.chSet
                        ? <span style={st.meta}> CH {r.ch} m</span>
                        : <span style={{ ...st.meta, color: "#b7791f" }}> CH not set — using 2.4 ⚠</span>}
                    </div>
                    {(r.plumbIso || r.elecIso) && (
                      <div style={{ ...st.meta, fontSize: 11 }}>
                        {[r.plumbIso && "Plumbing iso", r.elecIso && "Electrical iso"].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {CATS.map((c) => categoryLines(c, r).map((line, i) => (
                      <div key={`${c.id}-${i}`} style={{ ...st.qLine, color: line.danger ? "#c62828" : undefined, fontSize: line.sub ? 11 : st.qLine.fontSize, opacity: line.sub ? 0.75 : 1 }}>
                        <span style={{ ...st.swatch, background: line.danger ? "#c62828" : c.color }} />
                        <span style={{ flex: 1 }}>{line.label}</span>
                        <span style={st.num}>{line.text}</span>
                      </div>
                    )))}
                  </div>
                );
                if (floors.length <= 1) return rows.map(renderRow);
                const out = [];
                for (const f of floors) {
                  const fr = rows.filter((r) => r.floorId === f.id);
                  if (!fr.length) continue;
                  out.push(
                    <div key={`fh-${f.id}`} style={{ ...st.h, marginTop: 6, color: f.name?.trim() ? "#5b6270" : "#b7791f" }}>
                      {f.name?.trim() || "(UNLABELLED FLOOR ⚠)"}
                    </div>
                  );
                  out.push(...fr.map(renderRow));
                }
                const orphans = rows.filter((r) => !r.floorId);
                if (orphans.length) {
                  out.push(<div key="fh-none" style={{ ...st.h, marginTop: 6, color: "#b7791f" }}>UNASSIGNED</div>);
                  out.push(...orphans.map(renderRow));
                }
                return out;
              })()}
              {anyPropertyEntered && (
                <div style={st.qRoom}>
                  <div style={{ fontWeight: 600 }}>Property-wide</div>
                  {propertyTotals.decon_m2 > 0 && qline(`Roof void / cavity decon (${property.roof_void_mode === "all_surfaces" ? "all surfaces" : "visibly affected"})`, `${fmt(propertyTotals.decon_m2)} m²`, "#795548")}
                  {/* v6.0 — the NETTED figure is what gets priced, so it is what is shown here.
                      Seeing the raw sum instead would hide the very overlap this de-dups. */}
                  {insulationTotals.batts_m2 > 0 && qline(`Insulation removal (batts)${insulationTotals.overlap_netted ? " — netted" : ""}`, `${fmt(insulationTotals.batts_m2)} m²`, "#795548")}
                  {insulationTotals.blown_in_m2 > 0 && qline(`Insulation removal (blown-in)${insulationTotals.overlap_netted ? " — netted" : ""}`, `${fmt(insulationTotals.blown_in_m2)} m²`, "#795548")}
                  {insulationTotals.cross_type_overlap && (
                    <div style={{ ...st.qLine, color: "#c62828" }}>
                      <span style={{ ...st.swatch, background: "#c62828" }} />
                      <span style={{ flex: 1 }}>Batts and blown-in OVERLAP ⚠</span>
                      <span style={st.num}>split unreliable</span>
                    </div>
                  )}
                  {propertyTotals.floorProt > 0 && qline("Floor protection", `${fmt(propertyTotals.floorProt)} m²`, "#9E9E9E")}
                  {/* v7.0 item 8 — totals are DERIVED from placed markers (sum of rooms) */}
                  {equipTotals.totals.afd_count > 0 && qline("AFD (markers)", `${equipTotals.totals.afd_count} × ${property.afd_days || 0} days`)}
                  {equipTotals.totals.dehumidifier_count > 0 && qline("Dehumidifiers (markers)", `${equipTotals.totals.dehumidifier_count} × ${property.dehum_days || 0} days`)}
                  {equipTotals.totals.drymatic_boost_count > 0 && qline("Drymatic boost (markers)", `${equipTotals.totals.drymatic_boost_count} × ${property.drymatic_days || 0} days`)}
                  {(equipTotals.totals.heat_mats_m2 > 0 || equipTotals.heatUnset > 0) && (
                    <div style={{ ...st.qLine, color: equipTotals.heatUnset ? "#c62828" : undefined }}>
                      <span style={{ ...st.swatch, background: equipTotals.heatUnset ? "#c62828" : "#5b6270" }} />
                      <span style={{ flex: 1 }}>Heat mats{equipTotals.heatUnset ? ` — ${equipTotals.heatUnset} marker(s) NOT SET ⚠` : ""}</span>
                      <span style={st.num}>{fmt(equipTotals.totals.heat_mats_m2)} m²</span>
                    </div>
                  )}
                  {equipTotals.totals.split_ac_decon_insitu_count > 0 && qline("Split AC decon in-situ (markers)", equipTotals.totals.split_ac_decon_insitu_count)}
                  {equipTotals.totals.split_ac_decommission_count > 0 && qline("Split AC decommission (markers)", equipTotals.totals.split_ac_decommission_count)}
                  {equipTotals.unassigned > 0 && (
                    <div style={{ ...st.qLine, color: "#c62828" }}>
                      <span style={{ ...st.swatch, background: "#c62828" }} />
                      <span style={{ flex: 1 }}>Markers with NO ROOM ⚠</span>
                      <span style={st.num}>{equipTotals.unassigned}</span>
                    </div>
                  )}
                  {parseFloat(property.air_mover_units) > 0 && qline("Air movers", `${property.air_mover_units} × ${property.air_mover_days || 0} days`)}
                  {parseFloat(property.dbkii_days) > 0 && qline("DBKII", `${property.dbkii_days} days`)}
                  {parseFloat(property.prv_areas) > 0 && qline("PRV areas (incl. outdoor control)", property.prv_areas)}
                  {parseFloat(property.ac_ducted_units) > 0 && qline("AC ducted decontamination", property.ac_ducted_units)}
                  {parseFloat(property.ac_duct_removal_rooms) > 0 && qline("AC duct removal (rooms)", property.ac_duct_removal_rooms)}
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
          {liveFlags.length > 0 && (
            <div style={{ ...st.meta, color: liveErrors ? "#c62828" : "#b7791f", fontSize: 11 }}>
              {liveErrors ? `${liveErrors} ERROR${liveErrors === 1 ? "" : "S"} will export with this job` : `${liveFlags.length} flag${liveFlags.length === 1 ? "" : "s"} will export with this job`} — see Checks above.
            </div>
          )}
          <button style={{ ...btn(false), background: "#2f6df6", borderColor: "#2f6df6", color: "#fff" }}
            onClick={fresh("exportQuantities")} disabled={!floors.some((f) => f.scale) || !shapes.length}
            title={!floors.some((f) => f.scale) ? "Calibrate at least one floor first" : !shapes.length ? "Nothing marked up yet" : "Download the quantities JSON"}>
            Download quantities JSON
          </button>
          {/* v6.0 — one image per floor; exports the floor currently on screen */}
          <button style={btn(false)} onClick={fresh("exportScopeImage")}
            disabled={!img || !shapes.some((s) => (s.floorId ?? activeFloor) === activeFloor)}
            title="Renders this floor's plan with every shape and a key, for a quote figure or ops handoff">
            Export scope image (PNG){floors.length > 1 && activeFloorRec?.name?.trim() ? ` — ${activeFloorRec.name.trim()}` : ""}
          </button>
          {/* v7.0 item 2 — one image per overlay + the combined; single-layer images don't
              blend where fills overlap, and each legend matches exactly what its image shows */}
          <button style={btn(false)} onClick={fresh("exportScopeImagesPerOverlay")}
            disabled={!img || (!shapes.some((s) => (s.floorId ?? activeFloor) === activeFloor) && !markers.some((m) => (m.floorId ?? activeFloor) === activeFloor))}
            title="Downloads one PNG per overlay used on this floor (own shapes + own legend), plus the combined image">
            Export scope images (per overlay)
          </button>
          <div style={st.row}>
            <button style={{ ...btn(false), flex: 1 }} onClick={fresh("exportProject")} disabled={!shapes.length && !rooms.length}>
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
              {/* only the ACTIVE floor's shapes — coordinates are in that floor's plan pixel space */}
              {shapes.filter((s) => (s.floorId ?? activeFloor) === activeFloor && !hiddenCats.has(s.cat) && !hiddenRooms.has(s.room)).map((s) => {
                const c = catById(s.cat);
                const isSel = s.id === selId;
                const dim = isolate && activeRoom != null && s.room !== activeRoom;   // v7.1 isolate (cosmetic)
                return (
                  <g key={s.id} opacity={dim ? 0.15 : 1}>
                    {s.type === "rect" ? (
                      <rect x={s.x} y={s.y} width={s.w} height={s.h}
                        fill={c.color} fillOpacity={FILL_OPACITY}
                        stroke={c.color} strokeWidth={(isSel ? 2.5 : 1.2) / zoom} />
                    ) : (
                      <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                        stroke={c.color} strokeWidth={(isSel ? 5 : 3.5) / zoom} strokeLinecap="round"
                        strokeDasharray={s.skirtingOnly ? `${6 / zoom} ${4 / zoom}` : undefined} />
                    )}
                    {/* v7.5 item 3 — wall strip + cavity insulation: dashed white inner stroke */}
                    {s.type === "line" && wallInsulationOn(s) && (
                      <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#fff" strokeWidth={1.3 / zoom}
                        strokeDasharray={`${4 / zoom} ${3 / zoom}`} style={{ pointerEvents: "none" }} />
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
              {/* v7.0 item 8 — equipment markers: FIXED SCREEN SIZE (÷zoom), white disc behind
                  so they stay readable over any fill colour, ring when selected */}
              {markers.filter((m) => (m.floorId ?? activeFloor) === activeFloor && !hiddenRooms.has(m.room)).map((m) => {
                const kind = markerKindById(m.kind); if (!kind) return null;
                const ms = markerSizePx(m);
                const isSel = m.id === selMarkerId;
                const dim = isolate && activeRoom != null && m.room !== activeRoom;
                const mRoom = rooms.find((r) => r.id === m.room);
                return (
                  <g key={`mk-${m.id}`} opacity={dim ? 0.15 : 1}>
                    <title>{kind.label}{mRoom ? ` — ${mRoom.name}` : " — NO ROOM ⚠"}{kind.hasHeatMats ? ` · heat mats ${parseFloat(m.heatMatsM2) > 0 ? m.heatMatsM2 + " m²" : "NOT SET"}` : ""}</title>
                    <circle cx={m.x} cy={m.y} r={ms / 2 + 2 / zoom} fill="#fff" fillOpacity={0.72} stroke={isSel ? "#2f6df6" : "#333"} strokeWidth={(isSel ? 2.5 : 1) / zoom} />
                    <image href={kind.icon} x={m.x - ms / 2} y={m.y - ms / 2} width={ms} height={ms} style={{ pointerEvents: "none" }} />
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
          <div style={{ ...st.zoomBadge, display: "flex", gap: 6, alignItems: "center", padding: "4px 6px" }}>
            <button style={{ ...btn(false), padding: "2px 8px" }} onClick={() => zoomAbout(zoom / 1.25)} title="Zoom out">−</button>
            <span style={{ minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button style={{ ...btn(false), padding: "2px 8px" }} onClick={() => zoomAbout(zoom * 1.25)} title="Zoom in">+</button>
            <button style={{ ...btn(false), padding: "2px 8px" }} onClick={() => fitView(img.w, img.h)} title="Fit the whole plan">Fit</button>
            <button style={{ ...btn(false), padding: "2px 8px" }} onClick={() => zoomAbout(1)} title="Actual plan pixels">100%</button>
          </div>
        )}
      </div>
      {modals}
    </div>
  );
}

// ---------- styles ----------
const st = {
  app: { display: "flex", height: "100vh", background: "#f4f6f8", color: "#1b1e24", fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13 },
  panel: { width: 340, minWidth: 340, display: "flex", flexDirection: "column", gap: 10, padding: 12, background: "#ffffff", borderRight: "1px solid #d9dde3", overflow: "auto" },
  brand: { fontSize: 11, letterSpacing: "0.18em", color: "#5b6270", fontWeight: 700 },
  section: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid #d9dde3" },
  h: { fontSize: 11, letterSpacing: "0.12em", color: "#5b6270", fontWeight: 700 },
  // v7.1 — fields sit LIGHTER than the panel with a visible border; focus ring comes from
  // GLOBAL_CSS. (v7.0 fields were #f4f6f8 on #ffffff with a #d9dde3 border: near-invisible.)
  input: { background: "#ffffff", border: "1px solid #b8bfca", color: "#1b1e24", borderRadius: 6, padding: "7px 9px", fontSize: 13 },
  selectEl: { background: "#ffffff", border: "1px solid #b8bfca", color: "#1b1e24", borderRadius: 6, padding: "6px", fontSize: 13 },
  row: { display: "flex", gap: 6, alignItems: "center" },
  meta: { fontSize: 11.5, color: "#5b6270", lineHeight: 1.45 },
  warn: { fontSize: 12, color: "#b7791f", background: "#fff5dc", border: "1px solid #e5c97a", borderRadius: 6, padding: "8px 10px" },
  drop: { border: "1.5px dashed #b8bfca", borderRadius: 8, padding: "22px 12px", textAlign: "center", color: "#5b6270", cursor: "pointer", fontSize: 12.5 },
  chips: { display: "flex", flexWrap: "wrap", gap: 5 },
  swatch: { width: 12, height: 12, borderRadius: 2, display: "inline-block", flexShrink: 0 },
  roomRow: { display: "flex", gap: 6, alignItems: "center", background: "#f4f6f8", border: "1px solid #d9dde3", borderRadius: 6, padding: "6px 8px", cursor: "pointer" },
  chInput: { width: 40, background: "#ffffff", border: "1px solid #b8bfca", color: "#1b1e24", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "right" },
  selBox: { background: "#f4f6f8", border: "1px solid #d9dde3", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 },
  qRoom: { display: "flex", flexDirection: "column", gap: 3, padding: "6px 0" },
  qLine: { display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 },
  num: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 },
  canvasWrap: { flex: 1, position: "relative", overflow: "hidden", background: "#101216", touchAction: "none", cursor: "crosshair" },
  empty: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#4a4f59", fontSize: 15 },
  zoomBadge: { position: "absolute", bottom: 10, right: 12, background: "#ffffffe6", border: "1px solid #d9dde3", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, color: "#5b6270" },
  overlay: { position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 },
  modal: { width: "min(680px, 92vw)", background: "#ffffff", border: "1px solid #d9dde3", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8 },
  ta: { width: "100%", height: 220, background: "#f4f6f8", border: "1px solid #b8bfca", color: "#1b1e24", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace", resize: "vertical", boxSizing: "border-box" },
};
// v7.1 — one global rule set instead of per-input handlers: a visible focus ring on every
// field and legible placeholders. Injected once via <style> inside `modals`.
const GLOBAL_CSS = `
  input:focus, select:focus, textarea:focus { outline: none !important; border-color: #6ea8fe !important; box-shadow: 0 0 0 2px rgba(110,168,254,.28); }
  input::placeholder, textarea::placeholder { color: #7a8390; opacity: 1; }
  input[type=checkbox] { accent-color: #2f6df6; width: 14px; height: 14px; }
`;
const btn = (active) => ({
  background: active ? "#2f6df6" : "#f4f6f8", color: active ? "#fff" : "#1b1e24",
  border: `1px solid ${active ? "#2f6df6" : "#d9dde3"}`, borderRadius: 6,
  padding: "7px 10px", fontSize: 12.5, cursor: "pointer",
});
const chip = (c, active) => ({
  display: "flex", alignItems: "center", gap: 6,
  background: active ? "#e6eefc" : "#f4f6f8", color: "#1b1e24",
  border: `1px solid ${active ? c.color : "#d9dde3"}`, borderRadius: 6,
  padding: "6px 8px", fontSize: 12, cursor: "pointer",
});
