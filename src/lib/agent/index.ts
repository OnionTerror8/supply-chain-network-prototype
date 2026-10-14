import { RuleBasedAgent } from "./rule-agent";
import type { AgentContext, AgentProvider, AgentReply } from "./types";

/**
 * Agent provider registry.
 *
 * The prototype ships a deterministic rule-based planner so it runs with no
 * credentials. `LlmAgentProvider` is the extension point for a hosted model:
 * it would receive the same `AgentContext`, use the rule agent's tool
 * functions (build network, create scenario, answer) as function-calling
 * tools, and must return the same `AgentReply` shape so the UI is unchanged.
 */
class LlmAgentProvider implements AgentProvider {
  readonly name = "Meridian planner (LLM)";
  constructor(private readonly fallback: AgentProvider) {}
  async respond(message: string, ctx: AgentContext): Promise<AgentReply> {
    // Placeholder: when MERIDIAN_LLM_API_KEY is configured, route to the model
    // with the deterministic tools exposed. Until then, use the rule agent.
    return this.fallback.respond(message, ctx);
  }
}

const ruleAgent = new RuleBasedAgent();

export function getAgent(): AgentProvider {
  if (process.env.MERIDIAN_LLM_API_KEY) return new LlmAgentProvider(ruleAgent);
  return ruleAgent;
}

export type { AgentAction, AgentContext, AgentProvider, AgentReply, PendingSetup, WorkspaceView } from "./types";
