import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.roles.$roleId";
import { saasDeleteAction, saasJsonAction } from "../server/saas-routes.server";

const RoleSchema = z.object({ name: z.string().min(1).max(100) });

export async function action({ request, params }: Route.ActionArgs) {
  const path = `/bands/${params.bandId}/roles/${params.roleId}`;
  if (request.method === "DELETE") {
    return saasDeleteAction(request, path);
  }
  return saasJsonAction(request, path, RoleSchema, "PATCH");
}
