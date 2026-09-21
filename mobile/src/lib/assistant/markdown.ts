import { decodeHTMLStrict } from "entities";
import { Lexer, type Token, type Tokens } from "marked";

export type InlineText =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "emphasis" | "strike"; children: InlineText[] }
  | { kind: "link"; href: string | null; children: InlineText[] };

export type MarkdownBlock =
  | { kind: "paragraph"; children: InlineText[] }
  | { kind: "heading"; level: number; children: InlineText[] }
  | { kind: "quote"; children: MarkdownBlock[] }
  | { kind: "list"; items: { marker: string; children: MarkdownBlock[] }[] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: InlineText[][]; rows: InlineText[][][] };

/** Only explicit web links can leave a reply. Relative links and app/deep links cannot. */
export function safeMarkdownLink(href: string): string | null {
  if (!/^https?:\/\//i.test(href) || /[\s\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const url = new URL(href);
    if (!url.hostname || url.username || url.password) return null;
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const plain = (text: string): InlineText => ({ kind: "text", text });
const paragraph = (text: string): MarkdownBlock => ({ kind: "paragraph", children: [plain(text)] });

function inline(tokens: Token[], depth = 0, literal = false): InlineText[] {
  // Preserve the source rather than constructing an unbounded native view tree.
  if (depth > 24) return [plain(tokens.map((token) => token.raw).join(""))];
  return tokens.flatMap((token): InlineText[] => {
    switch (token.type) {
      case "strong":
      case "em":
      case "del":
        return [
          {
            kind: token.type === "strong" ? "strong" : token.type === "em" ? "emphasis" : "strike",
            children: inline(token.tokens ?? [], depth + 1, literal),
          },
        ];
      case "link": {
        const link = token as Tokens.Link;
        return [
          {
            kind: "link",
            href: safeMarkdownLink(link.autolink ? link.href : decodeHTMLStrict(link.href)),
            children: inline(link.tokens, depth + 1, literal || link.autolink === true),
          },
        ];
      }
      case "image":
        // Alt text remains readable; no remote resource is requested or rendered.
        return inline(token.tokens ?? [], depth + 1, literal);
      case "codespan":
        return [{ kind: "code", text: String(token.text) }];
      case "br":
        return [plain("\n")];
      case "escape":
      case "html":
        return [plain(String(token.text ?? token.raw))];
      case "text":
        return token.tokens
          ? inline(token.tokens, depth + 1, literal)
          : [plain(literal ? String(token.text) : decodeHTMLStrict(String(token.text)))];
      default:
        return [plain(token.raw)];
    }
  });
}

function blocks(tokens: Token[], depth = 0): MarkdownBlock[] {
  // Keep deeply nested model output inside a phone viewport; all remaining words stay visible.
  if (depth > 4) return [paragraph(tokens.map((token) => token.raw).join(""))];
  return tokens.flatMap((token): MarkdownBlock[] => {
    switch (token.type) {
      case "space":
      case "def":
        return [];
      case "heading":
        return [
          { kind: "heading", level: Number(token.depth), children: inline(token.tokens ?? []) },
        ];
      case "paragraph":
      case "text":
        return [
          {
            kind: "paragraph",
            children: token.tokens ? inline(token.tokens) : [plain(String(token.text))],
          },
        ];
      case "blockquote":
        return [{ kind: "quote", children: blocks(token.tokens ?? [], depth + 1) }];
      case "list": {
        const list = token as Tokens.List;
        const start = typeof list.start === "number" ? list.start : 1;
        return [
          {
            kind: "list",
            items: list.items.map((item, index) => ({
              marker: item.task
                ? item.checked
                  ? "☑"
                  : "☐"
                : list.ordered
                  ? `${start + index}.`
                  : "•",
              children: blocks(
                item.tokens.filter((child) => child.type !== "checkbox"),
                depth + 1,
              ),
            })),
          },
        ];
      }
      case "code":
        return [{ kind: "code", text: String(token.text) }];
      case "hr":
        return [{ kind: "rule" }];
      case "table": {
        const table = token as Tokens.Table;
        // GFM drops surplus cells. A malformed model table must not silently drop workout facts.
        if (
          table.raw
            .split("\n")
            .slice(2)
            .some((row) => tableCellCount(row) > table.header.length)
        ) {
          return [paragraph(table.raw)];
        }
        return [
          {
            kind: "table",
            header: table.header.map((cell) => inline(cell.tokens)),
            rows: table.rows.map((row) => row.map((cell) => inline(cell.tokens))),
          },
        ];
      }
      default:
        // Raw HTML and unsupported syntax are inert text, never native/web markup.
        return [paragraph(token.raw)];
    }
  });
}

function tableCellCount(row: string): number {
  const cells = [""];
  let escaped = false;
  for (const character of row.trim()) {
    if (character === "|" && !escaped) cells.push("");
    else cells[cells.length - 1] += character;
    escaped = character === "\\" && !escaped;
  }
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells.length;
}

/** Reparse the complete received prefix: partial Markdown stays visible until it closes. */
export function parseAssistantMarkdown(source: string): MarkdownBlock[] {
  try {
    return blocks(Lexer.lex(source, { gfm: true, breaks: false }));
  } catch {
    // A malformed model response must not hide its words or break the conversation.
    return [paragraph(source)];
  }
}
