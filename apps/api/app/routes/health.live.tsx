import type { Route } from "./+types/health.live";

export async function loader(_: Route.LoaderArgs) {
  return Response.json({ status: "ok" });
}
