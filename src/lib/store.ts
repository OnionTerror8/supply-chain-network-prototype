"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AgentAction, AgentContext, AgentReply, PendingSetup, WorkspaceView } from "./agent/types";
import { RuleBasedAgent } from "./agent/rule-agent";
import { buildFoodSample } from "./data/food-sample";
import { buildRetailSample } from "./data/retail-sample";
import { cloneModel, uid, userValue } from "./domain/helpers";
import type {
  ChangeLogEntry,
  Finding,
  FindingCategory,
  Lane,
  NetworkMetrics,
  NetworkModel,
  NetworkNode,
  NodeType,
  OperatingRule,
  Scenario,
  ScenarioChange,
  Temperature,
} from "./domain/types";
import { detectFindings } from "./engine/findings";
import { computeMetrics } from "./engine/metrics";
import { applyChange, evaluateScenario, type Comparison } from "./engine/scenarios";
import { downloadWorkbook } from "./export/excel";

export type Overlay = "volume" | "cost" | "emissions" | "confidence" | "risk";

export interface Selection {
  nodeId?: string;
  laneId?: string;
  findingId?: string;
}

export interface Filters {
  productFamily: string | null;
  temperature: Temperature | null;
  region: string | null;
  nodeTypes: NodeType[];
  riskCategory: FindingCategory | null;
  channel: "all" | "retail" | "ecom" | "wholesale";
  horizon: "average" | "peak";
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  at: string;
  chips?: string[];
  assumptions?: string[];
  confidence?: AgentReply["confidence"];
}

export interface ScenarioResult {
  model: NetworkModel;
  metrics: NetworkMetrics;
  findings: Finding[];
  comparison: Comparison;
  log: string[];
}

interface WorkspaceState {
  hydrated: boolean;
  baseline: NetworkModel | null;
  baselineMetrics: NetworkMetrics | null;
  baselineFindings: Finding[];
  scenarios: Scenario[];
  scenarioResults: Record<string, ScenarioResult>;
  activeScenarioId: string | null;
  view: WorkspaceView;
  overlay: Overlay;
  selection: Selection | null;
  hoverId: string | null;
  filters: Filters;
  inspectorOpen: boolean;
  agentOpen: boolean;
  messages: ChatMessage[];
  pendingSetup: PendingSetup | null;
  agentBusy: boolean;
  changeLog: ChangeLogEntry[];
  modelVersion: number;

  // lifecycle
  setHydrated: () => void;
  loadSample: (which: "food" | "retail") => void;
  loadModel: (model: NetworkModel, summary: string, actor?: ChangeLogEntry["actor"]) => void;
  resetWorkspace: () => void;

  // navigation
  setView: (v: WorkspaceView) => void;
  setOverlay: (o: Overlay) => void;
  select: (s: Selection | null) => void;
  setHover: (id: string | null) => void;
  setFilters: (f: Partial<Filters>) => void;
  setInspectorOpen: (open: boolean) => void;
  setAgentOpen: (open: boolean) => void;

  // editing
  setActiveScenario: (id: string | null) => void;
  updateNode: (nodeId: string, patch: Partial<NetworkNode>, label: string) => void;
  moveNode: (nodeId: string, lat: number, lng: number) => void;
  addNode: (node: NetworkNode) => void;
  removeNode: (nodeId: string) => void;
  addLane: (lane: Lane) => void;
  updateLane: (laneId: string, patch: Partial<Lane>, label: string) => void;
  removeLane: (laneId: string) => void;
  addRule: (rule: OperatingRule) => void;
  toggleRule: (ruleId: string) => void;
  createScenario: (s: Scenario, activate?: boolean) => void;
  createScenarioFromChanges: (name: string, description: string, changes: ScenarioChange[]) => void;
  confirmScenario: (id: string) => void;
  discardScenario: (id: string) => void;
  promoteScenario: (id: string) => void;

  // agent
  sendMessage: (text: string) => Promise<void>;
  applyAgentActions: (actions: AgentAction[]) => void;
  exportExcel: () => void;
}

const defaultFilters: Filters = { productFamily: null, temperature: null, region: null, nodeTypes: [], riskCategory: null, channel: "all", horizon: "average" };

const welcome = (): ChatMessage => ({
  id: uid("msg"),
  role: "agent",
  text: "I am the Meridian planning agent. Describe your supply chain in plain language and I will build the baseline network, flag pinchpoints and data gaps, and model alternatives against it. Nothing changes the baseline without your confirmation.",
  at: new Date().toISOString(),
  chips: [
    "Build my current network from this description: we buy raw material from five suppliers, receive it into two factories, send finished goods via a national DC to regional DCs, then to stores. Some e-commerce orders ship from the national DC. We have significant seasonal demand and cold-chain requirements.",
    "Where is our biggest resilience risk?",
    "What happens if we add a regional DC in Birmingham?",
  ],
});

function log(actor: ChangeLogEntry["actor"], scope: ChangeLogEntry["scope"], summary: string, details?: string[], scenarioId?: string): ChangeLogEntry {
  return { id: uid("log"), at: new Date().toISOString(), actor, scope, scenarioId, summary, details };
}

function evaluateAll(baseline: NetworkModel, scenarios: Scenario[]) {
  const baselineMetrics = computeMetrics(baseline);
  const baselineFindings = detectFindings(baseline, baselineMetrics);
  const scenarioResults: Record<string, ScenarioResult> = {};
  for (const s of scenarios) {
    try {
      const r = evaluateScenario(baseline, baselineMetrics, s);
      scenarioResults[s.id] = { ...r, findings: detectFindings(r.model, r.metrics) };
    } catch (e) {
      console.error("Scenario evaluation failed", s.name, e);
    }
  }
  return { baselineMetrics, baselineFindings, scenarioResults };
}

const localAgent = new RuleBasedAgent();

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const recompute = (patch: Partial<WorkspaceState> = {}) => {
        const s = { ...get(), ...patch };
        if (!s.baseline) {
          set({ ...patch, baselineMetrics: null, baselineFindings: [], scenarioResults: {}, modelVersion: s.modelVersion + 1 });
          return;
        }
        const derived = evaluateAll(s.baseline, s.scenarios);
        set({ ...patch, ...derived, modelVersion: s.modelVersion + 1 });
      };

      /** Route an edit either to the baseline (direct, logged) or to the active scenario (as a change). */
      const routeEdit = (change: ScenarioChange, summary: string) => {
        const { baseline, activeScenarioId, scenarios } = get();
        if (!baseline) return;
        if (activeScenarioId) {
          const next = scenarios.map((s) => (s.id === activeScenarioId ? { ...s, changes: [...s.changes, change] } : s));
          recompute({ scenarios: next, changeLog: [log("user", "scenario", summary, undefined, activeScenarioId), ...get().changeLog] });
        } else {
          const model = cloneModel(baseline);
          const details = applyChange(model, change);
          recompute({ baseline: model, changeLog: [log("user", "baseline", summary, details), ...get().changeLog] });
        }
      };

      return {
        hydrated: false,
        baseline: null,
        baselineMetrics: null,
        baselineFindings: [],
        scenarios: [],
        scenarioResults: {},
        activeScenarioId: null,
        view: "overview",
        overlay: "volume",
        selection: null,
        hoverId: null,
        filters: defaultFilters,
        inspectorOpen: false,
        agentOpen: true,
        messages: [welcome()],
        pendingSetup: null,
        agentBusy: false,
        changeLog: [],
        modelVersion: 0,

        setHydrated: () => {
          recompute({ hydrated: true });
        },
        loadSample: (which) => {
          const model = which === "food" ? buildFoodSample() : buildRetailSample();
          get().loadModel(model, `Loaded sample network “${model.name}”`, "system");
          set({ view: "overview" });
        },
        loadModel: (model, summary, actor = "user") => {
          recompute({
            baseline: model,
            scenarios: [],
            activeScenarioId: null,
            selection: null,
            filters: defaultFilters,
            changeLog: [log(actor, "baseline", summary, [`${model.nodes.length} nodes, ${model.lanes.length} lanes, ${model.productFamilies.length} product families`]), ...get().changeLog],
          });
        },
        resetWorkspace: () => {
          set({ baseline: null, baselineMetrics: null, baselineFindings: [], scenarios: [], scenarioResults: {}, activeScenarioId: null, selection: null, messages: [welcome()], pendingSetup: null, changeLog: [], view: "overview", filters: defaultFilters });
        },

        setView: (view) => set({ view }),
        setOverlay: (overlay) => set({ overlay }),
        select: (selection) => set({ selection, inspectorOpen: !!selection }),
        setHover: (hoverId) => set({ hoverId }),
        setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
        setInspectorOpen: (inspectorOpen) => set({ inspectorOpen, ...(inspectorOpen ? {} : { selection: null }) }),
        setAgentOpen: (agentOpen) => set({ agentOpen }),

        setActiveScenario: (id) => set({ activeScenarioId: id }),
        updateNode: (nodeId, patch, label) => {
          const model = get().activeScenarioId ? get().scenarioResults[get().activeScenarioId!]?.model : get().baseline;
          const node = model?.nodes.find((n) => n.id === nodeId);
          routeEdit({ type: "update_node", nodeId, patch, label }, `Edited ${node?.name ?? nodeId}: ${label}`);
        },
        moveNode: (nodeId, lat, lng) => {
          const model = get().activeScenarioId ? get().scenarioResults[get().activeScenarioId!]?.model : get().baseline;
          const node = model?.nodes.find((n) => n.id === nodeId);
          if (!node) return;
          routeEdit({ type: "update_node", nodeId, patch: { location: { ...node.location, lat, lng, source: "user" } }, label: `moved to ${lat.toFixed(2)}, ${lng.toFixed(2)}` }, `Moved ${node.name} to ${lat.toFixed(2)}, ${lng.toFixed(2)}`);
        },
        addNode: (node) => routeEdit({ type: "add_node", node }, `Added ${node.name}`),
        removeNode: (nodeId) => {
          const model = get().activeScenarioId ? get().scenarioResults[get().activeScenarioId!]?.model : get().baseline;
          const node = model?.nodes.find((n) => n.id === nodeId);
          routeEdit({ type: "remove_node", nodeId, reassign: true }, `Removed ${node?.name ?? nodeId} (flows reassigned to nearest alternative)`);
          set({ selection: null, inspectorOpen: false });
        },
        addLane: (lane) => {
          const model = get().activeScenarioId ? get().scenarioResults[get().activeScenarioId!]?.model : get().baseline;
          const f = model?.nodes.find((n) => n.id === lane.from)?.name;
          const t = model?.nodes.find((n) => n.id === lane.to)?.name;
          routeEdit({ type: "add_lane", lane }, `Added lane ${f} → ${t}`);
        },
        updateLane: (laneId, patch, label) => routeEdit({ type: "update_lane", laneId, patch, label }, `Edited lane: ${label}`),
        removeLane: (laneId) => {
          routeEdit({ type: "remove_lane", laneId }, `Removed lane ${laneId}`);
          set({ selection: null, inspectorOpen: false });
        },
        addRule: (rule) => routeEdit({ type: "add_rule", rule }, `Added rule: ${rule.text}`),
        toggleRule: (ruleId) => {
          const { baseline } = get();
          if (!baseline) return;
          const model = cloneModel(baseline);
          const r = model.rules.find((x) => x.id === ruleId);
          if (!r) return;
          r.active = !r.active;
          recompute({ baseline: model, changeLog: [log("user", "baseline", `${r.active ? "Enabled" : "Disabled"} rule: ${r.text}`), ...get().changeLog] });
        },
        createScenario: (s, activate = true) => {
          recompute({ scenarios: [...get().scenarios, s], activeScenarioId: activate ? s.id : get().activeScenarioId, changeLog: [log(s.createdBy, "scenario", `Created scenario “${s.name}”`, [s.description], s.id), ...get().changeLog] });
        },
        createScenarioFromChanges: (name, description, changes) => {
          const s: Scenario = { id: uid("scn"), name, description, changes, createdAt: new Date().toISOString(), createdBy: "user", status: "draft", enablers: [], limitations: [] };
          get().createScenario(s, true);
          set({ view: "compare" });
        },
        confirmScenario: (id) => {
          const s = get().scenarios.find((x) => x.id === id);
          set({ scenarios: get().scenarios.map((x) => (x.id === id ? { ...x, status: "confirmed" } : x)), changeLog: [log("user", "scenario", `Confirmed scenario “${s?.name}” for review`, undefined, id), ...get().changeLog] });
        },
        discardScenario: (id) => {
          const s = get().scenarios.find((x) => x.id === id);
          const scenarios = get().scenarios.filter((x) => x.id !== id);
          const results = { ...get().scenarioResults };
          delete results[id];
          set({ scenarios, scenarioResults: results, activeScenarioId: get().activeScenarioId === id ? null : get().activeScenarioId, changeLog: [log("user", "scenario", `Discarded scenario “${s?.name}”`, undefined, id), ...get().changeLog] });
        },
        promoteScenario: (id) => {
          const r = get().scenarioResults[id];
          const s = get().scenarios.find((x) => x.id === id);
          if (!r || !s) return;
          const model = cloneModel(r.model);
          model.id = uid("model");
          model.name = get().baseline?.name ?? model.name;
          const scenarios = get().scenarios.filter((x) => x.id !== id);
          recompute({ baseline: model, scenarios, activeScenarioId: null, changeLog: [log("user", "baseline", `Promoted scenario “${s.name}” to the new baseline`, r.log, id), ...get().changeLog] });
        },

        applyAgentActions: (actions) => {
          for (const a of actions) {
            switch (a.type) {
              case "load_model":
                get().loadModel(a.model, `Agent built network “${a.model.name}” from your description`, "agent");
                break;
              case "create_scenario":
                get().createScenario(a.scenario, a.activate);
                break;
              case "set_view":
                set({ view: a.view });
                break;
              case "select":
                set({ selection: { nodeId: a.nodeId, laneId: a.laneId, findingId: a.findingId }, inspectorOpen: true });
                break;
              case "export_excel":
                get().exportExcel();
                break;
              case "add_rule": {
                const { baseline } = get();
                if (!baseline) break;
                const model = cloneModel(baseline);
                model.rules.push(a.rule);
                recompute({ baseline: model, changeLog: [log("agent", "baseline", `Added rule: ${a.rule.text}`), ...get().changeLog] });
                break;
              }
              case "set_pending":
                set({ pendingSetup: a.pending });
                break;
              case "set_overlay":
                set({ overlay: a.overlay });
                break;
            }
          }
        },

        sendMessage: async (text) => {
          const trimmed = text.trim();
          if (!trimmed || get().agentBusy) return;
          const userMsg: ChatMessage = { id: uid("msg"), role: "user", text: trimmed, at: new Date().toISOString() };
          set({ messages: [...get().messages, userMsg], agentBusy: true, agentOpen: true });
          const s = get();
          const activeMetrics = s.activeScenarioId ? s.scenarioResults[s.activeScenarioId]?.metrics ?? s.baselineMetrics : s.baselineMetrics;
          const activeModel = s.activeScenarioId ? s.scenarioResults[s.activeScenarioId]?.model ?? s.baseline : s.baseline;
          const activeFindings = s.activeScenarioId ? s.scenarioResults[s.activeScenarioId]?.findings ?? s.baselineFindings : s.baselineFindings;
          const ctx: AgentContext = {
            model: activeModel,
            metrics: activeMetrics,
            findings: activeFindings,
            baseline: s.baseline,
            baselineMetrics: s.baselineMetrics,
            scenarios: s.scenarios,
            activeScenarioId: s.activeScenarioId,
            scenarioSummaries: s.scenarios.map((sc) => ({ id: sc.id, name: sc.name, headline: s.scenarioResults[sc.id]?.comparison.headline ?? "", netAnnualDelta: s.scenarioResults[sc.id]?.comparison.netAnnualDelta ?? 0 })),
            selection: s.selection,
            pendingSetup: s.pendingSetup,
          };
          let reply: AgentReply;
          try {
            const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: trimmed, context: ctx }) });
            if (!res.ok) throw new Error(`Agent API ${res.status}`);
            reply = (await res.json()) as AgentReply;
          } catch {
            reply = await localAgent.respond(trimmed, ctx);
          }
          get().applyAgentActions(reply.actions);
          const agentMsg: ChatMessage = { id: uid("msg"), role: "agent", text: reply.text, at: new Date().toISOString(), chips: reply.chips, assumptions: reply.assumptions, confidence: reply.confidence };
          set({ messages: [...get().messages, agentMsg], agentBusy: false });
        },

        exportExcel: () => {
          const s = get();
          if (!s.baseline || !s.baselineMetrics) return;
          const active = s.activeScenarioId ? s.scenarioResults[s.activeScenarioId] : undefined;
          const scenario = s.activeScenarioId ? s.scenarios.find((x) => x.id === s.activeScenarioId) : undefined;
          downloadWorkbook({
            model: s.baseline,
            metrics: s.baselineMetrics,
            findings: s.baselineFindings,
            scenario: active && scenario ? { scenario, model: active.model, metrics: active.metrics, comparison: active.comparison } : undefined,
            changeLog: s.changeLog,
          });
          set({ changeLog: [log("user", s.activeScenarioId ? "scenario" : "baseline", `Exported workbook${scenario ? ` including scenario “${scenario.name}”` : ""}`), ...s.changeLog] });
        },
      };
    },
    {
      name: "meridian-workspace-v1",
      storage: createJSONStorage(() => (typeof window === "undefined" ? { getItem: () => null, setItem: () => {}, removeItem: () => {} } : localStorage)),
      skipHydration: true,
      partialize: (s) => ({ baseline: s.baseline, scenarios: s.scenarios, activeScenarioId: s.activeScenarioId, messages: s.messages.slice(-60), changeLog: s.changeLog.slice(0, 200), view: s.view, pendingSetup: s.pendingSetup }),
    },
  ),
);

/** Convenience selectors for the model currently in view. */
export function useActive() {
  const baseline = useWorkspace((s) => s.baseline);
  const baselineMetrics = useWorkspace((s) => s.baselineMetrics);
  const baselineFindings = useWorkspace((s) => s.baselineFindings);
  const activeScenarioId = useWorkspace((s) => s.activeScenarioId);
  const scenarioResults = useWorkspace((s) => s.scenarioResults);
  const scenarios = useWorkspace((s) => s.scenarios);
  const result = activeScenarioId ? scenarioResults[activeScenarioId] : undefined;
  const scenario = activeScenarioId ? scenarios.find((s) => s.id === activeScenarioId) : undefined;
  return {
    baseline,
    baselineMetrics,
    baselineFindings,
    model: result?.model ?? baseline,
    metrics: result?.metrics ?? baselineMetrics,
    findings: result?.findings ?? baselineFindings,
    scenario,
    result,
    isScenario: !!result,
  };
}

export const quickNode = (type: NodeType, name: string, lat: number, lng: number, temperature: Temperature = "ambient"): NetworkNode => ({
  id: uid("node"),
  name,
  type,
  temperature,
  location: { lat, lng, country: "GB", source: "user" },
  operator: userValue("Own"),
});
