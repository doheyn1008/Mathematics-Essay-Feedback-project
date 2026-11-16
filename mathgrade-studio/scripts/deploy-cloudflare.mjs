import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import "./sites-env.mjs";

const dryRun = process.argv.includes("--dry-run");
const configPath = new URL("../dist/server/wrangler.json", import.meta.url);
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.vars?.DEPLOYMENT_TARGET !== "cloudflare") {
  throw new Error("Build the Cloudflare target with npm run build before deploying.");
}
if (!dryRun && config.d1_databases?.some(database => database.database_id === "00000000-0000-4000-8000-000000000000")) {
  throw new Error("Create your D1 database and set its real database_id in wrangler.json before deploying.");
}
const cli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "deploy", "--config", fileURLToPath(configPath),
  ...(dryRun ? ["--dry-run", "--outdir", ".wrangler/deploy-check"] : [])], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
