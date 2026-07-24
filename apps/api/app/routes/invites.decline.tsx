import { z } from "zod";
import type { Route } from "./+types/invites.decline";
import { saasJsonAction } from "../server/saas-routes.server";

const DeclineSchema = z.object({ invite_id: z.string().min(1) });

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/invites/decline", DeclineSchema);
}
