import { z } from "zod";
import type { Route } from "./+types/invites.accept";
import { saasJsonAction } from "../server/saas-routes.server";

const AcceptSchema = z
  .object({
    token: z.string().min(1).optional(),
    invite_id: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.token || value.invite_id), {
    message: "Informe token ou invite_id",
  });

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/invites/accept", AcceptSchema);
}
