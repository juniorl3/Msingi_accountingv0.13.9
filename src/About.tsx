import BrandMark from "./BrandMark";
import { ABOUT, copyrightLine } from "./aboutInfo";
import { APP_VERSION } from "./version";

/** Copyright notice shown under the sign-in and licence screens. */
export function Legal() {
  return <div className="legal">
    <div>{copyrightLine()}</div>
  </div>;
}

/** Settings card with product ownership, version and copyright information. */
export function AboutCard() {
  const rows: Array<[string, string]> = [
    ["Owner and developer", ABOUT.owner],
    ["Address", ABOUT.address],
    ["Version", `v${APP_VERSION}`],
    ["Copyright", copyrightLine()],
  ];
  return <section className="panel about" style={{ marginTop: 17 }}>
    <div className="about-head"><BrandMark size={52} /><div><h3>{ABOUT.product}</h3><p>{ABOUT.tagline}</p></div></div>
    <dl className="about-grid">{rows.map(([k, v]) => <div key={k} className={k === "Copyright" ? "wide" : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <p className="about-note">For support and licence enquiries, contact your authorised Msingi supplier.</p>
  </section>;
}
