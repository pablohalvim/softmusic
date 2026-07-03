import type { Route } from "./+types/jobs.$jobId";
import { proxyJson } from "../server/config.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return proxyJson(`/jobs/${params.jobId}`, undefined, request);
}
