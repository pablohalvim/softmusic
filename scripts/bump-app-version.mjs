#!/usr/bin/env node
/**
 * Incrementa o patch de APP_VERSION em packages/shared/src/version.ts.
 * Usado pelo hook .githooks/pre-commit.
 *
 * SKIP_VERSION_BUMP=1 — não altera a versão.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SKIP_VERSION_BUMP === "1") {
  console.log(">> bump-app-version: ignorado (SKIP_VERSION_BUMP=1)");
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = join(root, "packages/shared/src/version.ts");
const source = readFileSync(versionFile, "utf8");
const match = source.match(/APP_VERSION\s*=\s*"(\d+)\.(\d+)\.(\d+)"/);

if (!match) {
  console.error(">> bump-app-version: APP_VERSION semver não encontrado em version.ts");
  process.exit(1);
}

const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]) + 1;
const next = `${major}.${minor}.${patch}`;
const previous = `${match[1]}.${match[2]}.${match[3]}`;

const updated = source.replace(
  /APP_VERSION\s*=\s*"\d+\.\d+\.\d+"/,
  `APP_VERSION = "${next}"`,
);

if (updated === source) {
  console.error(">> bump-app-version: falha ao substituir APP_VERSION");
  process.exit(1);
}

writeFileSync(versionFile, updated, "utf8");
console.log(`>> bump-app-version: ${previous} → ${next}`);
