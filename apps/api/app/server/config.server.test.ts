import { describe, expect, it } from "vitest";

import { upstreamAuthHeaders } from "./config.server";

describe("upstreamAuthHeaders", () => {
  it("repassa Authorization e X-Band-Id para o python-ai", () => {
    const request = new Request("http://localhost:8080/songs", {
      headers: {
        Authorization: "Bearer test-token",
        "X-Band-Id": "bnd_123",
      },
    });

    const headers = upstreamAuthHeaders(request);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("X-Band-Id")).toBe("bnd_123");
  });

  it("retorna headers vazios sem request", () => {
    const headers = upstreamAuthHeaders();
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Band-Id")).toBeNull();
  });
});
