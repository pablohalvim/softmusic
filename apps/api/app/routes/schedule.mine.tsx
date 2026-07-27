import type { Route } from "./+types/schedule.mine";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/schedule/mine", request);
}
