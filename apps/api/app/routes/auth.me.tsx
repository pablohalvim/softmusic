import type { Route } from "./+types/auth.me";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/auth/me", request);
}
