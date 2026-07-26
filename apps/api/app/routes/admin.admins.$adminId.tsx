import { z } from "zod";
import type { Route } from "./+types/admin.admins.$adminId";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";
import { saasOptions } from "../server/saas-routes.server";

const UpdateAdminSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(["full_admin", "salesperson"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const options = saasOptions(request);
  if (options) return options;
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  const body = await request.json();
  const parsed = UpdateAdminSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.message, 422, request);
  }
  return proxyJson(
    `/admin/admins/${params.adminId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    },
    request,
  );
}
