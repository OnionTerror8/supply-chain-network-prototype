"use client";

import { cn } from "@/lib/utils";
import { CONFIDENCE_LABEL, PROVENANCE_LABEL, type Confidence, type Provenance, type Severity, type Tagged } from "@/lib/domain/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const PROVENANCE_COLOR: Record<Provenance, string> = {
  confirmed: "var(--prov-confirmed)",
  user: "var(--prov-user)",
  assumed: "var(--prov-assumed)",
  ai: "var(--prov-ai)",
  missing: "var(--prov-missing)",
};

export const PROVENANCE_SHORT: Record<Provenance, string> = {
  confirmed: "Confirmed",
  user: "User",
  assumed: "Assumed",
  ai: "AI est.",
  missing: "Missing",
};

export function ProvenanceDot({ source, className }: { source: Provenance; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: PROVENANCE_COLOR[source] }} aria-label={PROVENANCE_LABEL[source]} />
      </TooltipTrigger>
      <TooltipContent>{PROVENANCE_LABEL[source]}</TooltipContent>
    </Tooltip>
  );
}

export function ProvenanceBadge({ source, note, className }: { source: Provenance; note?: string; className?: string }) {
  const badge = (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none", className)} style={{ borderColor: `color-mix(in oklch, ${PROVENANCE_COLOR[source]} 40%, transparent)`, color: PROVENANCE_COLOR[source], background: `color-mix(in oklch, ${PROVENANCE_COLOR[source]} 10%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: PROVENANCE_COLOR[source] }} />
      {PROVENANCE_SHORT[source]}
    </span>
  );
  if (!note) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-64">
        <div className="font-medium">{PROVENANCE_LABEL[source]}</div>
        <div className="text-xs opacity-80">{note}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "var(--prov-confirmed)",
  medium: "var(--prov-assumed)",
  low: "var(--sev-high)",
  insufficient: "var(--prov-missing)",
};

export function ConfidenceBadge({ confidence, className, size = "sm" }: { confidence: Confidence; className?: string; size?: "sm" | "md" }) {
  const bars = confidence === "high" ? 3 : confidence === "medium" ? 2 : confidence === "low" ? 1 : 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 font-medium", size === "sm" ? "py-0.5 text-[10px]" : "py-1 text-xs", className)} style={{ borderColor: `color-mix(in oklch, ${CONFIDENCE_COLOR[confidence]} 40%, transparent)`, color: CONFIDENCE_COLOR[confidence], background: `color-mix(in oklch, ${CONFIDENCE_COLOR[confidence]} 10%, transparent)` }}>
      <span className="flex items-end gap-px" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-[3px] rounded-sm" style={{ height: 4 + i * 2, background: i < bars ? CONFIDENCE_COLOR[confidence] : "currentColor", opacity: i < bars ? 1 : 0.25 }} />
        ))}
      </span>
      {CONFIDENCE_LABEL[confidence]} confidence
    </span>
  );
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
  info: "var(--sev-info)",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", className)} style={{ color: SEVERITY_COLOR[severity], background: `color-mix(in oklch, ${SEVERITY_COLOR[severity]} 14%, transparent)` }}>
      {severity}
    </span>
  );
}

export function TaggedValue({ tagged, format, className }: { tagged?: Tagged<number | string>; format?: (v: number) => string; className?: string }) {
  if (!tagged) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", className)}>
        <span className="size-1.5 rounded-full" style={{ background: PROVENANCE_COLOR.missing }} />
        <span className="italic">not provided</span>
      </span>
    );
  }
  const v = typeof tagged.value === "number" && format ? format(tagged.value) : String(tagged.value);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1.5 tabular-nums", className)}>
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: PROVENANCE_COLOR[tagged.source] }} />
          {v}
          {tagged.range && typeof tagged.range[0] === "number" && format ? <span className="text-[10px] text-muted-foreground">({format(tagged.range[0] as number)}–{format(tagged.range[1] as number)})</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <div className="font-medium">{PROVENANCE_LABEL[tagged.source]}</div>
        {tagged.note ? <div className="text-xs opacity-80">{tagged.note}</div> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProvenanceLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {(Object.keys(PROVENANCE_LABEL) as Provenance[]).map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: PROVENANCE_COLOR[p] }} />
          {PROVENANCE_LABEL[p]}
        </span>
      ))}
    </div>
  );
}
