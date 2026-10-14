import { NextResponse } from "next/server";
import { CONNECTORS, type ConnectorId } from "@/lib/integrations/connectors";

/**
 * GET /api/integrations/:connector
 *
 * Architecture placeholder for operational data sources (ERP, WMS, TMS,
 * telematics, demand sensing). Each connector declares the entities it can
 * populate and the provenance it would assign ("confirmed"). None are wired in
 * the prototype; the endpoint reports status so the UI can show them honestly.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ connector: string }> }) {
  const { connector } = await ctx.params;
  const def = CONNECTORS[connector as ConnectorId];
  if (!def) return NextResponse.json({ error: `Unknown connector '${connector}'` }, { status: 404 });
  return NextResponse.json({ ...def, status: "not_configured", message: `${def.name} connector is a placeholder in this release.` }, { status: 501 });
}
