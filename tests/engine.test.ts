import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFoodSample } from "../src/lib/data/food-sample";
import { findPlace, placeToLocation } from "../src/lib/domain/geo";
import { assumed } from "../src/lib/domain/helpers";
import type { Scenario } from "../src/lib/domain/types";
import { detectFindings } from "../src/lib/engine/findings";
import { applyHorizon } from "../src/lib/engine/horizon";
import { computeMetrics, costToServe } from "../src/lib/engine/metrics";
import { applyScenario, shouldReassignToNewSite } from "../src/lib/engine/scenarios";

function millions(n: number) {
  return Math.round(n / 1e5) / 10;
}

function pct1(n: number) {
  return Math.round(n * 1000) / 10;
}

function birminghamScenario(): Scenario {
  const place = findPlace("Birmingham");
  if (!place) throw new Error("gazetteer missing Birmingham");
  return {
    id: "sc_bham_test",
    name: "Add Birmingham RDC",
    description: "test",
    createdAt: new Date().toISOString(),
    createdBy: "agent",
    status: "draft",
    enablers: [],
    limitations: [],
    changes: [
      {
        type: "add_node",
        node: {
          id: "rdc_birmingham_new",
          name: "Birmingham RDC (proposed)",
          type: "regional_dc",
          temperature: "chilled",
          location: placeToLocation(place, "ai"),
          capacityPerWeek: assumed(40_000),
          inventoryDays: assumed(2.5),
          fixedCostPerYear: assumed(2_000_000),
          handlingCostPerCase: assumed(0.5),
          reliability: assumed(0.94),
          operator: assumed("3PL"),
        },
        serveNearest: ["store", "customer_zone", "wholesaler"],
        feedFrom: "ndc_daventry",
      },
    ],
  };
}

describe("food sample KPIs", () => {
  const model = buildFoodSample();
  const m = computeMetrics(model);

  it("pins the Fenland average-week headlines the overview shows", () => {
    assert.equal(millions(costToServe(m)), 117.4);
    assert.equal(millions(m.totalAnnualCost), 145.6);
    assert.equal(m.annualCases, 14_170_000);
    assert.equal(pct1(m.serviceLevel), 94.4);
  });

  it("marks Daventry, Spalding and Dartford as constrained", () => {
    assert.ok((m.nodeMetrics.ndc_daventry?.utilisation ?? 0) > 0.85);
    assert.ok((m.nodeMetrics.m_spalding?.utilisation ?? 0) > 0.85);
    assert.ok((m.nodeMetrics.rdc_dartford?.utilisation ?? 0) > 0.85);
    assert.equal(pct1(m.nodeMetrics.ndc_daventry!.utilisation!), 90.8);
  });
});

describe("peak horizon", () => {
  const model = buildFoodSample();
  const storedBham = model.lanes.find((l) => l.id === "l_ndc_bham")!.volumePerWeek.value;
  const peaked = applyHorizon(model, "peak");
  const peakM = computeMetrics(peaked);

  it("clones the model and leaves stored average volumes untouched", () => {
    assert.notEqual(peaked, model);
    assert.equal(model.lanes.find((l) => l.id === "l_ndc_bham")!.volumePerWeek.value, storedBham);
    assert.equal(applyHorizon(model, "average"), model);
  });

  it("scales Midlands customer lanes by the regional peak factor and rebalances upstream", () => {
    assert.equal(storedBham, 31_000);
    assert.equal(peaked.lanes.find((l) => l.id === "l_ndc_bham")!.volumePerWeek.value, 40_300);
    assert.ok((peakM.nodeMetrics.ndc_daventry?.utilisation ?? 0) > 1);
    assert.equal(millions(costToServe(peakM)), 183);
    assert.equal(peakM.annualCases, 18_643_560);
  });
});

describe("findings", () => {
  const model = buildFoodSample();
  const avg = computeMetrics(model);
  const avgF = detectFindings(model, avg, "average");
  const peaked = applyHorizon(model, "peak");
  const peakF = detectFindings(peaked, computeMetrics(peaked), "peak");

  it("detects the eighteen food-sample pinchpoints including capacity, shelf-life and the Birmingham opportunity", () => {
    assert.equal(avgF.length, 18);
    const ids = new Set(avgF.map((f) => f.id));
    for (const id of ["cap_ndc_daventry", "cap_m_spalding", "cap_rdc_dartford", "shelf_l_al_dover_raw_produce", "geo_p_dover", "opp_regional_ndc_daventry"]) {
      assert.ok(ids.has(id), `missing ${id}`);
    }
  });

  it("does not apply a second peak-factor multiply when the horizon is already peak", () => {
    const avgCap = avgF.find((f) => f.id === "cap_ndc_daventry")!;
    const peakCap = peakF.find((f) => f.id === "cap_ndc_daventry")!;
    assert.match(avgCap.detected, /Average weekly throughput/);
    assert.match(avgCap.detected, /seasonal peak this reaches/);
    assert.match(peakCap.detected, /Peak-week throughput of 359k/);
    assert.doesNotMatch(peakCap.detected, /seasonal peak this reaches/);
  });
});

describe("nearest-site reassignment", () => {
  it("takes a customer only when the new site is closer than every existing peer", () => {
    assert.equal(shouldReassignToNewSite(0, 69), true);
    assert.equal(shouldReassignToNewSite(90, 97), true);
    assert.equal(shouldReassignToNewSite(120, 30), false);
    assert.equal(shouldReassignToNewSite(210, 280), false);
  });

  it("moves Midlands volume onto a Birmingham RDC and sizes a trunk feed", () => {
    const baseline = buildFoodSample();
    const { model, log } = applyScenario(baseline, birminghamScenario());
    assert.equal(baseline.nodes.some((n) => n.id === "rdc_birmingham_new"), false);
    assert.ok(model.nodes.some((n) => n.id === "rdc_birmingham_new"));
    assert.equal(model.lanes.some((l) => l.from === "ndc_daventry" && l.to === "c_birmingham"), false);
    assert.equal(model.lanes.some((l) => l.from === "rdc_warrington" && l.to === "c_manchester"), true);
    const local = model.lanes.filter((l) => l.from === "rdc_birmingham_new");
    const trunk = model.lanes.find((l) => l.from === "ndc_daventry" && l.to === "rdc_birmingham_new");
    assert.equal(local.reduce((s, l) => s + l.volumePerWeek.value, 0), 49_000);
    assert.equal(trunk?.volumePerWeek.value, 49_000);
    const cap = model.nodes.find((n) => n.id === "rdc_birmingham_new")!.capacityPerWeek!.value;
    assert.ok(cap >= 49_000);
    assert.ok(log.some((line) => line.includes("Grocer DCs – Birmingham")));
    assert.ok(log.some((line) => line.includes("East Midlands")));
  });

  it("update_node patches a tagged field on the clone only", () => {
    const baseline = buildFoodSample();
    const { model } = applyScenario(baseline, {
      id: "sc_edit",
      name: "Lift Dartford capacity",
      description: "test",
      createdAt: new Date().toISOString(),
      createdBy: "user",
      status: "draft",
      enablers: [],
      limitations: [],
      changes: [{ type: "update_node", nodeId: "rdc_dartford", patch: { capacityPerWeek: { value: 90_000, source: "user", note: "Entered by user" } }, label: "capacity 90k" }],
    });
    assert.equal(model.nodes.find((n) => n.id === "rdc_dartford")?.capacityPerWeek?.value, 90_000);
    assert.equal(baseline.nodes.find((n) => n.id === "rdc_dartford")?.capacityPerWeek?.value, 70_000);
  });
});
