import type { Route } from "./+types/bands.$bandId.schedules.occurrences.$occurrenceId.cancel";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Use POST", 405, request);
  }
  return proxyJson(
    `/bands/${params.bandId}/schedules/occurrences/${params.occurrenceId}/cancel`,
    { method: "POST" },
    request,
  );
}
