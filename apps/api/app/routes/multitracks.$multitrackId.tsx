import type { Route } from "./+types/multitracks.$multitrackId";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/multitracks/${params.multitrackId}`, undefined, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method === "PATCH") {
    const body = await request.json();
    return proxyJson(
      `/multitracks/${params.multitrackId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      request,
    );
  }
  if (request.method === "DELETE") {
    return proxyJson(
      `/multitracks/${params.multitrackId}`,
      { method: "DELETE" },
      request,
    );
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
}
