import { CreateBandSchema } from "@softmusic/types";
import type { Route } from "./+types/bands._index";
import { corsPreflightResponse, errorResponse, proxyJson } from "../server/config.server";
import { saasProxy } from "../server/saas-routes.server";

export async function loader({ request }: Route.LoaderArgs) {
  return saasProxy("/bands", request);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed", 405, request);
  }
  const body = await request.json();
  const parsed = CreateBandSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.message, 422, request);
  }
  return proxyJson(
    "/bands",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    },
    request,
  );
}
