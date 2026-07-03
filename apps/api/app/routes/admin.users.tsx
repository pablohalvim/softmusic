import type { Route } from "./+types/admin.users";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  return saasProxy(`/admin/users${query ? `?${query}` : ""}`, request);
}
