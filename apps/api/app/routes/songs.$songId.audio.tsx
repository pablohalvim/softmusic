import type { Route } from "./+types/songs.$songId.audio";
import { proxyBinary } from "../server/config.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  return proxyBinary(`/songs/${params.songId}/audio`, request);
}
