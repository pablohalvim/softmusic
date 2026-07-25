import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.members.$memberId";
import { saasDeleteAction, saasJsonAction } from "../server/saas-routes.server";

const MemberSchema = z.object({
  can_analyze_songs: z.boolean().optional(),
  can_invite_members: z.boolean().optional(),
  can_manage_members: z.boolean().optional(),
  role_ids: z.array(z.string()).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const path = `/bands/${params.bandId}/members/${params.memberId}`;
  if (request.method === "DELETE") {
    return saasDeleteAction(request, path);
  }
  return saasJsonAction(request, path, MemberSchema, "PATCH");
}
