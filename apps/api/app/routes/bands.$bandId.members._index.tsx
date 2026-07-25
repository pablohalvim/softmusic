import type { Route } from "./+types/bands.$bandId.members._index";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return saasProxy(`/bands/${params.bandId}/members`, request);
}
