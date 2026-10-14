/**
 * Integration and governance placeholders.
 *
 * These describe how the prototype's data model would be fed and governed in
 * production. Nothing here performs I/O; the UI surfaces them so users can see
 * the path from manual / spreadsheet data to live operational feeds.
 */

export type ConnectorId = "erp" | "wms" | "tms" | "telematics" | "demand" | "carrier_api" | "sheets";

export interface ConnectorDefinition {
  id: ConnectorId;
  name: string;
  description: string;
  populates: string[];
  provenance: "confirmed";
  cadence: "batch_daily" | "near_real_time" | "on_demand";
}

export const CONNECTORS: Record<ConnectorId, ConnectorDefinition> = {
  erp: { id: "erp", name: "ERP (SAP / Oracle / D365)", description: "Products, BOMs, costs, purchase orders, sales orders, transfer prices.", populates: ["Product families", "Unit values", "Procurement cost", "Demand by customer"], provenance: "confirmed", cadence: "batch_daily" },
  wms: { id: "wms", name: "WMS", description: "Inventory, throughput, dock utilisation and dwell time by facility.", populates: ["Inventory days", "Throughput", "Capacity utilisation", "Handling cost drivers"], provenance: "confirmed", cadence: "near_real_time" },
  tms: { id: "tms", name: "TMS", description: "Shipments, lanes, carriers, rates, transit times and on-time performance.", populates: ["Lane volumes", "Lane cost per case", "Transit days", "Reliability"], provenance: "confirmed", cadence: "batch_daily" },
  telematics: { id: "telematics", name: "Telematics & cold-chain sensors", description: "Vehicle positions, temperature excursions, fuel and emissions.", populates: ["Temperature compliance", "Emissions", "Transit variability"], provenance: "confirmed", cadence: "near_real_time" },
  demand: { id: "demand", name: "Demand planning / forecasting", description: "Forecasts, seasonality curves and promotional uplifts by region and family.", populates: ["Seasonality peak factors", "Demand scenarios"], provenance: "confirmed", cadence: "batch_daily" },
  carrier_api: { id: "carrier_api", name: "Carrier & parcel APIs", description: "Rate cards, capacity and service performance from carriers.", populates: ["Last-mile cost", "Parcel reliability"], provenance: "confirmed", cadence: "on_demand" },
  sheets: { id: "sheets", name: "Spreadsheet import (available)", description: "Upload the Meridian Excel template with nodes and lanes.", populates: ["Nodes", "Lanes", "Product families"], provenance: "confirmed", cadence: "on_demand" },
};

export type Role = "viewer" | "planner" | "approver" | "admin";

export interface Permission {
  action: "view" | "edit_scenario" | "confirm_scenario" | "edit_baseline" | "export" | "automate";
  roles: Role[];
  note?: string;
}

/** Role model reserved for later releases; the prototype runs as a single planner. */
export const PERMISSIONS: Permission[] = [
  { action: "view", roles: ["viewer", "planner", "approver", "admin"] },
  { action: "edit_scenario", roles: ["planner", "approver", "admin"] },
  { action: "confirm_scenario", roles: ["approver", "admin"], note: "Promoting a scenario to the baseline requires approver sign-off." },
  { action: "edit_baseline", roles: ["planner", "admin"], note: "Baseline edits are logged and attributed; the agent never edits the baseline silently." },
  { action: "export", roles: ["planner", "approver", "admin"] },
  { action: "automate", roles: [], note: "Automated execution is disabled in this release. Rules, trust and governance come first." },
];

export interface AutomationHook {
  id: string;
  trigger: string;
  proposedAction: string;
  status: "recommend_only";
}

export const AUTOMATION_HOOKS: AutomationHook[] = [
  { id: "cap_alert", trigger: "Facility utilisation forecast > 85% for 3+ weeks", proposedAction: "Raise overflow-space request with 3PL", status: "recommend_only" },
  { id: "lane_rel", trigger: "Lane OTIF < 88% for 4 consecutive weeks", proposedAction: "Open carrier performance review and re-tender", status: "recommend_only" },
  { id: "shelf_life", trigger: "Chilled transit consumes > 30% of shelf life", proposedAction: "Switch to alternative source or faster mode", status: "recommend_only" },
];
