import type { Route } from "./+types/bands.$bandId.addresses.$addressId";
import { saasDeleteAction } from "../server/saas-routes.server";

export async function action({ request, params }: Route.ActionArgs) {
  return saasDeleteAction(
    request,
    `/bands/${params.bandId}/addresses/${params.addressId}`,
  );
}
