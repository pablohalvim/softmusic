import type { Route } from "./+types/songs.$songId.keys.$key.audio";
import { proxyBinary } from "../server/config.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const key = encodeURIComponent(params.key);
  return proxyBinary(`/songs/${params.songId}/keys/${key}/audio`, request);
}
