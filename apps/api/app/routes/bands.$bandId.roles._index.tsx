import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.roles._index";
import { saasJsonAction, saasProxy } from "../server/saas-routes.server";

const RoleSchema = z.object({ name: z.string().min(1).max(100) });

export async function loader({ request, params }: Route.LoaderArgs) {
  return saasProxy(`/bands/${params.bandId}/roles`, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(request, `/bands/${params.bandId}/roles`, RoleSchema);
}
