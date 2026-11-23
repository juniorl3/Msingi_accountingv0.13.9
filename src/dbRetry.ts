// Retrying SQLite "database is locked" answers. Pure (no Tauri), so it can be tested.
// A lock is usually short: a backup copy, antivirus scanning the file, or another Msingi window finishing a write.

export const BUSY = /database is locked|SQLITE_BUSY|database table is locked/i;
export const BUSY_TRIES = 6;
export const BUSY_DELAY_MS = 350;

export const isBusy = (e: unknown): boolean => BUSY.test(String(e));

/** Runs `job`; when it fails because the database is busy, waits and tries again (up to `tries` runs in all). Any other error is thrown at once. */
export async function retryBusy<T>(job: () => Promise<T>, tries = BUSY_TRIES, delayMs = BUSY_DELAY_MS, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await job(); }
    catch (e) {
      if (!isBusy(e)) throw e;
      last = e;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw last;
}
