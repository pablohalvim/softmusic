import { z } from "zod";
import type { Route } from "./+types/admin.admins._index";
import { saasJsonAction, saasProxy } from "../server/saas-routes.server";

const CreateAdminSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["full_admin", "salesperson"]),
});

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/admin/admins", request);
}

export async function action({ request }: Route.ActionArgs) {
  return saasJsonAction(request, "/admin/admins", CreateAdminSchema, "POST");
}
