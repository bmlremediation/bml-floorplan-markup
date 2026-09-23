// Synthetic PROJECT-file builder for tests. Invented geometry only — no job data ever enters this
// public repo. Scale is 0.01 m/px (1 px = 1 cm) so every dimension below is typed in metres.
export const SCALE = 0.01;
const px = (m) => Math.round(m / SCALE * 1000) / 1000;

export function project({ jobName = "TEST — synthetic", property = {}, floorName = "G", scale = SCALE, version = 7 } = {}) {
  let id = 1;
  const p = {
    format: "bml-markup-project", version, image_embedded: false,
    savedAt: "2026-09-23T00:00:00.000Z", imgW: 2000, imgH: 1500,
    jobName, rooms: [], shapes: [], markers: [], property: { ...property },
    floors: [{ id: "f1", name: floorName, calLine: { x1: 0, y1: 0, x2: 100, y2: 0 }, scale, imgW: 2000, imgH: 1500 }],
    activeFloor: "f1",
  };
  const api = {
    p,
    room(name, ch = "2.4", extra = {}) {
      const r = { id: id++, name, ch, plumbIso: false, elecIso: false, floorId: "f1", void_type: null, ...extra };
      p.rooms.push(r); return r.id;
    },
    rect(cat, room, x, y, w, h, extra = {}) {
      const s = { id: id++, type: "rect", cat, room, floorId: "f1", x: px(x), y: px(y), w: px(w), h: px(h), ...extra };
      p.shapes.push(s); return s;
    },
    line(cat, room, x1, y1, x2, y2, extra = {}) {
      const s = { id: id++, type: "line", cat, room, floorId: "f1", x1: px(x1), y1: px(y1), x2: px(x2), y2: px(y2),
                  ...(cat === "wall_strip" ? { hgt: "full", cornice: false, skirting: false, skirtingOnly: false } : {}), ...extra };
      p.shapes.push(s); return s;
    },
  };
  return api;
}
