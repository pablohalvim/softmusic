import type { Route } from "./+types/songs.$songId.cifra-variations.$variationId";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  if (request.method !== "DELETE") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }

  return proxyJson(
    `/songs/${params.songId}/cifra-variations/${params.variationId}`,
    { method: "DELETE" },
    request,
  );
}
