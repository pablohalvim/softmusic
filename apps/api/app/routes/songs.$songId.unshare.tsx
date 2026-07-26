import type { Route } from "./+types/songs.$songId.unshare";
import { proxyJson } from "../server/config.server";

export async function action({ request, params }: Route.ActionArgs) {
  return proxyJson(`/songs/${params.songId}/unshare`, { method: "POST" }, request);
}
