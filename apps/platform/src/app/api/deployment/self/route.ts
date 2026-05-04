import { handleDeploymentRequest } from "../_shared";

export async function POST(request: Request): Promise<Response> {
  return handleDeploymentRequest(request, "self");
}
