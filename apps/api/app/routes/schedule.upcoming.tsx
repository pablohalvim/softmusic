import type { Route } from "./+types/schedule.upcoming";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/schedule/upcoming", request);
}
