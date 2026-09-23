// v7.5 item 1 — shared by NumField.jsx and the tests (no React here).
export const COMMIT_MS = 120;   // debounce between the last valid keystroke and the state commit (CO: ≤150 ms)

// Every NumField with an uncommitted edit registers its flush() here.
export const pendingNumFields = new Map();
export function flushNumFields() { for (const flush of [...pendingNumFields.values()]) flush(); }

// "1.5", "0", ".5", "-2" are numbers; "", "-", ".", "1.", "1e", "abc" are not (yet).
export function isValidNumText(t, allowEmpty = false) {
  const s = String(t ?? "").trim();
  if (s === "") return allowEmpty;
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(s) && Number.isFinite(Number(s));
}
