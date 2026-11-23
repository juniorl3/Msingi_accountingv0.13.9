import { useEffect, useRef, useState } from "react";
import { allowsDecimal, canApply, pressKey } from "./keypadLogic";
import type { KeypadKey, KeypadKind } from "./keypadLogic";

/** Touch keypad dialog, also usable with a physical keyboard (digits, Backspace, Enter, Esc). Used for quantities, prices, cash, PINs and discounts. */
export default function NumPad({ title, subtitle, kind, initial = "", masked = false, error, busy = false, applyLabel = "Apply", onApply, onCancel }: {
  title: string; subtitle?: string; kind: KeypadKind; initial?: string; masked?: boolean; error?: string; busy?: boolean; applyLabel?: string; onApply: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial), [fresh, setFresh] = useState(true), root = useRef<HTMLElement>(null);
  useEffect(() => { root.current?.focus(); }, []);
  const press = (k: KeypadKey) => { setValue(v => pressKey(v, k, kind, fresh)); setFresh(false); };
  const ok = canApply(value, kind) && !busy;
  const apply = () => { if (ok) onApply(value); };
  function onKey(e: React.KeyboardEvent) {
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key as KeypadKey); }
    else if (e.key === "." || e.key === ",") { e.preventDefault(); press("."); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    else if (e.key === "Delete") { e.preventDefault(); press("clear"); }
    else if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }
  const keys: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  const shown = masked ? "•".repeat(value.length) : value;
  return <div className="touch-keypad-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <section ref={root} tabIndex={-1} onKeyDown={onKey} className="touch-keypad" role="dialog" aria-modal="true" aria-label={title} style={{ outline: "none" }}>
      <div className="touch-keypad-head"><b>{title}</b>{subtitle && <small style={{ color: "#8995a3" }}>{subtitle}</small>}<output aria-live="polite">{shown || (masked ? "" : "0")}</output>{error && <small role="alert" style={{ color: "#d66c5e", fontWeight: 600 }}>{error}</small>}</div>
      <div className="touch-keypad-grid">{keys.map(key => key === "." && !allowsDecimal(kind) ? <span key={key} aria-hidden="true" /> : <button key={key} type="button" aria-label={key === "back" ? "Backspace" : undefined} onClick={() => press(key)}>{key === "back" ? "⌫" : key}</button>)}</div>
      <div className="touch-keypad-actions"><button type="button" className="secondary" onClick={() => press("clear")}>Clear</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" className="primary" disabled={!ok} onClick={apply}>{busy ? "…" : applyLabel}</button></div>
    </section></div>;
}
