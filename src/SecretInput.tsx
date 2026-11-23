import { useState } from "react";
import NumPad from "./NumPad";

/** A password / PIN field with Show, and an optional on-screen keypad for PINs on touch screens. */
export default function SecretInput({ label, value, onChange, onEnter, autoFocus = false, keypad = true }: { label: string; value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean; keypad?: boolean }) {
  const [show, setShow] = useState(false), [pad, setPad] = useState(false);
  return <>
    <label>{label}
      <div className="field-row">
        <input type={show ? "text" : "password"} value={value} autoFocus={autoFocus} autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }} />
        <button type="button" className="secondary" onClick={() => setShow(s => !s)}>{show ? "Hide" : "Show"}</button>
        {keypad && <button type="button" className="secondary" onClick={() => setPad(true)} aria-label="Enter a PIN with the keypad">123</button>}
      </div></label>
    {pad && <NumPad title="Enter your PIN" kind="pin" masked applyLabel="Use PIN" onCancel={() => setPad(false)} onApply={v => { onChange(v); setPad(false); }} />}
  </>;
}
