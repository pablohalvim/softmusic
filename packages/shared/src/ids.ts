import { randomBytes } from "node:crypto";

const PREFIXES = {
  song: "song",
  job: "job",
  user: "usr",
  file: "file",
} as const;

type Prefix = keyof typeof PREFIXES;

export function createId(prefix: Prefix): string {
  const random = randomBytes(8).toString("hex");
  return `${PREFIXES[prefix]}_${random}`;
}

export function isValidId(value: string, prefix: Prefix): boolean {
  return new RegExp(`^${PREFIXES[prefix]}_[a-f0-9]{16}$`).test(value);
}
