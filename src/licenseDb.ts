import { db } from "./db";
import { LICENCE_PUBLIC_KEY } from "./licensePublic";
import { licenceStatus, newComputerCode, verifyLicence } from "./licenseLogic";
import type { Licence, LicenceStatus } from "./licenseLogic";
import { localDate } from "./parties";

export type LicenceInfo = { computer: string; licence: Licence | null; status: LicenceStatus };

async function get(key: string): Promise<string | null> {
  const r = await (await db()).select<Array<{ value: string }>>("SELECT value FROM settings WHERE key=?", [key]);
  return r[0]?.value ?? null;
}
async function put(key: string, value: string) {
  await (await db()).execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
}

/** Reads the licence state at start-up. Creates this computer's code and the trial start date the first time. Never throws. */
export async function loadLicence(): Promise<LicenceInfo> {
  const today = localDate();
  try {
    let computer = await get("licence_computer");
    if (!computer) { computer = newComputerCode(crypto.getRandomValues(new Uint8Array(16))); await put("licence_computer", computer); }
    let firstRun = await get("licence_first_run");
    if (!firstRun) { firstRun = today; await put("licence_first_run", today); }
    const lastSeen = await get("licence_last_seen");
    let licence: Licence | null = null;
    const key = await get("licence_key");
    if (key) { const v = await verifyLicence(key, computer, LICENCE_PUBLIC_KEY); if (v.ok) licence = v.licence; }
    const status = licenceStatus({ today, lastSeen, firstRun, licence });
    if (!lastSeen || lastSeen < today) await put("licence_last_seen", today);
    return { computer, licence, status };
  } catch {
    // If the check itself cannot run, do not lock a business out of its own books.
    return { computer: "", licence: null, status: { state: "trial", usable: true, daysLeft: null, text: "The licence could not be checked on this computer.", clockBehind: false } };
  }
}

/** Checks a pasted key and, if it is valid for this computer, saves it. Throws a plain-language message when it is not. */
export async function saveLicenceKey(key: string): Promise<LicenceInfo> {
  const computer = (await loadLicence()).computer;
  const v = await verifyLicence(key, computer, LICENCE_PUBLIC_KEY);
  if (!v.ok) throw new Error(v.error);
  await put("licence_key", key.replace(/\s+/g, ""));
  await (await db()).execute("INSERT INTO audit_log(event_type,entity_type,entity_id,details) VALUES('LICENCE','licence',?,?)", [computer, JSON.stringify({ client: v.licence.client, expires: v.licence.expires })]);
  return loadLicence();
}
