import { NextResponse } from "next/server";
import { getAgent } from "@/lib/agent";
import type { AgentContext } from "@/lib/agent";

/**
 * POST /api/agent
 * Body: { message: string; context: AgentContext }
 *
 * The agent is stateless; the client sends the current model snapshot and the
 * agent returns text plus a list of actions for the workspace to apply. This
 * keeps the model logic server-side so it can later be backed by an LLM,
 * persisted sessions and role-based permissions without changing the client.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { message?: string; context?: AgentContext };
    if (!body.message || !body.context) return NextResponse.json({ error: "message and context are required" }, { status: 400 });
    const reply = await getAgent().respond(body.message, body.context);
    return NextResponse.json(reply);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Agent error" }, { status: 500 });
  }
}
