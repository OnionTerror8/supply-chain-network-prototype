/**
 * Core domain model for Meridian.
 *
 * Design notes
 * - Every quantitative field is wrapped in `Tagged<T>` so the UI can always show
 *   where a number came from (confirmed source, user, assumed default, AI estimate,
 *   or missing). Never present an assumed value as a fact.
 * - Every field that can reasonably be unknown is optional. The engines degrade
 *   gracefully and lower confidence rather than refusing to compute.
 * - The model is plain JSON so it can be persisted, versioned, diffed and sent to
 *   an API or LLM without transformation.
 */

export type Provenance = "confirmed" | "user" | "assumed" | "ai" | "missing";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  confirmed: "Confirmed source data",
  user: "User-entered",
  assumed: "Assumed default",
  ai: "AI-derived estimate",
  missing: "Missing / unknown",
};

export interface Tagged<T = number> {
  value: T;
  source: Provenance;
  /** Optional low/high range when uncertainty is material. */
  range?: [T, T];
  /** Short human explanation of where the value came from. */
  note?: string;
}

export type Confidence = "high" | "medium" | "low" | "insufficient";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  insufficient: "Insufficient data",
};

export type Temperature = "ambient" | "chilled" | "frozen" | "multi";

export type NodeType =
  | "farm"
  | "supplier"
  | "port"
  | "factory"
  | "copacker"
  | "national_dc"
  | "regional_dc"
  | "cross_dock"
  | "cold_store"
  | "ecom_fc"
  | "micro_fc"
  | "dark_store"
  | "wholesaler"
  | "store"
  | "customer_zone"
  | "returns_center";

export type Tier =
  | "origin"
  | "inbound"
  | "manufacturing"
  | "national"
  | "regional"
  | "channel"
  | "customer";

export const NODE_TYPE_META: Record<
  NodeType,
  { label: string; tier: Tier; short: string; color: string }
> = {
  farm: { label: "Farm / grower", tier: "origin", short: "Farm", color: "#6b7c3a" },
  supplier: { label: "Supplier", tier: "origin", short: "Supplier", color: "#8a7a3d" },
  port: { label: "Port / border point", tier: "inbound", short: "Port", color: "#0f6f73" },
  factory: { label: "Factory", tier: "manufacturing", short: "Factory", color: "#9a4a2a" },
  copacker: { label: "Co-packer", tier: "manufacturing", short: "Co-packer", color: "#b56a3a" },
  national_dc: { label: "National DC", tier: "national", short: "NDC", color: "#1f3d4d" },
  regional_dc: { label: "Regional DC", tier: "regional", short: "RDC", color: "#2a6a78" },
  cross_dock: { label: "Cross-dock", tier: "regional", short: "X-dock", color: "#a67c3a" },
  cold_store: { label: "Cold store", tier: "national", short: "Cold", color: "#4a7c8a" },
  ecom_fc: { label: "E-commerce FC", tier: "channel", short: "E-com FC", color: "#c2782a" },
  micro_fc: { label: "Micro-fulfilment", tier: "channel", short: "MFC", color: "#b8860b" },
  dark_store: { label: "Dark store", tier: "channel", short: "Dark store", color: "#8b5a2b" },
  wholesaler: { label: "Wholesaler / distributor", tier: "channel", short: "Wholesale", color: "#c45c26" },
  store: { label: "Retail store", tier: "customer", short: "Store", color: "#a33b2b" },
  customer_zone: { label: "Customer zone", tier: "customer", short: "Customers", color: "#b54a3a" },
  returns_center: { label: "Returns centre", tier: "channel", short: "Returns", color: "#6b6560" },
};

export const TIER_ORDER: Tier[] = [
  "origin",
  "inbound",
  "manufacturing",
  "national",
  "regional",
  "channel",
  "customer",
];

export const TIER_LABEL: Record<Tier, string> = {
  origin: "Origin & supply",
  inbound: "Inbound gateways",
  manufacturing: "Manufacturing",
  national: "National distribution",
  regional: "Regional distribution",
  channel: "Channels",
  customer: "Customers",
};

export interface GeoLocation {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country: string;
  source: Provenance;
}

export interface NetworkNode {
  id: string;
  name: string;
  type: NodeType;
  location: GeoLocation;
  temperature: Temperature;
  /** Weekly handling / production capacity in cases. */
  capacityPerWeek?: Tagged;
  /** Days of inventory typically held. */
  inventoryDays?: Tagged;
  fixedCostPerYear?: Tagged;
  handlingCostPerCase?: Tagged;
  /** 0..1 on-time / in-full reliability */
  reliability?: Tagged;
  /** Operator: own, 3PL, 4PL, supplier etc. */
  operator?: Tagged<string>;
  /** Free-text operating notes shown in drill-down. */
  notes?: string;
  tags?: string[];
}

export type TransportMode = "road" | "rail" | "sea" | "air" | "parcel" | "van";

export interface Lane {
  id: string;
  from: string;
  to: string;
  mode: TransportMode;
  temperature: Temperature;
  /** Product families carried; empty = all. */
  productFamilies: string[];
  volumePerWeek: Tagged;
  costPerCase?: Tagged;
  transitDays?: Tagged;
  /** 0..1 on-time reliability */
  reliability?: Tagged;
  /** Explicit distance when known; otherwise computed from coordinates. */
  distanceKm?: Tagged;
  crossesBorder?: boolean;
  /** Backhaul / returns / milk-run flags. */
  pattern?: "linehaul" | "milk_run" | "backhaul" | "returns" | "direct" | "last_mile";
}

export interface ProductFamily {
  id: string;
  name: string;
  temperature: Temperature;
  shelfLifeDays?: Tagged;
  unitValue?: Tagged;
  velocity: "fast" | "medium" | "slow";
  shareOfVolume?: Tagged;
  /** Spoilage / shrink % per week in storage. */
  weeklyShrinkRate?: Tagged;
}

export interface Assumption {
  id: string;
  text: string;
  appliesTo?: string[];
  source: Provenance;
  /** How much results move if this assumption is wrong. */
  sensitivity: "high" | "medium" | "low";
}

export interface OperatingRule {
  id: string;
  text: string;
  kind:
    | "service"
    | "allocation"
    | "capacity"
    | "temperature"
    | "inventory"
    | "sourcing"
    | "sustainability";
  active: boolean;
  createdBy: "user" | "agent" | "template";
}

export interface DemandRegion {
  id: string;
  name: string;
  /** Node ids that sit inside this demand region. */
  nodeIds: string[];
  seasonalityPeakFactor?: Tagged;
}

export interface Goals {
  primary: "cost" | "service" | "risk" | "emissions" | "capacity" | "resilience" | "routes";
  secondary?: string[];
}

export interface NetworkModel {
  id: string;
  name: string;
  vertical: "food_manufacturing" | "retail_ecommerce" | "generic";
  currency: string;
  description?: string;
  nodes: NetworkNode[];
  lanes: Lane[];
  productFamilies: ProductFamily[];
  regions: DemandRegion[];
  assumptions: Assumption[];
  rules: OperatingRule[];
  goals?: Goals;
  /** Global cost and sustainability parameters. */
  parameters: ModelParameters;
}

export interface ModelParameters {
  /** Cost per case per km by mode, used to estimate lanes without confirmed cost. */
  costPerCaseKm: Record<TransportMode, Tagged>;
  /** Fixed handling cost per case on a lane leg (loading, unloading). */
  laneHandlingPerCase: Tagged;
  /** kgCO2e per case-km by mode. */
  emissionsPerCaseKm: Record<TransportMode, Tagged>;
  /** Annual inventory carrying rate as % of value. */
  inventoryCarryingRate: Tagged;
  /** Default case value when product family value unknown. */
  defaultCaseValue: Tagged;
  /** Cost per case of a stock-out / service failure. */
  stockoutCostPerCase: Tagged;
  /** Carbon shadow price per tonne. */
  carbonPricePerTonne: Tagged;
  /** Target utilisation above which a node is considered constrained. */
  constrainedUtilisation: Tagged;
  weeksPerYear: number;
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export type ScenarioChange =
  | { type: "add_node"; node: NetworkNode; serveNearest?: NodeType[]; feedFrom?: string }
  | { type: "remove_node"; nodeId: string; reassign: boolean }
  | { type: "update_node"; nodeId: string; patch: Partial<NetworkNode>; label: string }
  | { type: "add_lane"; lane: Lane }
  | { type: "remove_lane"; laneId: string }
  | { type: "update_lane"; laneId: string; patch: Partial<Lane>; label: string }
  | {
      type: "demand_change";
      factor: number;
      regionId?: string;
      productFamilyId?: string;
      label: string;
    }
  | { type: "direct_to_store"; productFamilyId: string; fromType: NodeType }
  | { type: "convert_to_cross_dock"; nodeIds: string[]; productFamilyIds: string[] }
  | { type: "move_channel"; channel: "ecom"; from: string; to: string }
  | { type: "add_rule"; rule: OperatingRule };

export interface Scenario {
  id: string;
  name: string;
  description: string;
  changes: ScenarioChange[];
  createdAt: string;
  createdBy: "user" | "agent";
  status: "draft" | "confirmed";
  /** Enablers / barriers the agent or user has captured. */
  enablers: string[];
  limitations: string[];
}

/* ------------------------------------------------------------------ */
/* Engine outputs                                                      */
/* ------------------------------------------------------------------ */

export type CostComponent =
  | "procurement"
  | "manufacturing"
  | "packaging_handling"
  | "warehousing"
  | "inventory_carrying"
  | "transport"
  | "last_mile"
  | "cross_dock"
  | "duties_customs"
  | "waste_spoilage"
  | "service_failure"
  | "carbon";

export const COST_COMPONENT_LABEL: Record<CostComponent, string> = {
  procurement: "Raw material & procurement",
  manufacturing: "Manufacturing & conversion",
  packaging_handling: "Packaging & handling",
  warehousing: "Warehousing & storage",
  inventory_carrying: "Inventory carrying",
  transport: "Transport & freight",
  last_mile: "Last mile",
  cross_dock: "Cross-dock & consolidation",
  duties_customs: "Duties, customs & insurance",
  waste_spoilage: "Waste, shrink & spoilage",
  service_failure: "Service failure & stock-outs",
  carbon: "Carbon (shadow price)",
};

export interface CostLine {
  component: CostComponent;
  annual: number;
  range: [number, number];
  confidence: Confidence;
  /** Share of this line backed by confirmed/user data (0..1). */
  evidenceShare: number;
  logic: string;
}

export interface NodeMetrics {
  nodeId: string;
  inboundPerWeek: number;
  outboundPerWeek: number;
  throughputPerWeek: number;
  utilisation?: number;
  annualCost: number;
  inventoryCases?: number;
  inventoryValue?: number;
  emissionsTonnes: number;
  touches: number;
}

export interface LaneMetrics {
  laneId: string;
  distanceKm: number;
  costPerCase: number;
  costSource: Provenance;
  annualCost: number;
  annualEmissionsTonnes: number;
  transitDays: number;
  shareOfDestinationInbound: number;
  /** Weekly cases after any view transform (e.g. peak horizon). */
  volumePerWeek: number;
}

export interface NetworkMetrics {
  /** Operating cost of the network per year (excludes purchased goods and carbon shadow price). */
  totalAnnualCost: number;
  /** Value of goods purchased from origin nodes per year; reported separately. */
  procurementAnnual: number;
  costRange: [number, number];
  costPerCase: number;
  annualCases: number;
  costLines: CostLine[];
  serviceLevel: number;
  avgLeadTimeDays: number;
  inventoryValue: number;
  inventoryDaysWeighted: number;
  avgUtilisation: number;
  constrainedNodes: number;
  riskScore: number; // 0..100
  resilienceScore: number; // 0..100
  emissionsTonnes: number;
  emissionsPerCaseKg: number;
  dataConfidence: Confidence;
  confidenceScore: number; // 0..1
  nodeMetrics: Record<string, NodeMetrics>;
  laneMetrics: Record<string, LaneMetrics>;
  unservedCasesPerWeek: number;
}

export type FindingCategory =
  | "capacity"
  | "dependency"
  | "inventory"
  | "lead_time"
  | "reliability"
  | "cost"
  | "efficiency"
  | "service"
  | "geographic"
  | "food_safety"
  | "carbon"
  | "data_quality"
  | "opportunity";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  detected: string;
  whyItMatters: string;
  impacted: { nodeIds: string[]; laneIds: string[]; productFamilyIds: string[]; period?: string };
  impact: { costAnnual?: number; servicePts?: number; riskDelta?: number; emissionsTonnes?: number };
  actions: string[];
  tradeOffs: string[];
  dataUsed: string[];
  assumptions: string[];
  confidence: Confidence;
  confidenceDrivers: { driver: string; effect: "up" | "down" }[];
  /** Optional ready-made scenario the user can apply. */
  suggestedScenario?: { name: string; description: string; changes: ScenarioChange[] };
  executiveSummary: string;
}

export interface ChangeLogEntry {
  id: string;
  at: string;
  actor: "user" | "agent" | "system";
  scope: "baseline" | "scenario";
  scenarioId?: string;
  summary: string;
  details?: string[];
}
