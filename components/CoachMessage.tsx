import { parseCoachMarkdown, type Span } from "@/lib/coachMarkdown";

/**
 * Render one Coach reply with its Markdown actually applied.
 *
 * The panel used to print `turn.content` straight into a pre-wrap div, so a
 * debater read literal `**Impact**` and numbered advice arrived as one
 * undifferentiated block. Everything here is built from React elements — no
 * `dangerouslySetInnerHTML` — because a Coach reply can quote text the user
 * pasted in, and rendering that as markup would be an injection route through
 * the model.
 */

function Styled({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          return (
            <code key={i} className="frame bg-paper px-1 py-0.5 font-mono text-[0.85em]">
              {s.text}
            </code>
          );
        }
        // Bold and italic can co-occur, so they nest rather than branch.
        let node = <>{s.text}</>;
        if (s.italic) node = <em className="italic">{node}</em>;
        if (s.bold) node = <strong className="font-bold text-ink">{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

export default function CoachMessage({ content }: { content: string }) {
  const blocks = parseCoachMarkdown(content);

  // Nothing parseable (an empty reply) — render the raw text rather than an
  // empty bubble, so a response is never silently swallowed.
  if (blocks.length === 0) return <span className="whitespace-pre-wrap">{content}</span>;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <p key={i} className="font-display text-sm font-bold uppercase tracking-wide text-ink">
              <Styled spans={block.spans} />
            </p>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={i}
              className={`flex flex-col gap-2 pl-5 ${
                block.ordered ? "list-decimal" : "list-disc"
              } marker:text-ink/50`}
            >
              {block.items.map((item, j) => (
                <li key={j} className="pl-1">
                  <Styled spans={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          // pre-wrap preserves the soft line breaks the Coach uses to separate
          // points inside a single paragraph.
          <p key={i} className="whitespace-pre-wrap">
            <Styled spans={block.spans} />
          </p>
        );
      })}
    </div>
  );
}
