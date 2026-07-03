import { z } from "zod";
import type { Route } from "./+types/admin.bands.$bandId.exempt";
import { saasJsonAction } from "../server/saas-routes.server";

const ExemptSchema = z.object({
  exempt: z.boolean(),
  reason: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(request, `/admin/bands/${params.bandId}/exempt`, ExemptSchema, "PATCH");
}
