import type { Route } from "./+types/admin.me";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/admin/me", request);
}
