// Headless harness: PROJECT JSON -> quantities export, through the same code path as the editor
// (migrateProjectFile + makeQuantities().buildExport). No browser, no React.
import fs from "node:fs";
import { migrateProjectFile, makeQuantities } from "../src/quantities.js";

export function stateFromProject(project) {
  const d = typeof project === "string" ? JSON.parse(project) : project;
  if (d.format !== "bml-markup-project") throw new Error("not a bml-markup-project file");
  return migrateProjectFile(d);
}

export function exportFromProject(project, opts) {
  return makeQuantities(stateFromProject(project)).buildExport(opts);
}

export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// CLI: node tests/harness.mjs <PROJECT.json> [out.json]
if (process.argv[1] && process.argv[1].endsWith("harness.mjs") && process.argv[2]) {
  const out = JSON.stringify(exportFromProject(fs.readFileSync(process.argv[2], "utf8")), null, 2);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], out); else process.stdout.write(out + "\n");
}
