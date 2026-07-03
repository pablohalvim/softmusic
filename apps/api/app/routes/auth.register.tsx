import { RegisterUserSchema } from "@softmusic/types";
import type { Route } from "./+types/auth.register";
import { saasJsonAction } from "../server/saas-routes.server";

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/auth/register", RegisterUserSchema);
}
