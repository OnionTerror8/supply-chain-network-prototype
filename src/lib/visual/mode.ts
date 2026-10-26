import type { TransportMode } from "../domain/types";

/** Movement colours — mode, not temperature — so a first glance reads truck vs ship. */
export const MODE_COLOR: Record<TransportMode, string> = {
  road: "#c2782a",
  van: "#b45309",
  parcel: "#a16207",
  sea: "#0f6f73",
  rail: "#57534e",
  air: "#3d6b8a",
};

export const MODE_LABEL: Record<TransportMode, string> = {
  road: "Road (truck)",
  van: "Van",
  parcel: "Parcel",
  sea: "Sea (ship)",
  rail: "Rail",
  air: "Air",
};

export type VehicleKind = "truck" | "ship" | "van";

export function vehicleKind(mode: TransportMode): VehicleKind {
  if (mode === "sea") return "ship";
  if (mode === "van" || mode === "parcel") return "van";
  return "truck";
}

export const MODES_IN_LEGEND: TransportMode[] = ["road", "sea", "rail", "parcel"];
