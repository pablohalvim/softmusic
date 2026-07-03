import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.invites";
import { saasJsonAction } from "../server/saas-routes.server";

const InviteSchema = z.object({
  email: z.string().email(),
  can_analyze_songs: z.boolean().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(request, `/bands/${params.bandId}/invites`, InviteSchema);
}
