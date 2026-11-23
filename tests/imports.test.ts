// Mac and Windows ignore letter case in file names; Linux does not. These checks catch mistakes that only show up when building on a Mac or Windows PC.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const files = readdirSync("src");
const stems = new Map<string, string[]>();
for (const f of files) { const k = f.toLowerCase().replace(/\.[^.]+$/, ""); stems.set(k, [...(stems.get(k) ?? []), f]); }
for (const [k, v] of stems) assert.equal(v.length, 1, `Files that differ only by letter case or extension would clash on Mac and Windows: ${v.join(", ")}`);

const exact = new Set(files.flatMap(f => [f, f.replace(/\.[^.]+$/, "")]));
for (const f of files.filter(f => /\.(ts|tsx)$/.test(f))) {
  for (const m of readFileSync(`src/${f}`, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']\.\/([^"']+)["']/g)) {
    const name = m[1].replace(/\.(ts|tsx|css)$/, "");
    assert.ok(exact.has(m[1]) || exact.has(name), `${f} imports ./${m[1]} but no file has exactly that name (check upper and lower case)`);
  }
}
console.log("import name tests passed");
