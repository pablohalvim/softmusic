import { ForgotPasswordSchema } from "@softmusic/types";
import type { Route } from "./+types/auth.forgot-password";
import { saasJsonAction } from "../server/saas-routes.server";

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/auth/forgot-password", ForgotPasswordSchema);
}
