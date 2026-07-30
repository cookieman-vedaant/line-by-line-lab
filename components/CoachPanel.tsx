"use client";

import { useEffect, useRef, useState } from "react";
import CardView from "@/components/CardView";
import { requestAssistant } from "@/lib/apiClient";
import type { Article, AssistantContext, Card } from "@/types";

interface Turn {
  role: "user" | "assistant";
  content: string;
  articles?: Article[];
  card?: Card;
}

interface CoachPanelProps {
  /** Optional hint about what the debater is working on (from the last search). */
  context?: AssistantContext;
}

const STARTERS = [
  "Help me build a link chain from AI development to extinction.",
  "Find me an accessible Impact article that nuclear power reduces carbon emissions.",
  "What are the strongest answers to a security K on my aff?",
];

/** The Coach: a conversational debate-prep agent that finds articles and cuts cards. */
export default function CoachPanel({ context }: CoachPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setError(null);
    const nextTurns: Turn[] = [...turns, { role: "user", content: msg }];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);

    const outcome = await requestAssistant({
      messages: nextTurns.map((t) => ({ role: t.role, content: t.content })),
      context,
    });
    setBusy(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setTurns((cur) => [
      ...cur,
      {
        role: "assistant",
        content: outcome.result.reply,
        articles: outcome.result.articles,
        card: outcome.result.card,
      },
    ]);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        {turns.length === 0 && (
          <div className="frame bg-paper-2 p-5">
            <p className="font-display text-lg font-bold">
              👋 I&apos;m your debate <span className="text-accent">Coach</span>.
            </p>
            <p className="mt-2 text-sm font-medium leading-relaxed text-ink/80">
              Ask me anything — brainstorm arguments, build a link chain, structure a case or
              block, plan strategy, or find real evidence and cut a card. I&apos;ll coach you
              through it; I won&apos;t write your case for you or make up sources.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="btn-press frame bg-paper px-3 py-2 text-left text-sm font-medium hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={turn.role === "user" ? "max-w-[85%]" : "w-full"}>
              <div
                className={`frame px-4 py-3 text-sm font-medium leading-relaxed whitespace-pre-wrap ${
                  turn.role === "user" ? "bg-accent text-paper" : "bg-paper-2 text-ink"
                }`}
              >
                {turn.content}
              </div>

              {turn.articles && turn.articles.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {turn.articles.map((a) => (
                    <li key={a.url} className="frame bg-paper p-3">
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-display text-sm font-bold leading-tight hover:text-accent hover:underline"
                        >
                          {a.title}
                        </a>
                        {a.accessible && (
                          <span className="label-mono frame shrink-0 bg-accent px-1.5 py-0.5 text-[9px] text-paper">
                            ✓ full text
                          </span>
                        )}
                      </div>
                      <p className="label-mono mt-1 text-[10px] text-ink/60">
                        {a.author} · {a.publication} · {a.date}
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void send(`Cut a Medium card from this article: ${a.url}`)}
                        className="btn-press frame mt-2 bg-ink px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-wide text-paper"
                      >
                        ✂ Cut this
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {turn.card && (
                <div className="mt-3">
                  <CardView card={turn.card} />
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <p className="label-mono animate-pulse text-sm text-accent">▸ coach is working…</p>
        )}
        {error && (
          <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 flex items-end gap-2 bg-paper pt-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask the coach to find an article or cut a card…"
          className="w-full frame resize-y bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink
            placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="btn-press frame bg-accent px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-paper"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
