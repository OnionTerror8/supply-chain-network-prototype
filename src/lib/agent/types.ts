import type { Finding, NetworkMetrics, NetworkModel, OperatingRule, Scenario } from "../domain/types";
import type { NetworkSpec } from "../library/models";

export type WorkspaceView = "overview" | "map" | "network" | "flows" | "compare" | "findings" | "data" | "library" | "history";

export interface PendingSetup {
  spec: Partial<NetworkSpec>;
  name?: string;
  asked: ("location" | "goal")[];
  answers: { country?: string; goal?: string };
}

export interface AgentContext {
  /** Model currently in view (baseline or the active scenario's evaluated model). */
  model: NetworkModel | null;
  metrics: NetworkMetrics | null;
  findings: Finding[];
  /** The baseline, which every scenario is evaluated against. */
  baseline: NetworkModel | null;
  baselineMetrics: NetworkMetrics | null;
  scenarios: Scenario[];
  activeScenarioId: string | null;
  scenarioSummaries: { id: string; name: string; headline: string; netAnnualDelta: number }[];
  selection: { nodeId?: string; laneId?: string; findingId?: string } | null;
  pendingSetup: PendingSetup | null;
}

export type AgentAction =
  | { type: "load_model"; model: NetworkModel }
  | { type: "create_scenario"; scenario: Scenario; activate: boolean }
  | { type: "set_view"; view: WorkspaceView }
  | { type: "select"; nodeId?: string; laneId?: string; findingId?: string }
  | { type: "export_excel" }
  | { type: "add_rule"; rule: OperatingRule }
  | { type: "set_pending"; pending: PendingSetup | null }
  | { type: "set_overlay"; overlay: "volume" | "cost" | "emissions" | "confidence" | "risk" };

export interface AgentReply {
  text: string;
  actions: AgentAction[];
  chips?: string[];
  assumptions?: string[];
  changed?: string[];
  confidence?: "high" | "medium" | "low" | "insufficient";
}

export interface AgentProvider {
  readonly name: string;
  respond(message: string, ctx: AgentContext): Promise<AgentReply>;
}
