import { findPlace, findRegion, placeToLocation } from "../domain/geo";
import { aiEstimate, assumed, fmtMoney, fmtNum, fmtPct, uid } from "../domain/helpers";
import { COST_COMPONENT_LABEL, NODE_TYPE_META, PROVENANCE_LABEL, type Finding, type NetworkModel, type NodeType, type OperatingRule, type Scenario, type ScenarioChange } from "../domain/types";
import { costToServe } from "../engine/metrics";
import { evaluateScenario } from "../engine/scenarios";
import { DISTRIBUTION_MODELS, type NetworkSpec } from "../library/models";
import { buildNetworkFromSpec } from "./network-builder";
import { matchNode, parseSpecFromText, percentIn } from "./parse";
import type { AgentAction, AgentContext, AgentProvider, AgentReply, PendingSetup } from "./types";

const now = () => new Date().toISOString();

function scenario(name: string, description: string, changes: ScenarioChange[], extra: Partial<Scenario> = {}): Scenario {
  return { id: uid("scn"), name, description, changes, createdAt: now(), createdBy: "agent", status: "draft", enablers: [], limitations: [], ...extra };
}

const SCENARIO_FOOTER = "\n\nThis is a **draft scenario**: the baseline is untouched. Review the comparison, then confirm or discard it.";

function noModel(): AgentReply {
  return {
    text: "There is no network loaded yet. Describe your supply chain in a sentence or two and I will build the baseline, or load one of the sample networks.",
    actions: [],
    chips: ["Build my current network from this description: we buy raw material from five suppliers, receive it into two factories, send finished goods via a national DC to regional DCs, then to stores. Some e-commerce orders ship from the national DC. We have significant seasonal demand and cold-chain requirements.", "Create a regional distribution model with a national DC feeding four regional DCs, cross-docking fast-moving lines, milk runs for supplier collections, and direct-to-store deliveries for chilled products."],
  };
}

export class RuleBasedAgent implements AgentProvider {
  readonly name = "Meridian planner (rule-based)";

  async respond(message: string, ctx: AgentContext): Promise<AgentReply> {
    const reply = await this.respondInner(message, ctx);
    return this.attachScenarioResults(reply, ctx);
  }

  /** Evaluate any scenario the reply creates and append a plain-language result so the user never has to guess. */
  private attachScenarioResults(reply: AgentReply, ctx: AgentContext): AgentReply {
    const baseline = ctx.baseline ?? ctx.model;
    const baseMetrics = ctx.baselineMetrics ?? ctx.metrics;
    if (!baseline || !baseMetrics) return reply;
    const created = reply.actions.filter((a) => a.type === "create_scenario");
    if (!created.length) return reply;
    let text = reply.text;
    const changed: string[] = [];
    for (const a of created) {
      if (a.type !== "create_scenario") continue;
      try {
        const { comparison, log } = evaluateScenario(baseline, baseMetrics, a.scenario);
        changed.push(...log);
        const what = log.slice(0, 5).map((l) => `- ${l}`).join("\n") + (log.length > 5 ? `\n- …and ${log.length - 5} more changes (see the change log).` : "");
        text = text.replace(SCENARIO_FOOTER, "") + `\n\n**What changed**\n${what}\n\n**Result vs baseline: ${comparison.headline}**\n${comparison.benefits.slice(0, 3).map((b) => `- ✓ ${b}`).join("\n")}\n${comparison.tradeOffs.slice(0, 3).map((t) => `- ✗ ${t}`).join("\n")}\n\nConfidence in this comparison: **${comparison.confidence}** — ${comparison.confidenceNote}${SCENARIO_FOOTER}`;
      } catch (e) {
        console.error("Scenario preview failed", e);
      }
    }
    return { ...reply, text, changed };
  }

  private async respondInner(message: string, ctx: AgentContext): Promise<AgentReply> {
    const raw = message.trim();
    const t = raw.toLowerCase();

    // Pending guided setup takes priority.
    if (ctx.pendingSetup) {
      const p = ctx.pendingSetup;
      const place = findPlace(raw);
      const country = /\buk\b|britain|england|united kingdom|scotland|wales/.test(t) ? "GB" : place?.country;
      const goal = detectGoal(t);
      const skip = /assum|default|just build|go ahead|build it|proceed|skip|no more|that's all|yes/.test(t);
      const answers = { ...p.answers, ...(country ? { country } : {}), ...(goal ? { goal } : {}) };
      const needsLocation = !answers.country && !skip;
      const needsGoal = !answers.goal && !skip;
      if (needsLocation || needsGoal) {
        const qs: string[] = [];
        if (needsLocation) qs.push("**Where is the network?** (country or main regions — I will place facilities at typical UK logistics locations if you prefer)");
        if (needsGoal) qs.push("**What is the primary goal?** reduce cost, improve service, reduce risk, lower emissions, add capacity, or compare routes to market");
        return {
          text: `Noted. ${qs.length === 2 ? "Two" : "One"} more thing${qs.length === 2 ? "s" : ""} would materially change the model:\n\n${qs.map((q) => `- ${q}`).join("\n")}\n\nOr say “use assumptions” and I will build it now and flag every default.`,
          actions: [{ type: "set_pending", pending: { ...p, answers } }],
          chips: [...(needsLocation ? ["UK"] : []), ...(needsGoal ? ["Reduce cost", "Improve service", "Reduce risk"] : []), "Use assumptions and build"],
        };
      }
      return this.buildFromSpec({ ...p.spec, country: answers.country ?? "GB" }, p.name, answers.goal, answers.country === undefined);
    }

    // Guided network creation from a description.
    if (looksLikeDescription(t)) {
      const spec = parseSpecFromText(raw);
      const libMatch = DISTRIBUTION_MODELS.find((m) => t.includes(m.name.toLowerCase().split(" ")[0]) && t.includes("model"));
      if (libMatch?.spec) Object.assign(spec, { ...libMatch.spec, ...spec });
      const place = findPlace(raw);
      const goal = detectGoal(t);
      const explicitUK = /\buk\b|britain|england|united kingdom/.test(t);
      if ((place || explicitUK) && goal) return this.buildFromSpec({ ...spec, country: place?.country ?? "GB" }, undefined, goal, false);
      if (/create|set up|design|build/.test(t) && /model|network/.test(t) && libMatch) {
        // Library-style instruction: build immediately, then ask for essentials.
        return this.buildFromSpec({ ...spec, country: "GB" }, `${libMatch.name} (draft)`, goal, true);
      }
      const pending: PendingSetup = { spec, asked: ["location", "goal"], answers: { ...(place || explicitUK ? { country: place?.country ?? "GB" } : {}), ...(goal ? { goal } : {}) } };
      const understood = describeUnderstanding(spec);
      const qs: string[] = [];
      if (!pending.answers.country) qs.push("**Where is the network?** Country or main regions. If you do not say, I will place facilities at typical UK logistics locations.");
      if (!pending.answers.goal) qs.push("**What is the primary goal?** Reduce cost, improve service, reduce risk, lower emissions, add capacity, or compare routes to market.");
      return {
        text: `Here is what I understood:\n\n${understood}\n\nBefore I build it, ${qs.length === 2 ? "two questions" : "one question"} would materially change the model:\n\n${qs.map((q) => `- ${q}`).join("\n")}\n\nEverything else (volumes, capacities, costs) I will estimate and label as assumptions you can overwrite.`,
        actions: [{ type: "set_pending", pending }],
        chips: [...(!pending.answers.country ? ["UK, mainly England"] : []), ...(!pending.answers.goal ? ["Reduce cost", "Improve service", "Reduce risk"] : []), "Use assumptions and build"],
      };
    }

    // Library instantiation: "create a cross-docking model" etc.
    if (/^(create|build|set up|design|instantiate|start) (a |an |the )?/.test(t) && /model|network|template/.test(t)) {
      const lib = DISTRIBUTION_MODELS.find((m) => t.includes(m.name.toLowerCase()) || t.includes(m.id.replace("_", " ")) || t.includes(m.id.replace("_", "-")));
      if (lib) {
        const spec = { ...(lib.spec ?? {}), ...parseSpecFromText(raw), country: "GB" };
        return this.buildFromSpec(spec, `${lib.name} (draft)`, detectGoal(t), true, lib.name);
      }
    }

    if (/export|excel|spreadsheet|xlsx|download/.test(t)) {
      return { text: ctx.model ? "Exporting the workbook now. It contains the executive summary, cost comparison, nodes, lanes, findings, assumptions and the change log, with every value tagged by its data source." : "Load or build a network first, then I can export it.", actions: ctx.model ? [{ type: "export_excel" }] : [] };
    }

    if (!ctx.model || !ctx.metrics) return noModel();
    const model = ctx.model;
    const m = ctx.metrics;
    const cur = model.currency;
    const money = (v: number) => fmtMoney(v, cur);

    /* ---------- Scenario requests ---------- */

    // Add a facility in <place>
    {
      const add = t.match(/\b(add|open|build|put|create)\b.*?\b(regional dc|rdc|national dc|ndc|distribution cent(?:re|er)|warehouse|depot|hub|cross-?dock|dc|fulfil(?:l)?ment cent(?:re|er)|fc|micro-?fulfil(?:l)?ment|dark store|cold store)\b.*?\b(in|at|near)\b\s+([a-z' -]+)/i);
      if (add) {
        const place = findPlace(add[4]) ?? findPlace(raw);
        if (!place) return { text: `I could not place “${add[4].trim()}”. Try a city name (for example Birmingham, Leeds or Bristol) and I will add it, or drag a node onto the map and I will pick it up from there.`, actions: [] };
        const kind = add[2].toLowerCase();
        const type: NodeType = /cross/.test(kind) ? "cross_dock" : /national|ndc/.test(kind) ? "national_dc" : /fulfil|fc/.test(kind) ? "ecom_fc" : /micro/.test(kind) ? "micro_fc" : /dark/.test(kind) ? "dark_store" : /cold/.test(kind) ? "cold_store" : "regional_dc";
        const feeder = model.nodes.find((n) => n.type === "national_dc") ?? model.nodes.find((n) => n.type === "factory");
        const chilled = model.productFamilies.some((f) => f.temperature === "chilled");
        const weekly = m.annualCases / model.parameters.weeksPerYear;
        const sized = Math.max(10_000, Math.round((weekly * 0.15) / 5000) * 5000);
        const node = {
          id: uid("node"),
          name: `${place.city} ${type === "cross_dock" ? "Cross-dock" : type === "national_dc" ? "National DC" : type === "ecom_fc" ? "E-commerce FC" : "RDC"} (proposed)`,
          type,
          temperature: chilled ? ("chilled" as const) : ("ambient" as const),
          location: placeToLocation(place, "ai"),
          capacityPerWeek: assumed(sized, "Sized at ~15% of network weekly volume ÷ 70% utilisation; confirm with site study"),
          inventoryDays: assumed(type === "cross_dock" ? 0.3 : chilled ? 2.5 : 8, "Typical for this facility type"),
          fixedCostPerYear: assumed(Math.round(sized * (type === "cross_dock" ? 18 : 52)), `Benchmark £${type === "cross_dock" ? 18 : 52} per case-week capacity`),
          handlingCostPerCase: assumed(type === "cross_dock" ? 0.28 : 0.5, "Industry benchmark"),
          reliability: assumed(0.94, "Network default"),
          operator: assumed("3PL"),
        };
        const sc = scenario(
          `Add ${place.city} ${type === "cross_dock" ? "cross-dock" : type === "national_dc" ? "NDC" : "RDC"}`,
          `Add a ${type.replace("_", " ")} in ${place.city}${feeder ? `, fed from ${feeder.name}` : ""}, serving the customers that are materially nearer to it than to their current source.`,
          [{ type: "add_node", node, serveNearest: ["store", "customer_zone", "wholesaler"], feedFrom: feeder?.id }],
          { enablers: ["Site search and lease or 3PL contract", "Trunk schedule from the feeding site", "Customer delivery-day re-planning"] },
        );
        return {
          text: `I have created a draft scenario **${sc.name}**.\n\n**What I did**\n- Placed a ${type.replace("_", " ")} at ${place.city} (${place.region}).\n- Reassigned any customer that is at least 25% nearer to ${place.city} than to its current source.\n- Added a trunk lane${feeder ? ` from ${feeder.name}` : ""} sized to the reassigned volume and rebalanced upstream flows.\n\n**Assumptions to check**\n- Capacity ${fmtNum(sized)} cases/week, fixed cost ${money(node.fixedCostPerYear.value)}/yr, handling ${money(node.handlingCostPerCase.value)}/case — all benchmarks until you have a quote.\n- New lane costs are estimated from distance at the network rate.${SCENARIO_FOOTER}`,
          actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }],
          assumptions: ["Capacity sized from network volume", "Benchmark fixed and handling costs", "Nearest-facility reassignment, not optimised"],
          chips: ["Which assumptions are driving the result?", "Explain this scenario for an executive audience", "Export the cost comparison to Excel"],
          confidence: "low",
        };
      }
    }

    // Demand change
    {
      const pct = percentIn(t);
      const dm = /demand|volume|sales|orders/.test(t) && pct !== undefined && /(rise|increase|grow|up|fall|drop|decline|decrease|down|\+|-)/.test(t);
      if (dm) {
        const down = /(fall|drop|decline|decrease|down|-\s*\d)/.test(t) && !/(rise|increase|grow|up\b|\+)/.test(t);
        const factor = 1 + (down ? -pct : pct) / 100;
        const regionName = findRegion(t);
        const region = regionName ? model.regions.find((r) => r.name.toLowerCase().includes(regionName.toLowerCase().split(" ")[0]) || regionName.toLowerCase().includes(r.name.toLowerCase().split(" ")[0])) : undefined;
        const fam = model.productFamilies.find((f) => t.includes(f.name.toLowerCase().split(" ")[0]) && f.id !== "returns");
        const label = `Demand ${down ? "−" : "+"}${pct}%${region ? ` in ${region.name}` : ""}${fam ? ` for ${fam.name}` : ""}`;
        const sc = scenario(label, `${label}. Customer lane volumes scaled by ${factor.toFixed(2)} and upstream flows rebalanced to match.`, [{ type: "demand_change", factor, regionId: region?.id, productFamilyId: fam?.id, label }], { enablers: ["Confirm the forecast with commercial teams", "Check facility capacity at peak, not just average"] });
        return {
          text: `Draft scenario **${label}** created.\n\n**What I did**\n- Scaled ${region ? `deliveries into ${region.name}` : "all customer deliveries"}${fam ? ` for ${fam.name}` : ""} by ${factor.toFixed(2)}×.\n- Rebalanced every upstream lane so each facility's inbound follows its outbound.\n\n**What to look at**\n- Facility utilisation: any node crossing the ${fmtPct(model.parameters.constrainedUtilisation.value)} threshold becomes a pinchpoint.\n- Cost per case and service level in the comparison.${regionName && !region ? `\n\nI could not match “${regionName}” to a defined region, so I applied the change network-wide.` : ""}${SCENARIO_FOOTER}`,
          actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }],
          chips: ["Where is our biggest resilience risk?", "Which facilities are now constrained?", "Export the cost comparison to Excel"],
          confidence: "medium",
        };
      }
    }

    // Capacity: "what would happen if this DC operated at 90% capacity"
    {
      const pct = percentIn(t);
      if (pct !== undefined && /capacity|utilis|utiliz/.test(t) && !/demand/.test(t)) {
        const node = (ctx.selection?.nodeId ? model.nodes.find((n) => n.id === ctx.selection!.nodeId) : undefined) ?? matchNode(model, raw) ?? model.nodes.find((n) => n.type === "national_dc");
        if (!node) return { text: "Which facility do you mean? Select it in any view or name it, for example “Daventry National DC”.", actions: [] };
        const nm = m.nodeMetrics[node.id];
        const newCap = Math.round(nm.throughputPerWeek / (pct / 100));
        const sc = scenario(`${node.name} at ${pct}% utilisation`, `Set ${node.name}'s effective capacity so that current throughput represents ${pct}% utilisation (${fmtNum(newCap)} cases/week).`, [{ type: "update_node", nodeId: node.id, patch: { capacityPerWeek: aiEstimate(newCap, `Scenario: throughput ÷ ${pct}%`) }, label: `capacity → ${fmtNum(newCap)} cases/wk (${pct}% utilisation)` }]);
        const current = nm.utilisation ? fmtPct(nm.utilisation) : "unknown (no capacity recorded)";
        return {
          text: `Draft scenario created: **${sc.name}**.\n\nToday ${node.name} runs at ${current} with ${fmtNum(nm.throughputPerWeek)} cases/week. At ${pct}% the model ${pct >= 85 ? `treats it as constrained: service degrades by roughly ${((pct / 100 - model.parameters.constrainedUtilisation.value) * 50).toFixed(1)} points on flows through it and the risk score rises` : "has headroom to absorb peaks and disruptions"}.${SCENARIO_FOOTER}`,
          actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }, { type: "select", nodeId: node.id }],
          confidence: nm.utilisation ? "medium" : "low",
        };
      }
    }

    // Lose / remove a node
    {
      if (/\b(lose|loses|lost|losing|remove|removing|close|closing|shut|without|fails|outage|strike|goes down|drop)\b/.test(t) && !/demand/.test(t)) {
        const hint = /port/.test(t) ? (["port"] as const) : /supplier|grower|farm/.test(t) ? (["supplier", "farm"] as const) : /warehouse|dc|rdc|depot/.test(t) ? (["regional_dc", "national_dc", "cross_dock", "cold_store", "ecom_fc"] as const) : undefined;
        const selected = ctx.selection?.nodeId ? model.nodes.find((n) => n.id === ctx.selection!.nodeId) : undefined;
        const node = (/\bthis\b/.test(t) && selected) || matchNode(model, raw, hint ? [...hint] : undefined) || (/low-volume|smallest|low volume/.test(t) ? lowestVolumeDc(model, m) : undefined) || selected;
        if (node) {
          const sc = scenario(`Lose ${node.name}`, `Stress test: ${node.name} is unavailable. Its volume is reassigned to the nearest alternative where one exists; otherwise it is flagged as unserved.`, [{ type: "remove_node", nodeId: node.id, reassign: true }], { enablers: ["Contingency contracts with alternative sources or sites", "Pre-agreed customer allocation rules during disruption"] });
          const nm = m.nodeMetrics[node.id];
          return {
            text: `Draft scenario **${sc.name}** created.\n\n${node.name} handles ${fmtNum(nm.throughputPerWeek)} cases/week. I removed it and all its lanes, then reassigned each affected flow to the nearest comparable facility, estimating new lane costs from distance. Where there is no alternative, the volume is flagged as unserved and priced at the stock-out cost.${SCENARIO_FOOTER}`,
            actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }, { type: "select", nodeId: node.id }],
            chips: ["Where is our biggest resilience risk?", "What information would most improve confidence in this recommendation?"],
            confidence: "medium",
          };
        }
      }
    }

    // Direct-to-store for a product family
    if (/direct.to.store|direct store|dsd\b|direct deliver/.test(t)) {
      const fam = model.productFamilies.find((f) => t.includes(f.name.toLowerCase().split(" ")[0])) ?? model.productFamilies.find((f) => /chilled|fresh/.test(t) && f.temperature === "chilled" && f.id !== "raw_produce") ?? model.productFamilies.find((f) => f.velocity === "fast" && f.id !== "raw_produce");
      if (!fam) return { text: "Which product family should go direct? Name one from the data view.", actions: [] };
      const fromType = model.nodes.some((n) => n.type === "factory") ? "factory" : "national_dc";
      const sc = scenario(`Direct-to-store: ${fam.name}`, `Ship ${fam.name} directly from the nearest ${fromType === "factory" ? "factory" : "national DC"} to each customer, bypassing the regional tier.`, [{ type: "direct_to_store", productFamilyId: fam.id, fromType }], { enablers: ["Multi-drop chilled fleet or carrier", "Revised order cut-offs at the factory", "Customer receiving slots for additional deliveries"] });
      return {
        text: `Draft scenario **${sc.name}** created.\n\n**What I did**\n- For every customer lane carrying ${fam.name} from a DC, split out that family's share and created a direct lane from the nearest ${fromType === "factory" ? "factory" : "national DC"}.\n- Reduced regional DC throughput accordingly and rebalanced upstream.\n\n**Expect** lower handling and fresher product, but higher transport cost per case because direct loads are smaller. The comparison shows whether the trade works for your volumes.${SCENARIO_FOOTER}`,
        actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }],
        confidence: "medium",
      };
    }

    // Cross-dock alternatives / compare central vs cross-dock
    if (/cross-?dock/.test(t)) {
      const rdcs = model.nodes.filter((n) => n.type === "regional_dc");
      if (!rdcs.length) return { text: "There are no regional DCs to convert. Say “add a cross-dock in <city>” to introduce one instead.", actions: [] };
      const fams = model.productFamilies.filter((f) => f.velocity === "fast" && !["raw_produce", "raw", "returns"].includes(f.id)).map((f) => f.id);
      const sc = scenario(
        "Cross-dock fast movers at regional sites",
        `Convert ${rdcs.map((r) => r.name).join(", ")} to cross-docks for fast-moving families (${fams.join(", ")}): inventory to 0.3 days, handling −40%, fixed cost −30%, with pre-allocation at the national DC.`,
        [{ type: "convert_to_cross_dock", nodeIds: rdcs.map((r) => r.id), productFamilyIds: fams }],
        { enablers: ["Pre-allocation in the NDC WMS", "Store-ready pallets or roll-cages", "Tight inbound windows (±2h)"], limitations: ["Slow movers would need to stay stock-held or move to the NDC; this scenario converts whole sites."] },
      );
      return {
        text: `Draft scenario **${sc.name}** created, comparing today's stock-holding regional tier against a cross-dock operation.\n\n**What changes**\n- ${rdcs.length} regional sites become flow-through: inventory falls to ~0.3 days, handling cost −40%, fixed cost −30%.\n- Inbound trunks gain 0.3 days for pre-sorting at origin.\n- A new operating rule records the pre-allocation requirement.\n\n**Trade-off to watch**: cross-docks give up the regional buffer, so service becomes more sensitive to inbound reliability.${SCENARIO_FOOTER}`,
        actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }],
        confidence: "medium",
      };
    }

    // Move e-commerce fulfilment
    if (/move|shift|switch/.test(t) && /e-?com|online|fulfil/.test(t)) {
      const fcs = model.nodes.filter((n) => n.type === "ecom_fc");
      const stores = model.nodes.filter((n) => n.type === "store" && model.lanes.some((l) => l.from === n.id && (l.mode === "van" || l.mode === "parcel")));
      const toDc = /to (a |the )?(dc|fc|fulfil|warehouse|national)/.test(t);
      const from = /from stores?/.test(t) ? stores : fcs;
      const to = toDc ? fcs[0] ?? model.nodes.find((n) => n.type === "national_dc") : stores[0];
      if (!from.length || !to) return { text: "I could not identify the source and destination for that move. Try “move e-commerce fulfilment from stores to the DC”.", actions: [] };
      const sc = scenario(`Move e-commerce to ${to.name}`, `Re-originate online order fulfilment from ${from.map((f) => f.name).join(", ")} to ${to.name}.`, from.map((f) => ({ type: "move_channel" as const, channel: "ecom" as const, from: f.id, to: to.id })));
      return { text: `Draft scenario **${sc.name}** created. Last-mile lanes now originate at ${to.name}; its inbound has been rebalanced. Look for the change in handling cost (each-pick vs store labour) and in last-mile distance.${SCENARIO_FOOTER}`, actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }], confidence: "medium" };
    }

    // Reduce transport spend without damaging service
    if (/reduce|cut|lower|save/.test(t) && /transport|freight|haulage|logistics cost|spend/.test(t)) {
      const outliers = ctx.findings.filter((f) => f.category === "cost");
      const carbon = ctx.findings.find((f) => f.category === "carbon");
      const under = ctx.findings.filter((f) => f.category === "efficiency");
      const changes: ScenarioChange[] = outliers.flatMap((f) =>
        f.impacted.laneIds.map((laneId) => {
          const lane = model.lanes.find((l) => l.id === laneId)!;
          const lm = m.laneMetrics[laneId];
          const target = Number((lm.costPerCase * 0.82).toFixed(2));
          return { type: "update_lane" as const, laneId, patch: { costPerCase: aiEstimate(target, "Tender target: −18% vs current rate") }, label: `${lane.from} → ${lane.to} rate −18%` };
        }),
      );
      const total = outliers.reduce((s, f) => s + Math.abs(f.impact.costAnnual ?? 0), 0);
      const lines = [
        ...outliers.map((f) => `- **${f.title}** — ~${money(Math.abs(f.impact.costAnnual ?? 0))}/yr, no service impact (${f.confidence} confidence).`),
        ...under.map((f) => `- **${f.title}** — ~${money(Math.abs(f.impact.costAnnual ?? 0))}/yr by consolidating; adds stem distance.`),
        ...(carbon ? [`- **${carbon.title}** — mode shift trims cost per case-km on long trunks.`] : []),
      ];
      const sc = changes.length ? scenario("Re-tender outlier lanes", `Bring ${changes.length} outlier lane${changes.length > 1 ? "s" : ""} to within 1.2× the network median rate per case-km through tender or consolidation.`, changes, { enablers: ["Freight tender or carrier negotiation", "Consolidation with neighbouring drops"] }) : undefined;
      return {
        text: `Three levers protect service while cutting transport spend:\n\n${lines.join("\n") || "- No outlier lanes detected; transport rates are already close to the network median."}\n\n${sc ? `I have drafted **${sc.name}** (~${money(total)}/yr if the target rates are achieved) so you can see the effect on the comparison.${SCENARIO_FOOTER}` : ""}`,
        actions: sc ? [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }] : [{ type: "set_view", view: "findings" }],
        confidence: "medium",
      };
    }

    /* ---------- Questions ---------- */

    if (/expensive|highest cost|costliest|most cost/.test(t) && /route|lane|flow|path|market/.test(t)) {
      const ranked = model.lanes
        .map((l) => ({ l, lm: m.laneMetrics[l.id] }))
        .filter((x) => x.lm && x.l.pattern !== "returns")
        .sort((a, b) => b.lm.annualCost - a.lm.annualCost)
        .slice(0, 5);
      const lines = ranked.map((x, i) => `${i + 1}. **${name(model, x.l.from)} → ${name(model, x.l.to)}** — ${money(x.lm.annualCost)}/yr, ${money(x.lm.costPerCase)}/case over ${Math.round(x.lm.distanceKm)} km (${PROVENANCE_LABEL[x.lm.costSource].toLowerCase()})`);
      const perCase = model.lanes.map((l) => ({ l, lm: m.laneMetrics[l.id] })).filter((x) => x.lm && x.l.mode !== "parcel" && x.l.mode !== "van").sort((a, b) => b.lm.costPerCase - a.lm.costPerCase)[0];
      return {
        text: `**Most expensive routes by annual spend**\n\n${lines.join("\n")}\n\nBy unit cost, the outlier is **${name(model, perCase.l.from)} → ${name(model, perCase.l.to)}** at ${money(perCase.lm.costPerCase)}/case. I have switched the flow view to cost so the thickest ribbons are the biggest spend.`,
        actions: [{ type: "set_view", view: "flows" }, { type: "set_overlay", overlay: "cost" }, { type: "select", laneId: ranked[0]?.l.id }],
        chips: ["Can we reduce transport spend without damaging service?", "Export the cost comparison to Excel"],
      };
    }

    if (/resilien|biggest risk|single point|vulnerab|exposure|fragile/.test(t)) {
      const f = ctx.findings.find((x) => ["dependency", "geographic", "capacity"].includes(x.category));
      if (!f) return { text: "No structural resilience risk stands out in the current model. The highest-ranked findings are cost and efficiency items.", actions: [{ type: "set_view", view: "findings" }] };
      return {
        text: `**Biggest resilience risk: ${f.title}**\n\n${f.detected}\n\n**Why it matters.** ${f.whyItMatters}\n\n**Suggested actions**\n${f.actions.map((a) => `- ${a}`).join("\n")}\n\nConfidence: **${f.confidence}** — ${f.confidenceDrivers.map((d) => d.driver).join("; ")}.${f.suggestedScenario ? `\n\nSay “run the stress test” or click the finding to model **${f.suggestedScenario.name}**.` : ""}`,
        actions: [{ type: "select", findingId: f.id, nodeId: f.impacted.nodeIds[0] }, { type: "set_view", view: "map" }, { type: "set_overlay", overlay: "risk" }],
        chips: f.suggestedScenario ? [`What happens if we lose ${name(model, f.impacted.nodeIds[1] ?? f.impacted.nodeIds[0])}?`, "Explain this issue for an executive audience"] : ["Explain this issue for an executive audience"],
        confidence: f.confidence,
      };
    }

    if (/run the stress test|run that scenario|model that|apply (the|that) (suggestion|scenario|recommendation)/.test(t)) {
      const f = (ctx.selection?.findingId ? ctx.findings.find((x) => x.id === ctx.selection!.findingId) : undefined) ?? ctx.findings.find((x) => x.suggestedScenario);
      if (!f?.suggestedScenario) return { text: "Select a finding with a suggested scenario first.", actions: [{ type: "set_view", view: "findings" }] };
      const sc = scenario(f.suggestedScenario.name, f.suggestedScenario.description, f.suggestedScenario.changes);
      return { text: `Draft scenario **${sc.name}** created from the finding “${f.title}”.${SCENARIO_FOOTER}`, actions: [{ type: "create_scenario", scenario: sc, activate: true }, { type: "set_view", view: "compare" }] };
    }

    if (/assumption/.test(t) && /driv|sensitiv|behind|matter|key|main/.test(t)) {
      const active = ctx.activeScenarioId ? ctx.scenarios.find((s) => s.id === ctx.activeScenarioId) : undefined;
      const weak = m.costLines.filter((l) => l.evidenceShare < 0.6).sort((a, b) => b.annual - a.annual).slice(0, 4);
      const high = model.assumptions.filter((a) => a.sensitivity === "high");
      return {
        text: `**Assumptions driving the ${active ? `“${active.name}” comparison` : "baseline result"}**\n\n**Cost lines with the least evidence** (widest ranges)\n${weak.map((l) => `- ${COST_COMPONENT_LABEL[l.component]}: ${money(l.annual)} (range ${money(l.range[0])}–${money(l.range[1])}), ${fmtPct(l.evidenceShare)} evidence-backed`).join("\n") || "- All major cost lines are well evidenced."}\n\n**High-sensitivity model assumptions**\n${high.map((a) => `- ${a.text}`).join("\n") || "- None flagged as high sensitivity."}\n\n${active ? "**Scenario-specific**: new facilities and lanes use benchmark costs and nearest-facility reassignment rather than an optimised allocation." : ""}\n\nOverall data confidence is **${m.dataConfidence}** (${fmtPct(m.confidenceScore)} of the cost base is traced to confirmed or user-entered data).`,
        actions: [{ type: "set_view", view: "data" }, { type: "set_overlay", overlay: "confidence" }],
        chips: ["What information would most improve confidence in this recommendation?"],
        confidence: m.dataConfidence,
      };
    }

    if (/improve confidence|most improve|what (data|information|input)|data gap|missing data|next data/.test(t)) {
      const dq = ctx.findings.find((f) => f.category === "data_quality");
      const sel = ctx.selection?.findingId ? ctx.findings.find((f) => f.id === ctx.selection!.findingId) : undefined;
      const target = sel && sel.category !== "data_quality" ? sel : undefined;
      const text = target
        ? `**To tighten “${target.title}”**\n\nIts confidence is **${target.confidence}** because: ${target.confidenceDrivers.map((d) => `${d.effect === "down" ? "−" : "+"} ${d.driver}`).join("; ")}.\n\nSmallest useful inputs, in order:\n${target.dataUsed.map((d, i) => `${i + 1}. Confirm ${d.toLowerCase()}`).join("\n")}\n${target.assumptions.length ? `\nAssumptions you could replace with data: ${target.assumptions.join("; ")}.` : ""}`
        : dq
          ? `**Where more data would help most**\n\n${dq.detected}\n\nIn priority order:\n${dq.actions.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\nThe first item alone typically lifts evidence-weighted confidence by 10–15 points because transport is the largest estimated line.`
          : "All inputs in this model are confirmed or user-entered. The remaining uncertainty is in the method (nearest-facility allocation, benchmark rates), not the data.";
      return { text, actions: [{ type: "set_view", view: "data" }, { type: "set_overlay", overlay: "confidence" }], confidence: "high" };
    }

    if (/executive|board|ceo|cfo|plain english|simple terms|non-technical|summar/.test(t)) {
      const sel = ctx.selection?.findingId ? ctx.findings.find((f) => f.id === ctx.selection!.findingId) : undefined;
      const active = ctx.activeScenarioId ? ctx.scenarioSummaries.find((s) => s.id === ctx.activeScenarioId) : undefined;
      if (sel) return { text: `**For an executive audience**\n\n${sel.executiveSummary}\n\n**Ask**: ${sel.actions[0]}\n\n**Confidence**: ${sel.confidence}. ${sel.confidenceDrivers.filter((d) => d.effect === "down").map((d) => d.driver).join("; ") || "Based on confirmed data."}`, actions: [], confidence: sel.confidence };
      if (active && /scenario|this|result/.test(t)) return { text: `**${active.name} — executive summary**\n\n${active.headline}. Net annual cost change: ${money(active.netAnnualDelta)}. The comparison view lists the benefits, trade-offs and what we would need in place to deliver it.`, actions: [{ type: "set_view", view: "compare" }] };
      return { text: executiveSummary(model, m, ctx.findings), actions: [{ type: "set_view", view: "overview" }], confidence: m.dataConfidence };
    }

    if (/constrain|bottleneck|pinch|capacity/.test(t)) {
      const caps = ctx.findings.filter((f) => f.category === "capacity");
      if (!caps.length) return { text: `No facility exceeds the ${fmtPct(model.parameters.constrainedUtilisation.value)} utilisation threshold on an average week. Average utilisation is ${fmtPct(m.avgUtilisation)}.`, actions: [{ type: "set_view", view: "network" }] };
      return { text: `**Constrained facilities**\n\n${caps.map((f) => `- **${f.title}** — ${f.detected}`).join("\n")}\n\nEach has a one-click relief scenario in the findings list.`, actions: [{ type: "set_view", view: "findings" }, { type: "set_overlay", overlay: "risk" }] };
    }

    if (/^(what|which|how|where|why|tell me|show me|list|describe|explain)/.test(t) && /network|model|baseline|cost|nodes?|lanes?|structure|overview/.test(t)) {
      return { text: executiveSummary(model, m, ctx.findings), actions: [{ type: "set_view", view: "overview" }] };
    }

    // Rule creation
    if (/^(rule|add (a )?rule|from now on|always|never|must|should)/.test(t) || /\bas a rule\b/.test(t)) {
      const text = raw.replace(/^(rule:|add (a )?rule:?|from now on,?)\s*/i, "");
      const kind: OperatingRule["kind"] = /temperature|chilled|frozen|shelf/.test(t) ? "temperature" : /capacity|utilis/.test(t) ? "capacity" : /inventory|stock|days/.test(t) ? "inventory" : /supplier|source|dual/.test(t) ? "sourcing" : /carbon|emission|rail/.test(t) ? "sustainability" : /serve|nearest|allocate|route/.test(t) ? "allocation" : "service";
      const rule: OperatingRule = { id: uid("rule"), text: text.charAt(0).toUpperCase() + text.slice(1), kind, active: true, createdBy: "agent" };
      return { text: `Added an editable **${kind}** rule to the model:\n\n> ${rule.text}\n\nRules are shown in the data view and applied when scenarios are evaluated; this one is recorded in the change log.`, actions: [{ type: "add_rule", rule }, { type: "set_view", view: "data" }] };
    }

    if (/compare|comparison|baseline vs|versus/.test(t)) {
      return { text: ctx.scenarios.length ? `Opening the comparison. ${ctx.scenarioSummaries.map((s) => `**${s.name}**: ${s.headline}.`).join(" ")}` : "No scenarios yet. Ask for one, for example “What happens if we add a regional DC in Birmingham?”", actions: [{ type: "set_view", view: ctx.scenarios.length ? "compare" : "findings" }] };
    }

    if (/^(hi|hello|hey|help|what can you do)/.test(t)) {
      return { text: helpText(), actions: [], chips: ["Show me the most expensive routes to market", "Where is our biggest resilience risk?", "What happens if we add a regional DC in Birmingham?"] };
    }

    return {
      text: `I was not sure how to act on that. I can build or edit the network, create scenarios, answer questions about cost, risk and assumptions, or export to Excel. ${helpText()}`,
      actions: [],
      chips: ["What happens if demand rises 25% in the South East?", "Model direct-to-store distribution for chilled products", "Which assumptions are driving the result?"],
    };
  }

  private buildFromSpec(spec: Partial<NetworkSpec>, name: string | undefined, goal: string | undefined, locationsAssumed: boolean, libraryName?: string): AgentReply {
    const model = buildNetworkFromSpec(spec, name);
    if (goal) model.goals = { primary: goal as NonNullable<NetworkModel["goals"]>["primary"] };
    const nodesByType = countByType(model);
    const essentials: string[] = [];
    if (locationsAssumed) essentials.push("Facility locations are typical UK logistics sites (Daventry NDC, Warrington / Dartford / Avonmouth / Glasgow RDCs). Tell me the real ones or drag nodes on the map.");
    essentials.push("Weekly volumes by customer and lane: a single spreadsheet of deliveries per week would replace most estimates.");
    essentials.push("Rated capacity for the factory and DCs.");
    return {
      text: `${libraryName ? `Built a **${libraryName}** network` : "Built the baseline network"}: ${nodesByType}.\n\n**What I created**\n- ${model.lanes.length} lanes with volumes derived from an assumed ${fmtNum(model.lanes.filter((l) => model.nodes.find((n) => n.id === l.to)?.type.match(/store|customer/)).reduce((s, l) => s + l.volumePerWeek.value, 0))} cases/week demand split by population.\n- Capacities, costs and transit times estimated from benchmarks and distance — every one is labelled **assumed** or **AI estimate** in the data view.\n- ${model.rules.length} starting operating rules you can edit.\n\n**Smallest inputs that would most improve the model**\n${essentials.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\nNext, ask me where the pinchpoints are, or describe a change to test.`,
      actions: [{ type: "load_model", model }, { type: "set_pending", pending: null }, { type: "set_view", view: "map" }],
      assumptions: model.assumptions.map((a) => a.text),
      chips: ["Where is our biggest resilience risk?", "Show me the most expensive routes to market", "What happens if we add a regional DC in Birmingham?"],
      confidence: "low",
    };
  }
}

function looksLikeDescription(t: string) {
  const starters = /^(build my (current )?network|we (buy|have|operate|run|ship|sell|source|receive|manufacture|supply|deliver)|our (network|supply chain|business)|i run|my (company|business|network))/;
  if (starters.test(t)) return true;
  const nounHits = ["supplier", "factor", "dc", "distribution", "store", "customer", "warehouse", "plant", "farm"].filter((n) => t.includes(n)).length;
  return nounHits >= 3 && /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(t) && !/what (if|happens)|add a|remove|lose/.test(t);
}

function detectGoal(t: string): string | undefined {
  if (/cost|cheap|saving|spend/.test(t)) return "cost";
  if (/service|availability|otif|lead.?time|faster/.test(t)) return "service";
  if (/resilien|redundan/.test(t)) return "resilience";
  if (/risk/.test(t)) return "risk";
  if (/emission|carbon|sustainab/.test(t)) return "emissions";
  if (/capacity|growth|grow/.test(t)) return "capacity";
  if (/route.to.market|compare routes|channels?/.test(t)) return "routes";
  return undefined;
}

function describeUnderstanding(spec: Partial<NetworkSpec>) {
  const items: string[] = [];
  if (spec.suppliers) items.push(`${spec.suppliers} suppliers / growers`);
  if (spec.ports) items.push(`${spec.ports} port or border point${spec.ports > 1 ? "s" : ""}`);
  if (spec.factories) items.push(`${spec.factories} factor${spec.factories > 1 ? "ies" : "y"}`);
  if (spec.nationalDcs) items.push(`${spec.nationalDcs} national DC`);
  if (spec.regionalDcs) items.push(`${spec.regionalDcs} regional DCs${spec.regionalDcs === 3 ? " (count not stated; assumed 3)" : ""}`);
  if (spec.crossDocks) items.push(`${spec.crossDocks} cross-docks`);
  if (spec.stores) items.push(`${spec.stores} stores${spec.stores === 40 ? " (count not stated; assumed 40 in clusters)" : ""}`);
  if (spec.customerZones && !spec.stores) items.push(`${spec.customerZones} customer regions`);
  if (spec.wholesalers) items.push(`${spec.wholesalers} wholesalers`);
  if (spec.ecomFromNdc) items.push("e-commerce fulfilled from the national DC");
  else if (spec.ecomFc) items.push("a dedicated e-commerce fulfilment centre");
  const flags = [spec.coldChain && "cold chain (chilled + ambient families)", spec.seasonal && "significant seasonality", spec.milkRuns && "milk-run supplier collections", spec.backhaul && "backhaul flows", spec.directToStoreChilled && "direct-to-store for chilled", spec.returns && "returns flows"].filter(Boolean);
  return `- ${items.join("\n- ")}${flags.length ? `\n- Characteristics: ${flags.join(", ")}` : ""}\n- Vertical: ${spec.vertical === "food_manufacturing" ? "food manufacturing" : spec.vertical === "retail_ecommerce" ? "retail / e-commerce" : "general"}`;
}

function countByType(model: NetworkModel) {
  const c = new Map<NodeType, number>();
  for (const n of model.nodes) c.set(n.type, (c.get(n.type) ?? 0) + 1);
  const plural = (label: string, v: number) => (v === 1 ? label : label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`);
  return [...c.entries()].map(([k, v]) => `${v} ${plural(NODE_TYPE_META[k].label.split(" / ")[0].toLowerCase(), v)}`).join(", ");
}

function name(model: NetworkModel, id: string) {
  return model.nodes.find((n) => n.id === id)?.name ?? id;
}

function lowestVolumeDc(model: NetworkModel, m: AgentContext["metrics"]) {
  const dcs = model.nodes.filter((n) => ["regional_dc", "cross_dock", "cold_store"].includes(n.type));
  return dcs.sort((a, b) => (m!.nodeMetrics[a.id]?.throughputPerWeek ?? 0) - (m!.nodeMetrics[b.id]?.throughputPerWeek ?? 0))[0];
}

export function executiveSummary(model: NetworkModel, m: NonNullable<AgentContext["metrics"]>, findings: Finding[]) {
  const cur = model.currency;
  const top = findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 3);
  const opp = findings.filter((f) => (f.impact.costAnnual ?? 0) < 0).slice(0, 2);
  return `**${model.name} — executive view**\n\nThe network moves ${fmtNum(m.annualCases)} cases a year at a cost-to-serve of **${fmtMoney(costToServe(m), cur)}** (${fmtMoney(m.costPerCase, cur, false)} per case; total network cost ${fmtMoney(m.totalAnnualCost, cur)}, range ${fmtMoney(m.costRange[0], cur)}–${fmtMoney(m.costRange[1], cur)}). Expected service level is **${fmtPct(m.serviceLevel, 1)}** with an average delivery lead time of ${m.avgLeadTimeDays.toFixed(1)} days. Risk score ${m.riskScore}/100, resilience ${m.resilienceScore}/100, ${fmtNum(m.emissionsTonnes)} tCO2e a year.\n\n**What needs attention**\n${top.map((f) => `- ${f.executiveSummary}`).join("\n") || "- No critical or high-severity issues detected."}\n\n**Where the money is**\n${opp.map((f) => `- ${f.executiveSummary}`).join("\n") || "- No quantified savings opportunities yet."}\n\nData confidence is **${m.dataConfidence}**: ${fmtPct(m.confidenceScore)} of the cost base traces to confirmed or user-entered data; the rest is benchmark or estimate and is labelled as such throughout.`;
}

function helpText() {
  return `Try:\n- “Build my current network from this description: …”\n- “What happens if we add a regional DC in Birmingham?”\n- “What if demand rises 25% in the South East?”\n- “What if we lose the Port of Dover?”\n- “Model direct-to-store distribution for chilled products.”\n- “Compare central distribution against cross-docking.”\n- “Show me the most expensive routes to market.”\n- “Which assumptions are driving the result?”\n- “Rule: chilled products must never dwell more than 24 hours at an RDC.”\n- “Export the cost comparison to Excel.”`;
}

export const agentActionsSummary = (actions: AgentAction[]) => actions.map((a) => a.type).join(", ");
