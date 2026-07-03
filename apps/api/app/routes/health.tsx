import type { Route } from "./+types/health";

export async function loader(_: Route.LoaderArgs) {
  return Response.json({ status: "healthy", service: "softmusic-api" });
}
