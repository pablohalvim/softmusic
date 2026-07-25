import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.plan";
import { saasJsonAction } from "../server/saas-routes.server";

const PlanSchema = z.object({
  plan_code: z.enum(["individual", "band_10", "band_20"]),
});

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(request, `/bands/${params.bandId}/plan`, PlanSchema, "PATCH");
}
