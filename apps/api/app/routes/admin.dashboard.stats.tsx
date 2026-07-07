import type { Route } from "./+types/admin.dashboard.stats";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/admin/dashboard/stats", request);
}
