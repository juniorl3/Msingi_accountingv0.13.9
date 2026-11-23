// Product ownership and copyright details used throughout Msingi Accounting.
// A test checks the installer and package files carry the same owner name and copyright line.
export const ABOUT = {
  product: "Msingi Accounting",
  tagline: "Offline accounting and point of sale for small businesses",
  owner: "GTN Global Network",   // owner and developer
  address: "Arusha, Tanzania",
  year: 2026,
} as const;

export const copyrightLine = () => `\u00a9 ${ABOUT.year} ${ABOUT.owner}. All rights reserved.`;
