import { z } from "zod";
import type { Route } from "./+types/auth.refresh";
import { saasJsonAction } from "../server/saas-routes.server";

const RefreshSchema = z.object({ refresh_token: z.string().min(1) });

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/auth/refresh", RefreshSchema);
}
