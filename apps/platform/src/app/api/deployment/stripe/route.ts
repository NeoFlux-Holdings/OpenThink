export async function POST(request: Request): Promise<Response> {
  await request.body?.cancel().catch(() => undefined);
  return Response.json(
    {
      error:
        "Stripe Projects managed onboarding is not connected in this OpenThink deployment yet. Use self-service Cloudflare launch for now.",
      status: "reserved",
      next:
        "Connect the official Stripe Projects orchestration once the provider protocol/spec is available to this platform."
    },
    {
      status: 501,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
