# Meridian

AI-native supply-chain network modelling for planners. Describe a network in plain language, inspect a baseline with every number labelled by provenance, detect pinchpoints, and test alternatives against that baseline — without silently changing it.

Meridian is a prototype. It is designed so later releases can swap the rule-based agent for an LLM, feed ERP/WMS/TMS data into the same tagged fields, and add role-based sign-off. Automated execution is intentionally disabled.

## What you can do

- Describe a network (harvest / first receipt → manufacturing → storage → distribution → retail / e-commerce / last mile) and have the agent build a baseline.
- Load a food-manufacturing sample or an omnichannel-retail sample, import a spreadsheet, or instantiate a governed distribution-model template.
- Inspect the same network as a map, a tiered node-link diagram, a Sankey of flows, and drill-down tables. Selections stay in sync.
- See cost-to-serve, service, inventory, utilisation, risk, carbon and data confidence, with calculation logic and ranges.
- Review pinchpoints, risks and opportunities. Each finding states what was detected, why it matters, impact, actions, trade-offs, data used, assumptions and confidence drivers.
- Model a scenario as an immutable list of changes. Compare it to the baseline. Confirm, discard, or promote it (promotion is a logged, explicit action).
- Export a workbook (baseline, scenario comparison, findings, assumptions, audit log).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:4317](http://localhost:4317). The workspace persists in `localStorage` (`meridian-workspace-v1`).

```bash
npm run build
npm start        # also on port 4317
npm run lint
```

No API keys are required. The planning agent is a deterministic, rule-based engine that runs in the browser if `/api/agent` is unreachable. An LLM provider can be wired later behind the same `AgentProvider` interface (`MERIDIAN_LLM_API_KEY` is reserved and unused).

## Architecture

```
src/
  app/                 Next.js App Router. /api/agent, /api/integrations/[connector]
  components/
    ui/                shadcn/ui primitives
    shared/            provenance badges, KPIs, markdown, tagged-field editor
    workspace/         shell, agent panel, inspector, views
  lib/
    domain/            tagged data model, geography, helpers
    engine/            cost-to-serve, pinchpoint detection, scenario application
    agent/             spec parser, network builder, rule-based agent
    library/           governed distribution-model catalogue
    data/              food + retail sample networks
    export/            Excel export and import
    integrations/      connector / RBAC / automation placeholders
    store.ts           Zustand workspace (baseline never mutated by scenarios)
    filters.ts         overlay encodings and filter resolution
```

The domain model is plain JSON. Every quantitative field is `Tagged<T> = { value, source, range?, note? }` with `source` one of `confirmed | user | assumed | ai | missing`. Engines degrade when data is missing and lower confidence rather than inventing facts.

**Scenarios** are change lists applied to a clone of the baseline. The baseline is only edited by an explicit user action (inspector, table, promote). The agent never writes the baseline silently.

## Agent

The client POSTs `{ message, context }` to `/api/agent`. The reply is `{ text, actions, chips?, assumptions?, confidence? }`. The workspace applies actions (`load_model`, `create_scenario`, `set_view`, `select`, `export_excel`, `add_rule`, `set_pending`, `set_overlay`).

Try:

- “We buy raw material from five suppliers, receive it into two factories…”
- “Where is our biggest resilience risk?”
- “What happens if we add a regional DC in Birmingham?”
- “Show me a cross-dock alternative for fast-moving lines”
- “What if demand in the South East grows 25%?”
- “Which assumptions drive this result most?”
- “Explain the network to an executive”
- “Export this to Excel”

## Data provenance

Colour dots on every number:

| Source | Meaning |
| --- | --- |
| Confirmed | Imported or system-of-record |
| User | Entered in this workspace |
| Assumed | Library / benchmark default |
| AI-derived | Estimated by the builder or from distance × rate |
| Missing | Not provided; engines skip or substitute and flag it |

Confidence on a result is evidence-weighted (confirmed 1.0, user 0.85, AI 0.55, assumed 0.4, missing 0). High / medium / low / insufficient is derived from that score.

## Extending

- **LLM agent** — implement `AgentProvider` in `src/lib/agent` and select it when `MERIDIAN_LLM_API_KEY` is set (`src/lib/agent/index.ts`).
- **Connectors** — `/api/integrations/[connector]` currently returns 501. Map ERP/WMS/TMS payloads onto `Tagged` fields with `source: "confirmed"`.
- **Distribution models** — add an entry to `DISTRIBUTION_MODELS` in `src/lib/library/models.ts`.
- **Findings** — add a detector in `src/lib/engine/findings.ts`.
- **RBAC / automation** — the matrices in `src/lib/integrations/connectors.ts` are the intended contract; hooks stay `recommend_only`.

## Sample networks

- **Food manufacturer (GB)** — growers and EU produce, two factories (Spalding, Wakefield), Daventry NDC, four RDCs, chilled and ambient ranges, Dover gateway concentration, seasonal peak, cold chain.
- **Omnichannel retailer** — NDC store replenishment, Milton Keynes e-com FC, ship-from-store vans, marketplace drop-ship, Northampton returns centre.
