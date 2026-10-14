"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";

/** Minimal markdown renderer for agent replies: bold, bullets, numbered lists, quotes, paragraphs. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.type;
    blocks.push(
      <Tag key={blocks.length} className={cn("my-1.5 space-y-1 pl-4", list.type === "ul" ? "list-disc" : "list-decimal")}>
        {list.items.map((it, i) => (
          <li key={i} className="leading-relaxed">
            <Inline text={it} />
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul) {
      if (!list || list.type !== "ul") {
        flush();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    if (ol) {
      if (!list || list.type !== "ol") {
        flush();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("> ")) {
      blocks.push(
        <blockquote key={blocks.length} className="my-1.5 border-l-2 border-primary/40 pl-3 text-foreground/90 italic">
          <Inline text={line.slice(2)} />
        </blockquote>,
      );
      continue;
    }
    blocks.push(
      <p key={blocks.length} className="my-1.5 leading-relaxed">
        <Inline text={line} />
      </p>,
    );
  }
  flush();
  return <div className={cn("text-[13px]", className)}>{blocks}</div>;
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
