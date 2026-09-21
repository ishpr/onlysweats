import assert from "node:assert/strict";
import test from "node:test";
import { parseAssistantMarkdown, safeMarkdownLink } from "./markdown.ts";

function text(nodes) {
  return nodes
    .map((node) => {
      if ("text" in node) return node.text;
      if ("children" in node) return text(node.children);
      if (node.kind === "list") return node.items.map((item) => text(item.children)).join("\n");
      if (node.kind === "table")
        return [node.header, ...node.rows].map((row) => row.map(text).join(" | ")).join("\n");
      return "";
    })
    .join("");
}

test("coach prose keeps workout facts and gains heading, emphasis and paragraph structure", () => {
  const nodes = parseAssistantMarkdown(
    "## Your session\n\n**Squat:** 3 × 8 at 40 kg. *Rest 90 seconds.*\n\nPlanned distance: 2.5 mi; recorded heart rate: unknown.",
  );
  assert.deepEqual(
    nodes.map((node) => node.kind),
    ["heading", "paragraph", "paragraph"],
  );
  assert.equal(nodes[1].children[0].kind, "strong");
  assert.equal(nodes[1].children[2].kind, "emphasis");
  assert.equal(
    text(nodes),
    "Your sessionSquat: 3 × 8 at 40 kg. Rest 90 seconds.Planned distance: 2.5 mi; recorded heart rate: unknown.",
  );
});

test("ordered steps preserve their start, nested lists, continuation text and task state", () => {
  const [list] = parseAssistantMarkdown(
    "3. **Warm up**\n   5 minutes easy.\n   - Arm circles\n   - Hip circles\n4. Work sets\n\n   Keep the load comfortable.\n5. Finish\n   - [x] Water\n   - [ ] Cool down",
  );
  assert.equal(list.kind, "list");
  assert.deepEqual(
    list.items.map((item) => item.marker),
    ["3.", "4.", "5."],
  );
  assert.equal(list.items[0].children[1].kind, "list");
  assert.match(text(list.items[0].children), /Warm up\n5 minutes easy\.Arm circles\nHip circles/);
  assert.match(text(list.items[1].children), /Keep the load comfortable\./);
  assert.deepEqual(
    list.items[2].children[1].items.map((item) => item.marker),
    ["☑", "☐"],
  );
  assert.doesNotMatch(text(list.items[2].children), /\[x\]|\[ \]/);
});

test("quotes, code, separators and tables preserve literal numbers and code characters", () => {
  const nodes = parseAssistantMarkdown(
    "> This is a target, not a measured result.\n\nUse `rest < 90 && ready`.\n\n```text\n3 * 8 = 24\n&amp;\n```\n\n---\n\n| Exercise | Target |\n| --- | --- |\n| **Plank** | 30 s |\n| Run | 9:00–10:00 min/mi |",
  );
  assert.deepEqual(
    nodes.map((node) => node.kind),
    ["quote", "paragraph", "code", "rule", "table"],
  );
  assert.equal(nodes[2].text, "3 * 8 = 24\n&amp;");
  assert.equal(text(nodes[4].rows[1][1]), "9:00–10:00 min/mi");
});

test("only absolute http(s) destinations without embedded credentials or controls are actionable", () => {
  assert.equal(safeMarkdownLink("https://example.com/a?b=2#c"), "https://example.com/a?b=2#c");
  assert.equal(safeMarkdownLink("HTTP://example.com"), "http://example.com/");
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "samepace://workout/1",
    "mailto:a@example.com",
    "/workout/1",
    "//example.com",
    " https://example.com",
    "https://a:b@example.com",
    "https://exa\nmple.com",
    "https://",
  ]) {
    assert.equal(safeMarkdownLink(href), null, href);
  }
  const [paragraph] = parseAssistantMarkdown(
    "[Safe](https://example.com/?a=1&amp;b=2) and [Unsafe](javascript:alert%281%29)",
  );
  assert.equal(paragraph.children[0].href, "https://example.com/?a=1&b=2");
  assert.equal(paragraph.children[2].href, null);
  assert.equal(text([paragraph]), "Safe and Unsafe");
});

test("HTML is literal inert text and image URLs are never included as renderable resources", () => {
  const source =
    '<script>alert("hi")</script>\n\n![Squat position](https://example.com/tracker.png)\n\nBefore <img src="https://example.com/pixel"> after';
  const nodes = parseAssistantMarkdown(source);
  assert.match(text(nodes), /<script>alert\("hi"\)<\/script>/);
  assert.match(text(nodes), /Squat position/);
  assert.match(text(nodes), /Before <img src="https:\/\/example.com\/pixel"> after/);
  assert.ok(!JSON.stringify(nodes).includes("tracker.png"));
});

test("encoded entities render as prose without changing code, autolinks or escaped markers", () => {
  assert.equal(
    text(parseAssistantMarkdown("R&amp;R &#x00d7; 3 &ndash; 5 \u2014 `&amp;` \\*literal\\*")),
    "R&R × 3 – 5 — &amp; *literal*",
  );
  assert.equal(
    text(parseAssistantMarkdown("https://example.com/?a=1&amp;b=2")),
    "https://example.com/?a=1&amp;b=2",
  );
});

test("every streamed prefix remains renderable and incomplete syntax stays visible", () => {
  const reply =
    "## Today\n\n**Warm up** for 5 minutes.\n\n1. Squat — 3 × 8\n   - Rest 90 s\n2. Plank — 30 s\n\n[Details](https://example.com/plan)\n\n```text\n2 × 30 s\n```";
  for (let end = 0; end <= reply.length; end++) {
    const nodes = parseAssistantMarkdown(reply.slice(0, end));
    assert.ok(Array.isArray(nodes));
    assert.doesNotThrow(() => text(nodes));
  }
  assert.equal(text(parseAssistantMarkdown("**Warm up")), "**Warm up");
  assert.equal(text(parseAssistantMarkdown("[Details](")), "[Details](");
  assert.equal(text(parseAssistantMarkdown("```text\n2 × 30 s")), "2 × 30 s");
});

test("malformed tables preserve surplus workout facts instead of silently dropping cells", () => {
  const source = "| Exercise | Target |\n| --- | --- |\n| Plank | 30 s | Recorded HR: 165 bpm |";
  const nodes = parseAssistantMarkdown(source);
  assert.equal(nodes[0].kind, "paragraph");
  assert.equal(text(nodes), source);
  const escaped = parseAssistantMarkdown(
    "| Cue | Target |\n| --- | --- |\n| left \\| right | 30 s |",
  );
  assert.equal(escaped[0].kind, "table");
  assert.equal(text(escaped[0].rows[0][0]), "left | right");
});

test("deep nesting falls back to readable source and retains physiological facts", () => {
  const nodes = parseAssistantMarkdown(`${"> ".repeat(30)}Recorded HR: 165 bpm; effort unknown.`);
  let current = nodes;
  let depth = 0;
  while (current[0].kind === "quote") {
    depth++;
    current = current[0].children;
  }
  assert.ok(depth <= 5);
  assert.match(text(nodes), /Recorded HR: 165 bpm; effort unknown\./);
});
