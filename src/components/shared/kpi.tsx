"use client";

import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Kpi({
  label,
  value,
  sub,
  delta,
  deltaLabel,
  good,
  hint,
  className,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  good?: boolean;
  hint?: string;
  className?: string;
  accent?: string;
}) {
  const neutral = delta === undefined || Math.abs(delta) < 1e-9;
  const content = (
    <div className={cn("relative overflow-hidden rounded-xl border bg-card p-3.5 shadow-xs", className)}>
      {accent ? <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} /> : null}
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {deltaLabel ? (
          <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums", neutral ? "bg-muted text-muted-foreground" : good ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/12 text-rose-700 dark:text-rose-400")}>
            {neutral ? <Minus className="size-3" /> : (delta ?? 0) > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {deltaLabel}
          </span>
        ) : null}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
  if (!hint) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-8 text-center">
      {Icon ? <Icon className="size-8 text-muted-foreground/60" /> : null}
      <div className="text-sm font-medium">{title}</div>
      {body ? <div className="max-w-sm text-xs text-muted-foreground">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
