// The PUBLIC half of the licence signing key. It is safe to ship inside the app: it can only check keys, not make them.
// Replace it (see tools/licence.mjs keygen) only if you start a new key pair. Old keys then stop working.
export const LICENCE_PUBLIC_KEY: JsonWebKey = {"kty": "EC", "crv": "P-256", "x": "VTgCh2qGuuWS32OBuGJFVjBPQAr7Ps94rsv1jdzlY-0", "y": "pIySqEI1i7Z5Ng-iAhEVbqvFi0_QZ9kJ94PKSeLPi94"};
