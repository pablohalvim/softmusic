import { describe, expect, it } from "vitest";

import { formatDateTime, parseUtcIso } from "./datetime.js";

describe("datetime", () => {
  it("formats UTC instants in America/Sao_Paulo", () => {
    const formatted = formatDateTime("2026-07-03T00:49:00+00:00");
    expect(formatted).toMatch(/02\/07\/2026/);
    expect(formatted).toMatch(/21:49/);
  });

  it("assumes UTC when API omits timezone offset", () => {
    expect(parseUtcIso("2026-07-03T00:49:00").toISOString()).toBe("2026-07-03T00:49:00.000Z");
  });
});
