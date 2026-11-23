import { useId } from "react";

/** The Msingi logo: a white "M" standing on a foundation line, on a green rounded square. Same artwork as the app icon. */
export default function BrandMark({ size }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return <svg className="brand-mark" viewBox="100 100 824 824" role="img" aria-label="Msingi Accounting logo" style={size ? { width: size, height: size } : undefined}>
    <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2fae93" /><stop offset="1" stopColor="#136d68" /></linearGradient>
      <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".16" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
    <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#g${id})`} />
    <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#s${id})`} />
    <path d="M318 640 V360 L512 556 L706 360 V640" fill="none" stroke="#fff" strokeWidth="84" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="290" y="706" width="444" height="46" rx="23" fill="#fff" fillOpacity=".92" />
  </svg>;
}
