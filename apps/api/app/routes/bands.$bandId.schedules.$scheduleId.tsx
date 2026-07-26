import type { Route } from "./+types/bands.$bandId.schedules.$scheduleId";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return saasProxy(`/bands/${params.bandId}/schedules/${params.scheduleId}`, request);
}
