#!/usr/bin/env node
/**
 * Configura git para usar .githooks/ (pre-commit com bump de versão).
 * Roda via `pnpm prepare` / `pnpm hooks:install`.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = join(root, ".githooks");

if (!existsSync(join(root, ".git"))) {
  console.log(">> install-git-hooks: sem .git — ignorado");
  process.exit(0);
}

if (!existsSync(hooksDir)) {
  console.error(">> install-git-hooks: pasta .githooks não encontrada");
  process.exit(1);
}

try {
  execSync("git config core.hooksPath .githooks", {
    cwd: root,
    stdio: "inherit",
  });
  console.log(">> install-git-hooks: core.hooksPath=.githooks");
} catch (error) {
  console.warn(">> install-git-hooks: não foi possível configurar hooks:", error.message);
  process.exit(0);
}
