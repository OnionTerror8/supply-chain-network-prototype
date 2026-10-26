"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

function useAnimatedNumber(target: number, enabled: boolean) {
  const [value, setValue] = useState(enabled ? 0 : target);
  const fromRef = useRef(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 800);
      const eased = 1 - (1 - t) ** 3;
      const next = from + (target - from) * eased;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return value;
}

export function Kpi({
  label,
  value,
  raw,
  format,
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
  raw?: number;
  format?: (n: number) => string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  good?: boolean;
  hint?: string;
  className?: string;
  accent?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const animated = useAnimatedNumber(raw ?? 0, raw != null && !reduced);
  const display = raw != null && format ? format(animated) : value;
  const neutral = delta === undefined || Math.abs(delta) < 1e-9;
  const content = (
    <div className={cn("relative overflow-hidden rounded-xl border bg-card p-3.5 shadow-xs transition-colors hover:border-primary/30", className)}>
      {accent ? <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} /> : null}
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{display}</div>
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
