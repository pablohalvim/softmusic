import type { Route } from "./+types/metrics";
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export async function loader(_: Route.LoaderArgs) {
  return new Response(await register.metrics(), {
    headers: { "Content-Type": register.contentType },
  });
}
