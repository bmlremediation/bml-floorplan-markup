import React, { useState, useRef, useEffect } from "react";
import { COMMIT_MS, pendingNumFields as pending, isValidNumText } from "./numText.js";

// ---------- v7.5 item 1 (CO-2026-09-22-MARKUP) — numeric boxes save AS TYPED ----------
// A value on screen that is not in state is the worst kind of error: it looks right, and the
// export silently carries the old number. So every numeric box in the left bar:
//   * commits each VALID keystroke to app state through a short debounce (COMMIT_MS);
//   * commits IMMEDIATELY on Enter, Tab, blur and unmount, and whenever flushNumFields() runs —
//     which every export / save / room switch / floor switch / page-leave calls first;
//   * NEVER commits an invalid intermediate ("", "-", ".", "1.", text). State keeps the last
//     valid value, and on blur the box is visibly restored to it. A typed 0 is valid and IS
//     committed — a human-entered zero is meaningful downstream.
// Values stay raw strings in state (the long-standing decimal-entry convention); consumers
// parseFloat them exactly as before. Commits go through the caller's own setter, so they reach
// the SAME autosave path as any other edit.
export default function NumField({ value, onCommit, allowEmpty = false, inputMode = "decimal", ...rest }) {
  const ext = value == null ? "" : String(value);
  const [draft, setDraft] = useState(ext);
  const lastValid = useRef(ext);      // what state holds (or is about to hold)
  const queued = useRef(null);        // valid text waiting on the debounce
  const timer = useRef(null);
  const focused = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const self = useRef({}).current;

  // An external change (undo, import, another shape selected) resets the box — but never
  // while the operator is mid-edit in it.
  useEffect(() => {
    lastValid.current = ext;
    if (!focused.current && queued.current == null) setDraft(ext);
  }, [ext]);

  const flush = () => {
    clearTimeout(timer.current); timer.current = null;
    pending.delete(self);
    const t = queued.current; queued.current = null;
    if (t != null && t !== lastValid.current) { lastValid.current = t; onCommitRef.current(t); }
  };
  useEffect(() => () => flush(), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (e) => {
    const v = e.target.value;
    setDraft(v);
    if (!isValidNumText(v, allowEmpty)) return;          // keep the last valid value in state
    queued.current = v.trim();
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, COMMIT_MS);
    pending.set(self, flush);
  };
  const onBlur = () => {
    focused.current = false;
    flush();
    if (!isValidNumText(draft, allowEmpty)) setDraft(lastValid.current);   // visibly restore
  };
  const onKeyDown = (e) => { if (e.key === "Enter" || e.key === "Tab") flush(); };

  return (
    <input {...rest} data-numfield="" inputMode={inputMode} value={draft}
      onFocus={() => { focused.current = true; }} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown} />
  );
}
