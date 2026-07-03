import type { Route } from "./+types/admin.bands";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/admin/bands", request);
}
