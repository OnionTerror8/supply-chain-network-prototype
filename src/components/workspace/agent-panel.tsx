"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Loader2, SendHorizontal, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "@/components/shared/markdown";
import { ConfidenceBadge } from "@/components/shared/badges";
import { useActive, useWorkspace, type ChatMessage } from "@/lib/store";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Where is our biggest resilience risk?",
  "Which routes are most expensive per case?",
  "What happens if the national DC runs at 90% capacity?",
  "Show me a cross-dock alternative for fast-moving lines",
  "What happens if demand in the South East grows 25%?",
  "What if we lose the Dover port for two weeks?",
  "Which assumptions drive this result most?",
  "What information would most improve confidence?",
  "Explain the network to an executive",
  "Export this to Excel",
];

export function AgentPanel() {
  const messages = useWorkspace((s) => s.messages);
  const busy = useWorkspace((s) => s.agentBusy);
  const sendMessage = useWorkspace((s) => s.sendMessage);
  const setAgentOpen = useWorkspace((s) => s.setAgentOpen);
  const pending = useWorkspace((s) => s.pendingSetup);
  const { baseline, scenario, isScenario } = useActive();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const submit = (text?: string) => {
    const t = (text ?? draft).trim();
    if (!t) return;
    setDraft("");
    void sendMessage(t);
    inputRef.current?.focus();
  };

  const lastAgent = [...messages].reverse().find((m) => m.role === "agent");

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary"><Bot className="size-3.5" /></span>
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-semibold">Planning agent</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {isScenario ? <span className="text-amber-700 dark:text-amber-300">Working in scenario: {scenario?.name}</span> : baseline ? "Working on the baseline (changes need confirmation)" : "No network yet — describe one to begin"}
          </div>
        </div>
        <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => setAgentOpen(false)} aria-label="Close agent panel"><X /></Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <Message key={m.id} m={m} onChip={submit} isLast={m.id === lastAgent?.id} />
          ))}
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Analysing the network…
            </div>
          ) : null}
        </div>
      </div>

      {baseline && !pending ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-t px-3 py-2 scrollbar-thin">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => submit(s)} disabled={busy} className="shrink-0 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="shrink-0 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={baseline ? "Ask a question or describe a change to test…" : "Describe your network, e.g. five suppliers into two factories, an NDC feeding regional DCs then stores…"}
            rows={2}
            className="resize-none pr-10 text-[13px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button type="submit" size="icon-sm" className="absolute right-1.5 bottom-1.5" disabled={busy || !draft.trim()} aria-label="Send">
            <SendHorizontal />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="size-3" /> Recommends, never executes. Scenario changes are labelled and reversible.
        </div>
      </form>
    </div>
  );
}

function Message({ m, onChip, isLast }: { m: ChatMessage; onChip: (t: string) => void; isLast: boolean }) {
  const user = m.role === "user";
  return (
    <div className={cn("flex gap-2", user && "flex-row-reverse")}>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", user ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
        {user ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </span>
      <div className={cn("min-w-0 max-w-[88%] rounded-2xl px-3 py-2", user ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm border bg-background")}>
        {user ? <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.text}</p> : <Markdown text={m.text} />}
        {!user && m.confidence ? <div className="mt-2"><ConfidenceBadge confidence={m.confidence} /></div> : null}
        {!user && m.assumptions?.length ? (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" /> {m.assumptions.length} assumption{m.assumptions.length === 1 ? "" : "s"} used
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {m.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {!user && m.chips?.length && isLast ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.chips.map((c) => (
              <button key={c} onClick={() => onChip(c)} className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-left text-[11px] text-primary transition-colors hover:bg-primary/10">
                {c.length > 90 ? `${c.slice(0, 88)}…` : c}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
