import React, { useState, useRef, useEffect, useCallback } from "react";
import { listJobs, getJob, putJob, deleteJob as dbDeleteJob, getImageBlob, putImageBlob, dataURLToBlob, blobToDataURL } from "./db.js";

// ---------- BML markup convention (v3.1 — mirrors bml-floorplan-quantify-quote) ----------
// "Full strip" removed (v3.1): Jordan overlays floor_strip + ceiling_strip separately instead.
const CATS = [
  { id: "floor_strip",   label: "Strip floor coverings + remediate subfloor surface",              kind: "fill", color: "#FF00FF" },
  { id: "ceiling_strip", label: "Strip ceiling linings + remediate cavity surfaces then contain",   kind: "fill", color: "#FFFF00" },
  { id: "condition2",    label: "Condition 2 clean all surfaces",                                   kind: "fill", color: "#00B0F0" },
  { id: "cabinetry",     label: "Cabinetry strip",                                                   kind: "fill", color: "#6600FF" },
  { id: "contingent",    label: "Contingent (provisional)",                                          kind: "fill", color: "#FF9900" },
  { id: "wall_strip",    label: "Wall strip",                                                        kind: "line", color: "#EE0000" },
  { id: "containment",   label: "Containment set-up",                                                kind: "line", color: "#4EA72E" },
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

const APP_VERSION = "v3.1";
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
  const [rooms, setRooms] = useState([]); // {id, name, ch}
  const [activeRoom, setActiveRoom] = useState(null);
  // tools
  const [tool, setTool] = useState("select");
  const [activeCat, setActiveCat] = useState("floor_strip");
  const [wallHgt, setWallHgt] = useState("full"); // default removal height for NEW wall_strip lines
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
        id: jobId, name: jobName, rooms, shapes, calLine, scale,
        imgW: imgW ?? img?.w ?? 0, imgH: imgH ?? img?.h ?? 0,
        savedAt: new Date().toISOString(),
      };
      await putJob(meta);
      const entry = { id: jobId, name: jobName || "Unnamed job", savedAt: meta.savedAt };
      setIndex((prev) => [entry, ...prev.filter((j) => j.id !== jobId)]);
      setSaveState("saved");
    } catch { setSaveState("error"); }
  }, [storageOk, jobId, jobName, rooms, shapes, calLine, scale, img]);

  // autosave (debounced) on any markup change
  useEffect(() => {
    if (view !== "editor" || !storageOk || !loadedRef.current || !jobId) return;
    setSaveState("dirty");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistMeta(), 1200);
    return () => clearTimeout(saveTimer.current);
  }, [shapes, rooms, jobName, scale, calLine]); // eslint-disable-line

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
      const hit = [...shapes].reverse().find((s) => hitShape(s, pt));
      if (hit) { setSelId(hit.id); pushUndo(); drag.current = { mode: "move", id: hit.id, sx: pt.x, sy: pt.y, orig: { ...hit } }; }
      else setSelId(null);
      return;
    }
    if (tool === "draw") {
      const cat = catById(activeCat);
      pushUndo();
      const s = cat.kind === "fill"
        ? { id: nid(), type: "rect", cat: cat.id, room: activeRoom, x: pt.x, y: pt.y, w: 0, h: 0 }
        : { id: nid(), type: "line", cat: cat.id, room: activeRoom, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
            ...(cat.id === "wall_strip" ? { hgt: wallHgt } : {}) };
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
  const roomCH = (roomId) => rooms.find((r) => r.id === roomId)?.ch ?? 2.4;
  const wallEffHeight = (s) => (s.hgt === "full" || s.hgt == null ? roomCH(s.room) : s.hgt);
  const lenOf = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * scale; // raw line length in m (wall_strip linm tracking)
  // Primary priced quantity per shape. Rects: footprint m² (condition2 = full zone surface,
  // no netting of stripped areas — v3.1). Lines: wall_strip m² via its own removal height;
  // containment is counted, not measured (handled in roomRows).
  const qtyOf = (s) => {
    if (!scale) return null;
    if (s.type === "rect") {
      const area = s.w * s.h * scale * scale;
      if (s.cat === "condition2") {
        const Lm = s.w * scale, Wm = s.h * scale, ch = roomCH(s.room);
        return 2 * area + 2 * (Lm + Wm) * ch; // floor + ceiling + walls of the drawn zone
      }
      return area;
    }
    const len = lenOf(s);
    if (s.cat === "wall_strip") return len * wallEffHeight(s);
    return len;
  };
  const shapeLabel = (s) => {
    if (!scale) return "no scale";
    if (s.cat === "containment") return "containment";
    const q = qtyOf(s);
    if (s.type === "rect") {
      const L = s.w * scale, W = s.h * scale;
      return `${fmt(L)}×${fmt(W)} m = ${fmt(q)} m²`;
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
      const rs = shapes.filter((s) => (s.room ?? null) === rid);
      if (!room && rs.length === 0) return null;
      const row = { name: room ? room.name : "Unassigned", ch: room ? room.ch : 2.4, isUnassigned: !room, counts: {}, wallLinm: 0, any: rs.length > 0 };
      for (const c of CATS) {
        const cs = rs.filter((s) => s.cat === c.id);
        if (c.id === "containment") { row.counts[c.id] = cs.length; continue; }
        if (c.id === "wall_strip") {
          row.counts[c.id] = cs.reduce((a, s) => a + (qtyOf(s) || 0), 0); // m² (per-shape height)
          row.wallLinm = cs.reduce((a, s) => a + (lenOf(s) || 0), 0);     // lm (informational)
          continue;
        }
        row.counts[c.id] = cs.reduce((a, s) => a + (qtyOf(s) || 0), 0);
      }
      return row;
    }).filter(Boolean);
  };
  // Per-category display lines for the quantities panel — floor/ceiling strip each
  // produce two labelled outputs from the same underlying figure (strip + matching decon).
  const categoryLines = (c, row) => {
    if (c.id === "containment") {
      const v = row.counts.containment;
      return v ? [{ label: "Containment set-up", text: `${v} ×` }] : [];
    }
    if (c.id === "wall_strip") {
      const lm = row.wallLinm, m2 = row.counts.wall_strip;
      return lm ? [{ label: "Wall strip", text: `${fmt(lm)} lm → ${fmt(m2)} m²` }] : [];
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
    if (c.id === "cabinetry") return [{ label: "Cabinetry strip", text: `${fmt(v)} m²` }];
    if (c.id === "condition2") return [{ label: "Condition 2 clean (all surfaces)", text: `${fmt(v)} m²` }];
    if (c.id === "contingent") return [{ label: "Contingent (provisional)", text: `${fmt(v)} m²` }];
    return [{ label: c.label, text: `${fmt(v)} m²` }];
  };

  // ---------- export (real downloads — self-hosted, no sandbox; copy/paste modal kept for Cowork paste-in) ----------
  const round2 = (v) => Math.round(v * 100) / 100;
  const buildExport = () => ({
    job: jobName || "UNNAMED JOB",
    exported_at: new Date().toISOString(),
    source: `bml-floorplan-markup ${APP_VERSION}`,
    calibration: scale ? { scale_m_per_px: scale, reference_px: calPx, reference_m: calPx * scale } : null,
    markup_convention: "BML v3.1 (bml-floorplan-quantify-quote)",
    condition2_model: "condition2_m2 = the full computed surface (floor + ceiling + walls) of every drawn C2 zone, with NO netting of stripped/cavity areas — the drawn zone(s) set the remediation-zone extent for that room (can be part of a room). The engine must use this figure directly (affected_zone basis) and must not derive or net Condition 2 itself. 'Full strip' no longer exists as a category — floor_strip and ceiling_strip are drawn as separate overlays.",
    rooms: roomRows().filter((r) => !r.isUnassigned || r.any).map((r) => ({
      name: r.name, ceiling_height: r.ch,
      strip_room: (r.counts.floor_strip > 0 || r.counts.ceiling_strip > 0 || r.counts.wall_strip > 0),
      full_strip_m2: 0, floor_strip_m2: round2(r.counts.floor_strip),
      ceiling_strip_m2: round2(r.counts.ceiling_strip), condition2_m2: round2(r.counts.condition2),
      cabinetry_m2: round2(r.counts.cabinetry), contingent_m2: round2(r.counts.contingent),
      wall_strip_linm: round2(r.wallLinm), wall_strip_m2: round2(r.counts.wall_strip),
      containment_count: r.counts.containment,
    })),
    flags: [
      ...(shapes.some((s) => s.room == null) ? ["UNASSIGNED shapes present — reassign before pricing"] : []),
      ...(!scale ? ["NOT CALIBRATED — quantities invalid"] : []),
    ],
  });

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
      format: "bml-markup-project", version: 2, image_embedded: false,
      savedAt: new Date().toISOString(),
      imgW: img?.w || 0, imgH: img?.h || 0,
      jobName, rooms, shapes, calLine, scale,
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
    const r = { id: nid(), name: n, ch: 2.4 };
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
          <div style={st.h}>1 · Calibrate</div>
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
        </div>

        <div style={st.section}>
          <div style={st.h}>2 · Rooms</div>
          <div style={st.row}>
            <input style={{ ...st.input, flex: 1 }} placeholder="Add room…" value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRoom()} />
            <button style={btn(false)} onClick={addRoom}>Add</button>
          </div>
          {rooms.map((r) => (
            <div key={r.id} style={{ ...st.roomRow, outline: activeRoom === r.id ? "1px solid #6ea8fe" : "none" }}
              onClick={() => setActiveRoom(r.id)}>
              <span style={{ flex: 1 }}>{r.name}</span>
              <span style={st.meta}>CH</span>
              <input style={st.chInput} value={r.ch}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRooms((a) => a.map((x) => x.id === r.id ? { ...x, ch: parseFloat(e.target.value) || 0 } : x))} />
              <span style={st.meta}>m</span>
            </div>
          ))}
          <div style={st.meta}>Active room is tagged onto every new shape.</div>
        </div>

        <div style={st.section}>
          <div style={st.h}>3 · Mark up scope</div>
          <div style={st.chips}>
            {CATS.map((c) => (
              <button key={c.id} style={chip(c, tool === "draw" && activeCat === c.id)}
                onClick={() => { setActiveCat(c.id); setTool("draw"); }} disabled={!img}>
                <span style={{ ...st.swatch, background: c.color, opacity: c.kind === "fill" ? 0.8 : 1, height: c.kind === "line" ? 3 : 12 }} />
                {c.label}
              </button>
            ))}
          </div>
          {activeCat === "wall_strip" && (
            <div style={st.row}>
              <span style={st.meta}>New wall height:</span>
              <select style={{ ...st.selectEl, flex: 1 }} value={String(wallHgt)}
                onChange={(e) => setWallHgt(e.target.value === "full" ? "full" : parseFloat(e.target.value))}>
                {HEIGHTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </div>
          )}
          <div style={st.row}>
            <button style={btn(tool === "select")} onClick={() => setTool("select")}>Select / edit</button>
            <button style={btn(tool === "pan")} onClick={() => setTool("pan")}>Pan</button>
          </div>
          <div style={st.meta}>Shift = straight lines · Del = delete selected · Ctrl+Z = undo · scroll = zoom · space-drag = pan</div>
          <div style={st.meta}>Blue C2 = draw the remediation zone (part-room is fine). Total = floor + ceiling + walls of the zone — no automatic netting of stripped areas. Spot cuts: draw the ACTUAL cutout area (incl. your strip-past-contamination allowance) — quantities price what you draw.</div>
          {sel && (
            <div style={st.selBox}>
              <div style={st.meta}>Selected: {catById(sel.cat).label} — {shapeLabel(sel)}</div>
              {sel.cat === "wall_strip" && (
                <div style={st.row}>
                  <span style={st.meta}>Height:</span>
                  <select style={{ ...st.selectEl, flex: 1 }} value={String(sel.hgt ?? "full")}
                    onChange={(e) => { pushUndo(); const v = e.target.value === "full" ? "full" : parseFloat(e.target.value); setShapes((a) => a.map((s) => s.id === sel.id ? { ...s, hgt: v } : s)); }}>
                    {HEIGHTS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
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
        </div>

        <div style={{ ...st.section, flex: 1, overflow: "auto" }}>
          <div style={st.h}>4 · Quantities</div>
          {roomRows().map((r) => r.any || !r.isUnassigned ? (
            <div key={r.name} style={st.qRoom}>
              <div style={{ fontWeight: 600, color: r.isUnassigned && r.any ? "#e8b34b" : "#e8e6e1" }}>
                {r.name}{r.isUnassigned && r.any ? " ⚠" : ""} <span style={st.meta}>CH {r.ch} m</span>
              </div>
              {CATS.map((c) => categoryLines(c, r).map((line, i) => (
                <div key={`${c.id}-${i}`} style={st.qLine}>
                  <span style={{ ...st.swatch, background: c.color }} />
                  <span style={{ flex: 1 }}>{line.label}</span>
                  <span style={st.num}>{line.text}</span>
                </div>
              )))}
            </div>
          ) : null)}
          {shapes.length === 0 && <div style={st.meta}>Nothing marked up yet.</div>}
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
              {shapes.map((s) => {
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
                        stroke={c.color} strokeWidth={(isSel ? 5 : 3.5) / zoom} strokeLinecap="round" />
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
