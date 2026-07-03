import { z } from "zod";
import type { Route } from "./+types/admin.marketing.send";
import { saasJsonAction } from "../server/saas-routes.server";

const MarketingSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  audience: z.string().optional(),
});

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/marketing/send", MarketingSchema);
}
