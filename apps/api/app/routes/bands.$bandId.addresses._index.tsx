import { z } from "zod";
import type { Route } from "./+types/bands.$bandId.addresses._index";
import { saasJsonAction, saasProxy } from "../server/saas-routes.server";

const AddressSchema = z.object({
  label: z.string().min(1).max(120),
  formatted_address: z.string().min(1).max(500),
  lat: z.number(),
  lng: z.number(),
  place_id: z.string().optional().nullable(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  return saasProxy(`/bands/${params.bandId}/addresses`, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  return saasJsonAction(request, `/bands/${params.bandId}/addresses`, AddressSchema);
}
