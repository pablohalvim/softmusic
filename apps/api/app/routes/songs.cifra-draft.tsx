import type { Route } from "./+types/songs.cifra-draft";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }

  const body = await request.json();
  return proxyJson(
    "/songs/cifra-draft",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    request,
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Use POST", 405, request);
}
