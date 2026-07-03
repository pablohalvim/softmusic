import type { Route } from "./+types/dashboard.stats";
import { proxyJson } from "../server/config.server";

export async function loader({ request }: Route.LoaderArgs) {
  return proxyJson("/dashboard/stats", undefined, request);
}
