// Fails if any production dependency of the server packages uses a license
// outside the allowlist, keeping copyleft code out of the FSL core.
import { execFileSync } from "node:child_process";

const ALLOW = new Set([
  "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD",
  "BlueOak-1.0.0", "CC0-1.0", "CC-BY-4.0", "Unlicense", "Python-2.0", "MPL-2.0",
  "FSL-1.1-ALv2",
]);

const out = execFileSync("pnpm", ["licenses", "list", "--prod", "--json", "-r"], { encoding: "utf8" });
const byLicense = JSON.parse(out);
const bad = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  // SPDX: "(MIT OR Apache-2.0)" passes if any option is allowed; "MIT AND ISC" if all are.
  const options = license.replace(/[()]/g, "").split(/\s+OR\s+/);
  if (options.some((o) => o.split(/\s+AND\s+/).every((l) => ALLOW.has(l.trim())))) continue;
  for (const p of pkgs) bad.push(`${p.name}@${p.versions?.join(",") ?? "?"}: ${license}`);
}
if (bad.length) {
  console.error("Disallowed dependency licenses:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log(`dependency licenses ok (${Object.keys(byLicense).length} license types)`);
