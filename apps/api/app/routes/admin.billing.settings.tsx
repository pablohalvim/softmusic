import { z } from "zod";
import type { Route } from "./+types/admin.billing.settings";
import { saasJsonAction, saasProxy } from "../server/saas-routes.server";

const SettingsSchema = z.object({
  asaas_api_key: z.string().optional(),
  asaas_environment: z.enum(["sandbox", "production"]).optional(),
  asaas_webhook_token: z.string().optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/admin/billing/settings", request);
}

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/billing/settings", SettingsSchema, "PUT");
}
