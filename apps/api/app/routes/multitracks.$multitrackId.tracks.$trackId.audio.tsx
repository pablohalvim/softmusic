import type { Route } from "./+types/multitracks.$multitrackId.tracks.$trackId.audio";
import { proxyBinary } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const qs = key ? `?key=${encodeURIComponent(key)}` : "";
  return proxyBinary(
    `/multitracks/${params.multitrackId}/tracks/${params.trackId}/audio${qs}`,
    request,
  );
}
