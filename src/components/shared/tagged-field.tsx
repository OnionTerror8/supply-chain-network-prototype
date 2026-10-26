"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ProvenanceBadge, TaggedValue } from "./badges";
import type { Tagged } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

function asUserTagged(draft: string, tagged: Tagged | undefined, format?: (v: number) => string): Tagged | undefined {
  const n = Number(draft);
  if (draft.trim() === "" || Number.isNaN(n)) return undefined;
  if (tagged && n === tagged.value && tagged.source === "user") return undefined;
  return {
    value: n,
    source: "user",
    note: `Entered by user${tagged && tagged.source !== "user" ? ` (previously ${tagged.source}: ${format ? format(tagged.value) : tagged.value})` : ""}`,
  };
}

/**
 * Inline editor for a Tagged number. Editing marks the value as user-entered and
 * records a note so the provenance trail stays intact.
 */
export function TaggedField({
  label,
  tagged,
  format,
  unit,
  step,
  onChange,
  hint,
  className,
}: {
  label: string;
  tagged?: Tagged;
  format?: (v: number) => string;
  unit?: string;
  step?: number;
  onChange: (t: Tagged) => void;
  hint?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    setEditing(false);
    const next = asUserTagged(draft, tagged, format);
    if (next) onChange(next);
  };

  return (
    <div className={cn("group flex items-center justify-between gap-2 py-1.5", className)} title={hint}>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        {tagged?.note && !editing ? <div className="truncate text-[10px] text-muted-foreground/70">{tagged.note}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <Input autoFocus type="number" step={step ?? "any"} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} className="h-7 w-28 text-right text-xs tabular-nums" />
        ) : (
          <button onClick={() => { setDraft(tagged ? String(tagged.value) : ""); setEditing(true); }} className="inline-flex items-center gap-1 rounded-md px-1 text-right text-sm tabular-nums hover:bg-muted">
            {tagged ? (
              <>
                {format ? format(tagged.value) : tagged.value}
                {unit ? <span className="text-[10px] text-muted-foreground">{unit}</span> : null}
              </>
            ) : (
              <span className="text-xs text-muted-foreground italic">add value</span>
            )}
            <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        )}
        <ProvenanceBadge source={tagged?.source ?? "missing"} note={tagged?.range ? `Range ${format ? format(tagged.range[0]) : tagged.range[0]} – ${format ? format(tagged.range[1]) : tagged.range[1]}` : tagged?.note} />
      </div>
    </div>
  );
}

/** Compact table-cell editor. Click to type; commit marks the value as user-entered. */
export function TaggedCell({
  tagged,
  format,
  step,
  onChange,
  ariaLabel,
}: {
  tagged?: Tagged;
  format: (v: number) => string;
  step?: number;
  onChange: (t: Tagged) => void;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    setEditing(false);
    const next = asUserTagged(draft, tagged, format);
    if (next) onChange(next);
  };

  return (
    <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {editing ? (
        <Input
          autoFocus
          type="number"
          step={step ?? "any"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="ml-auto h-7 w-24 text-right text-xs tabular-nums"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(tagged ? String(tagged.value) : "");
            setEditing(true);
          }}
          className="group inline-flex items-center justify-end gap-1 rounded-md px-1 text-right hover:bg-muted"
          aria-label={ariaLabel ?? (tagged ? `Edit ${format(tagged.value)}` : "Add value")}
        >
          <TaggedValue tagged={tagged} format={format} />
          <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      )}
    </span>
  );
}
