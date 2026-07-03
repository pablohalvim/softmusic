import { z } from "zod";
import type { Route } from "./+types/admin.auth.login";
import { saasJsonAction } from "../server/saas-routes.server";

const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/auth/login", AdminLoginSchema);
}
