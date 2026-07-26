import { VerifyResetCodeSchema } from "@softmusic/types";
import type { Route } from "./+types/auth.verify-reset-code";
import { saasJsonAction } from "../server/saas-routes.server";

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/auth/verify-reset-code", VerifyResetCodeSchema);
}
