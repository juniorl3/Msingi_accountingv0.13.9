import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ABOUT, copyrightLine } from "../src/aboutInfo.ts";

assert.equal(copyrightLine(), "© 2026 GTN Global Network. All rights reserved.");
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).bundle;
assert.equal(tauri.copyright, copyrightLine());
assert.equal(tauri.publisher, ABOUT.owner);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(pkg.author.name, ABOUT.owner);
assert.ok(readFileSync("src-tauri/Cargo.toml", "utf8").includes(ABOUT.owner));
const notice = readFileSync("COPYRIGHT.txt", "utf8");
for (const v of [ABOUT.owner, ABOUT.address]) assert.ok(notice.includes(v), v);
assert.equal(ABOUT.address, "Arusha, Tanzania");
assert.ok(readFileSync("src-tauri/tauri.conf.json", "utf8").includes("Arusha, Tanzania"));
console.log("about tests passed");
