// Structural JSON diff: prints every path whose value differs / is added / removed.
export function diff(a, b, path = "", out = []) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) out.push({ op: "added", path: `${path}[${i}]`, b: b[i] });
      else if (i >= b.length) out.push({ op: "removed", path: `${path}[${i}]`, a: a[i] });
      else diff(a[i], b[i], `${path}[${i}]`, out);
    }
  } else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in b)) out.push({ op: "removed", path: p, a: a[k] });
      else if (!(k in a)) out.push({ op: "added", path: p, b: b[k] });
      else diff(a[k], b[k], p, out);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ op: "changed", path, a, b });
  return out;
}
