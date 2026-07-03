import { LoginSchema } from "@softmusic/types";
import type { Route } from "./+types/auth.login";
import { saasJsonAction } from "../server/saas-routes.server";

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/auth/login", LoginSchema);
}
