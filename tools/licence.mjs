#!/usr/bin/env node
// Seller's tool for Msingi licence keys. Runs on your own computer with Node 20+. Never give the private key file to a customer.
//
//   node tools/licence.mjs keygen  my-private-key.json
//   node tools/licence.mjs issue   my-private-key.json "Duka la Juma" ABCDE-FGHJK 2027-12-31
//   node tools/licence.mjs issue   my-private-key.json "Duka la Juma" ABCDE-FGHJK never
//   node tools/licence.mjs verify  my-private-key.json "MSG1...." ABCDE-FGHJK
//
// "keygen" prints the public key. Paste it into src/licensePublic.ts and rebuild the app. Keys made with a different private key will not work.
import { webcrypto as c } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [cmd, file, ...a] = process.argv.slice(2);
const b64 = u => Buffer.from(u).toString("base64url");
const alg = { name: "ECDSA", namedCurve: "P-256" }, sig = { name: "ECDSA", hash: "SHA-256" };
const die = m => { console.error(m); process.exit(1); };
const norm = s => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
if (!cmd || !file) die("Usage: keygen <file> | issue <file> <client> <computer code> <YYYY-MM-DD|never> | verify <file> <key> <computer code>");
if (cmd === "keygen") {
  if (existsSync(file)) die(`${file} already exists. Not overwriting it.`);
  const k = await c.subtle.generateKey(alg, true, ["sign", "verify"]);
  writeFileSync(file, JSON.stringify({ private: await c.subtle.exportKey("jwk", k.privateKey), public: await c.subtle.exportKey("jwk", k.publicKey) }, null, 2), { mode: 0o600 });
  console.log(`Saved ${file}. KEEP IT SAFE AND PRIVATE. Back it up. If it is lost you cannot issue new keys for existing installs.\n\nPublic key for src/licensePublic.ts:\n${JSON.stringify((JSON.parse(readFileSync(file, "utf8"))).public)}`);
} else if (cmd === "issue") {
  const [client, computer, expires] = a;
  if (!client || !computer || !expires) die("Give: client name, computer code (or * for any computer), and an expiry date YYYY-MM-DD or never.");
  if (computer !== "*" && norm(computer).length !== 10) die("The computer code must be 10 characters, like ABCDE-FGHJK, or *.");
  if (expires !== "never" && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) die("The expiry must be YYYY-MM-DD or never.");
  const keys = JSON.parse(readFileSync(file, "utf8"));
  const payload = { v: 1, client: client.trim(), computer: computer === "*" ? "*" : norm(computer).replace(/^(.{5})/, "$1-"), issued: new Date().toLocaleDateString("sv-SE"), expires: expires === "never" ? null : expires };
  const body = b64(JSON.stringify(payload));
  const k = await c.subtle.importKey("jwk", keys.private, alg, false, ["sign"]);
  console.log(`MSG1.${body}.${b64(new Uint8Array(await c.subtle.sign(sig, k, new TextEncoder().encode(`MSG1.${body}`))))}`);
  console.error(`\nIssued to ${payload.client}, computer ${payload.computer}, expires ${payload.expires ?? "never"}.`);
} else if (cmd === "verify") {
  const [key, computer] = a, keys = JSON.parse(readFileSync(file, "utf8")), [p, body, s] = (key ?? "").replace(/\s+/g, "").split(".");
  const k = await c.subtle.importKey("jwk", keys.public, alg, false, ["verify"]);
  const ok = p === "MSG1" && await c.subtle.verify(sig, k, Buffer.from(s ?? "", "base64url"), new TextEncoder().encode(`MSG1.${body}`));
  const pay = ok ? JSON.parse(Buffer.from(body, "base64url").toString()) : null;
  console.log(ok ? `VALID: ${JSON.stringify(pay)}${computer && pay.computer !== "*" && norm(pay.computer) !== norm(computer) ? "\nBut it is for a different computer." : ""}` : "NOT VALID");
} else die("Unknown command.");
