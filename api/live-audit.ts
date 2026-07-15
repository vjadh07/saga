import { handlePublicLiveRequest } from "../src/verify/live/public-endpoint.js";

export const maxDuration = 300;

// Vercel's Web Handler API keeps this function stateless. Each POST runs one complete,
// bounded Live audit and returns its terminal StoredAudit.
export default async function handler(request: Request): Promise<Response> {
  return handlePublicLiveRequest(request);
}
