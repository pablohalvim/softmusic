import type { Route } from "./+types/invites.preview";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  return saasProxy(`/invites/preview?token=${encodeURIComponent(token)}`, request);
}
