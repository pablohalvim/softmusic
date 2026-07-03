import type { Route } from "./+types/health.ready";
import { getServerConfig, jsonResponse } from "../server/config.server";

export async function loader(_: Route.LoaderArgs) {
  const { pythonAiUrl, redisUrl } = getServerConfig();
  const checks: Record<string, string> = {
    api: "up",
    redis: "unknown",
    python_ai: "unknown",
  };

  try {
    const Redis = (await import("ioredis")).default;
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
    await redis.ping();
    checks.redis = "up";
    redis.disconnect();
  } catch {
    checks.redis = "down";
  }

  try {
    const response = await fetch(`${pythonAiUrl}/health`, { signal: AbortSignal.timeout(3000) });
    checks.python_ai = response.ok ? "up" : "down";
  } catch {
    checks.python_ai = "down";
  }

  const healthy = Object.values(checks).every((value) => value === "up");
  return jsonResponse(
    { status: healthy ? "healthy" : "degraded", services: checks },
    { status: healthy ? 200 : 503 },
  );
}
