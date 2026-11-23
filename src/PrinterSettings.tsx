import { useEffect, useState } from "react";
import { checkPrinter, kickDrawer, listPrintQueues, printTestPage } from "./printerApi";
import { getPrinterStatus, onPrinterStatus, RECHECK_MS, setPrinterStatus } from "./printerManager";
import type { PrinterStatus } from "./printerManager";
import type { PrinterPrefs, PrintMode } from "./receiptDb";
import type { DrawerRule } from "./escpos";
import { msg } from "./ui";

/** Receipt printer and cash drawer settings for this computer. */
export default function PrinterSettings({ prefs, onChange, onNotice }: { prefs: PrinterPrefs; onChange: (p: PrinterPrefs) => void; onNotice: (m: string) => void }) {
  const [queues, setQueues] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const raw = prefs.mode !== "system";
  const [status, setStatus] = useState<PrinterStatus | null>(getPrinterStatus), [checking, setChecking] = useState(false);
  useEffect(() => onPrinterStatus(setStatus), []);
  async function check() { setChecking(true); try { await checkPrinter(prefs); } finally { setChecking(false); } }
  // Check when the printer setup changes, then every 30 seconds while this screen is open.
  const key = `${prefs.mode}|${prefs.host}|${prefs.port}|${prefs.queue}`;
  useEffect(() => {
    if (!raw) return;
    const snapshot = prefs; let alive = true;
    setPrinterStatus(null); // forget the old printer's result
    const run = () => { if (alive) void checkPrinter(snapshot); };
    const first = window.setTimeout(run, 600), again = window.setInterval(run, RECHECK_MS);
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(again); };
  }, [key]);
  async function refresh() { try { setQueues(await listPrintQueues()); } catch (e) { onNotice(msg(e)); } }
  useEffect(() => { if (prefs.mode === "queue") void refresh(); }, [prefs.mode]);
  async function run(label: string, job: () => Promise<void>) { setBusy(true); try { await job(); onNotice(`${label} sent.`); } catch (e) { onNotice(msg(e)); } setBusy(false); }
  return <div style={{ display: "grid", gap: 10, padding: "10px 0", borderTop: "1px solid #f0f2f5" }}>
    <b style={{ fontSize: 12 }}>Receipt printer and cash drawer (this computer)</b>
    <label>Print method<select value={prefs.mode} onChange={e => onChange({ ...prefs, mode: e.target.value as PrintMode })}>
      <option value="system">System print dialog (any printer)</option><option value="network">Network receipt printer (ESC/POS, direct)</option><option value="queue">USB receipt printer through a print queue (ESC/POS)</option></select></label>
    {prefs.mode === "network" && <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
      <label>Printer IP address<input value={prefs.host} onChange={e => onChange({ ...prefs, host: e.target.value })} placeholder="e.g. 192.168.1.50" /></label>
      <label>Port<input inputMode="numeric" value={prefs.port} onChange={e => onChange({ ...prefs, port: Number(e.target.value.replace(/\D/g, "")) || 9100 })} /></label></div>}
    {prefs.mode === "queue" && <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
      <label style={{ flex: 1 }}>Print queue<select value={prefs.queue} onChange={e => onChange({ ...prefs, queue: e.target.value })}><option value="">Choose the receipt printer</option>{queues.map(q => <option key={q} value={q}>{q}</option>)}{prefs.queue && !queues.includes(prefs.queue) && <option value={prefs.queue}>{prefs.queue}</option>}</select></label>
      <button type="button" className="secondary" onClick={refresh}>Refresh</button></div>}
    {raw && <div role="status" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: checking ? "#b8c2cc" : status?.state === "ok" ? "#1f9d55" : status?.state === "problem" ? "#d64545" : "#b8c2cc" }} />
      <span style={{ flex: 1, minWidth: 160 }}>{checking ? "Checking the printer..." : status && status.state !== "system" ? status.message : "Printer not checked yet."}</span>
      <button type="button" className="secondary" disabled={checking} onClick={check}>Check printer</button></div>}
    {raw && <>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={prefs.cut} onChange={e => onChange({ ...prefs, cut: e.target.checked })} /> Cut the paper after each receipt</label>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <label>Open the cash drawer<select value={prefs.drawerRule} onChange={e => onChange({ ...prefs, drawerRule: e.target.value as DrawerRule })}><option value="off">Never automatically</option><option value="cash">After sales paid in cash</option><option value="always">After every sale</option></select></label>
        <label>Drawer pin<select value={prefs.drawerPin} onChange={e => onChange({ ...prefs, drawerPin: e.target.value === "5" ? 5 : 2 })}><option value="2">Pin 2 (most)</option><option value="5">Pin 5</option></select></label></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="secondary" disabled={busy} onClick={() => run("Test page", () => printTestPage(prefs))}>Print test page</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => run("Drawer pulse", () => kickDrawer(prefs))}>Test cash drawer</button></div>
      <p style={{ fontSize: 11, color: "#8995a3", margin: 0 }}>The drawer must be plugged into the printer's drawer (RJ11) port. If it does not open, try Pin 5. Receipts print at {prefs.paper} mm width; accents are simplified (é prints as e).</p></>}
    {!raw && <p style={{ fontSize: 11, color: "#8995a3", margin: 0 }}>With the system print dialog, the cash drawer cannot be controlled. Choose a network or USB receipt printer above to use direct printing and the drawer.</p>}
  </div>;
}
