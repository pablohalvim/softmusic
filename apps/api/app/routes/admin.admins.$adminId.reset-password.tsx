import { z } from "zod";
import type { Route } from "./+types/admin.admins.$adminId.reset-password";
import { saasJsonAction } from "../server/saas-routes.server";

const Schema = z.object({
  password: z.string().min(8),
});

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(
    request,
    `/admin/admins/${params.adminId}/reset-password`,
    Schema,
    "POST",
  );
}
