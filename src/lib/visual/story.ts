import type { InspectStory } from "../store";
import type { Lane, LaneMetrics } from "../domain/types";
import { fmtMoney, fmtNum } from "../domain/helpers";
import { MODE_LABEL } from "./mode";

export const INSPECT_STORIES: { id: InspectStory; label: string; hint: string }[] = [
  { id: "volume", label: "Volume story", hint: "Cases per week and utilisation" },
  { id: "cost", label: "Cost story", hint: "Annual cost and cost per case" },
  { id: "lead", label: "Lead-time story", hint: "Distance, transit and inventory days" },
  { id: "pinch", label: "Pinchpoint story", hint: "Findings and constrained sites" },
  { id: "path", label: "Path story", hint: "Mode, pattern, temperature and operator" },
];

export function laneStoryLabel(
  story: InspectStory,
  lane: Lane,
  lm: LaneMetrics | undefined,
  currency: string,
  peak: boolean,
): string {
  const vol = fmtNum(lm?.volumePerWeek ?? lane.volumePerWeek.value);
  const mode = MODE_LABEL[lane.mode];
  if (story === "cost") return lm ? `${fmtMoney(lm.annualCost, currency)}/yr · ${fmtMoney(lm.costPerCase, currency, false)}/case` : `${mode} · cost unknown`;
  if (story === "lead") return lm ? `${Math.round(lm.distanceKm)} km · ${lm.transitDays.toFixed(1)} d` : `${mode} · lead unknown`;
  if (story === "pinch") return `${mode} · ${vol}/wk${peak ? " peak" : ""}`;
  if (story === "path") return `${mode}${lane.pattern ? ` · ${lane.pattern.replaceAll("_", " ")}` : ""} · ${lane.temperature}`;
  return `${vol}/wk${peak ? " peak" : ""} · ${mode}`;
}
