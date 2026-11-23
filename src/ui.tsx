import { X } from "lucide-react";

export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Modal({ eyebrow, title, onClose, children, wide }: { eyebrow: string; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={"modal" + (wide ? " journal-form-modal" : "")}>
      <div className="modal-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div>
      {children}
    </section></div>;
}

/** An in-app "are you sure?" window. (Browser pop-ups such as window.confirm are not reliable inside a desktop app window.) */
export function Confirm({ title, message, yes = "Yes, continue", onYes, onNo }: { title: string; message: string; yes?: string; onYes: () => void; onNo: () => void }) {
  return <Modal eyebrow="PLEASE CONFIRM" title={title} onClose={onNo}>
    <p style={{ fontSize: 13, color: "#59697a", lineHeight: 1.5, margin: "16px 0 0" }}>{message}</p>
    <div style={{ display: "flex", gap: 10, marginTop: 20 }}><button type="button" className="primary" onClick={onYes}>{yes}</button><button type="button" className="secondary" onClick={onNo}>Cancel</button></div>
  </Modal>;
}

const cell = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
export function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
export function downloadText(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

let audio: AudioContext | null = null;
/** A short tone for a scanner: high for "added", low for "not found". Silent if the system blocks sound. */
export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio ??= new Ctx();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
  } catch { /* no sound available */ }
}
