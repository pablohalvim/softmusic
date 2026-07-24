import type { Route } from "./+types/invites.pending";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/invites/pending", request);
}
