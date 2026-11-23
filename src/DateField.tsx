import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { MONTHS, MONTHS_SHORT, WEEKDAYS, formatYMD, monthGrid, pad, parseYM, parseYMD, shiftMonth, yearPageStart, yearsOnPage } from "./calendar";
import { localDate } from "./parties";

/**
 * Drop-in replacement for a native date or month input.
 * You can still type the date (YYYY-MM-DD / YYYY-MM) or open the animated calendar and browse by day, month and year.
 * onChange receives an event-like object, so existing `e => set(e.target.value)` handlers keep working.
 */
type Props = {
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: "date" | "month"; required?: boolean; disabled?: boolean; min?: string; max?: string;
  style?: React.CSSProperties; className?: string;
};
type View = "days" | "months" | "years";
type Dir = "next" | "prev" | "in" | "out";

export default function DateField({ value, onChange, type = "date", required, disabled, min, max, style, className }: Props) {
  const isMonth = type === "month";
  const parse = (s: string) => (isMonth ? parseYM(s) : parseYMD(s));
  const today = localDate();
  const base = parse(value) ?? parseYMD(today)!;
  const wrap = useRef<HTMLSpanElement>(null), pop = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [view, setView] = useState<View>(isMonth ? "months" : "days");
  const [cur, setCur] = useState({ y: base.y, m: base.m }), [page, setPage] = useState(yearPageStart(base.y));
  const [dir, setDir] = useState<Dir>("in"), [text, setText] = useState(value), [pos, setPos] = useState<{ left: number; top: number; up: boolean }>({ left: 0, top: 0, up: false });

  useEffect(() => { setText(value); }, [value]);

  const place = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect(); if (!r) return;
    const h = pop.current?.offsetHeight ?? 330, w = 288;
    const up = r.bottom + h + 12 > window.innerHeight && r.top - h - 12 > 0;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: up ? r.top - h - 6 : r.bottom + 6, up });
  }, []);
  useLayoutEffect(() => { if (open) place(); }, [open, view, cur, place]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); input.current?.focus(); } };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key, true);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);

  function toggle() {
    if (disabled) return;
    if (!open) { const b = parse(value) ?? parseYMD(today)!; setCur({ y: b.y, m: b.m }); setPage(yearPageStart(b.y)); setView(isMonth ? "months" : "days"); setDir("in"); }
    setOpen(!open);
  }
  const emit = (v: string) => onChange({ target: { value: v } } as React.ChangeEvent<HTMLInputElement>);
  const outOfRange = (v: string) => (!!min && v < min.slice(0, v.length)) || (!!max && v > max.slice(0, v.length));

  function typed(s: string) { setText(s); if (s === "" && !required) emit(""); else if (parse(s) && !outOfRange(s)) emit(s); }
  function blur() { if (text !== value && !(parse(text) && !outOfRange(text))) setText(value); }

  const go = (d: Dir, fn: () => void) => { setDir(d); fn(); };
  const stepMonth = (n: number) => go(n > 0 ? "next" : "prev", () => setCur(shiftMonth(cur.y, cur.m, n)));
  const pickDay = (date: string) => { if (outOfRange(date)) return; emit(date); setOpen(false); input.current?.focus(); };
  const pickMonth = (m: number) => {
    if (isMonth) { const v = `${pad(cur.y, 4)}-${pad(m)}`; if (outOfRange(v)) return; emit(v); setOpen(false); input.current?.focus(); }
    else go("in", () => { setCur({ y: cur.y, m }); setView("days"); });
  };
  const pickYear = (y: number) => go("in", () => { setCur({ y, m: cur.m }); setView("months"); });
  const goToday = () => { const t = parseYMD(today)!; if (isMonth) { const v = today.slice(0, 7); if (!outOfRange(v)) { emit(v); setOpen(false); } } else if (!outOfRange(today)) { emit(today); setOpen(false); } else go("in", () => { setCur({ y: t.y, m: t.m }); setView("days"); }); };

  const sel = parseYMD(value), selYM = parseYM(value.slice(0, 7));
  const nowYMD = parseYMD(today)!;
  const anim = `dp-anim-${dir}`;

  return <span className={"dp-field " + (className ?? "")} style={style} ref={wrap}>
    <input ref={input} className="dp-input" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={isMonth ? 7 : 10}
      placeholder={isMonth ? "YYYY-MM" : "YYYY-MM-DD"} value={text} required={required} disabled={disabled}
      onChange={e => typed(e.target.value)} onBlur={blur} onKeyDown={e => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); toggle(); } }} />
    <button type="button" className="dp-open" aria-label={isMonth ? "Choose month" : "Choose date"} aria-expanded={open} disabled={disabled} onClick={toggle}><CalendarDays size={15} /></button>
    {open && createPortal(
      <div className={"dp-pop" + (pos.up ? " up" : "")} ref={pop} role="dialog" aria-label="Calendar" style={{ left: pos.left, top: pos.top }}>
        <div className="dp-head">
          {view === "days" && <>
            <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => stepMonth(-1)}><ChevronLeft size={16} /></button>
            <span className="dp-titles">
              <button type="button" className="dp-title" onClick={() => go("out", () => setView("months"))}>{MONTHS[cur.m - 1]}</button>
              <button type="button" className="dp-title" onClick={() => go("out", () => { setPage(yearPageStart(cur.y)); setView("years"); })}>{cur.y}</button>
            </span>
            <button type="button" className="dp-nav" aria-label="Next month" onClick={() => stepMonth(1)}><ChevronRight size={16} /></button></>}
          {view === "months" && <>
            <button type="button" className="dp-nav" aria-label="Previous year" onClick={() => go("prev", () => setCur({ ...cur, y: cur.y - 1 }))}><ChevronLeft size={16} /></button>
            <span className="dp-titles"><button type="button" className="dp-title" onClick={() => go("out", () => { setPage(yearPageStart(cur.y)); setView("years"); })}>{cur.y}</button></span>
            <button type="button" className="dp-nav" aria-label="Next year" onClick={() => go("next", () => setCur({ ...cur, y: cur.y + 1 }))}><ChevronRight size={16} /></button></>}
          {view === "years" && <>
            <button type="button" className="dp-nav" aria-label="Previous years" onClick={() => go("prev", () => setPage(page - 12))}><ChevronLeft size={16} /></button>
            <span className="dp-titles"><span className="dp-title static">{page} – {page + 11}</span></span>
            <button type="button" className="dp-nav" aria-label="Next years" onClick={() => go("next", () => setPage(page + 12))}><ChevronRight size={16} /></button></>}
        </div>
        <div className="dp-body">
          {view === "days" && <div key={`d-${cur.y}-${cur.m}`} className={"dp-anim " + anim}>
            <div className="dp-week">{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</div>
            <div className="dp-grid">{monthGrid(cur.y, cur.m).map(c => {
              const cls = "dp-day" + (c.inMonth ? "" : " out") + (sel && c.date === formatYMD(sel.y, sel.m, sel.d) ? " selected" : "") + (c.date === today ? " today" : "");
              return <button type="button" key={c.date} className={cls} disabled={outOfRange(c.date)} onClick={() => pickDay(c.date)}>{c.day}</button>;
            })}</div></div>}
          {view === "months" && <div key={`m-${cur.y}`} className={"dp-anim dp-cells " + anim}>{MONTHS_SHORT.map((n, i) => {
            const cls = "dp-cell" + (selYM && selYM.y === cur.y && selYM.m === i + 1 ? " selected" : "") + (nowYMD.y === cur.y && nowYMD.m === i + 1 ? " today" : "");
            return <button type="button" key={n} className={cls} disabled={outOfRange(`${pad(cur.y, 4)}-${pad(i + 1)}`)} onClick={() => pickMonth(i + 1)}>{n}</button>;
          })}</div>}
          {view === "years" && <div key={`y-${page}`} className={"dp-anim dp-cells " + anim}>{yearsOnPage(page).map(y => {
            const cls = "dp-cell" + (selYM && selYM.y === y ? " selected" : "") + (nowYMD.y === y ? " today" : "");
            return <button type="button" key={y} className={cls} onClick={() => pickYear(y)}>{y}</button>;
          })}</div>}
        </div>
        <div className="dp-foot"><button type="button" className="dp-link" onClick={goToday}>{isMonth ? "This month" : "Today"}</button>{!required && value && <button type="button" className="dp-link muted" onClick={() => { emit(""); setOpen(false); }}>Clear</button>}</div>
      </div>, document.body)}
  </span>;
}

