// The plug-in point for a real fiscal connection (TRA EFD/VFD). Pure types, no network.
//
// IMPORTANT: Msingi is NOT connected to TRA in this release. Nothing here sends data to TRA, and nothing here produces a fiscal
// receipt, verification code or Z-report. A real adapter must be written against TRA's official specification, with your
// registered serial number and certificate, and must pass TRA's own certification before it is used for real sales.

export type FiscalLine = { item: string; code: string; qtyMilli: number; discountTzs: number; netTzs: number; vatTzs: number; grossTzs: number; vatTreatment: string };
/** Everything Msingi knows about a finished sale that a fiscal device or service would need. */
export type FiscalSale = {
  reference: string; date: string; vatRegistered: boolean; vatRatePercent: number; payment: string;
  totals: { net: number; vat: number; gross: number }; lines: FiscalLine[];
};
export type FiscalResult = { receiptNo: string; verificationCode: string };
export interface FiscalAdapter { readonly name: string; submit(sale: FiscalSale): Promise<FiscalResult>; }

export const NOT_CONNECTED = "Msingi is not connected to TRA. Keep issuing EFD/VFD receipts with your approved device.";
/** The only adapter that exists: it refuses, so no sale can ever be marked as sent by accident. */
export const notConnected: FiscalAdapter = { name: "none", submit: async () => { throw new Error(NOT_CONNECTED); } };
