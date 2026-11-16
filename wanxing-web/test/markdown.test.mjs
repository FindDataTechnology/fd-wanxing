// ── Controlled markdown formatter (wanxing-first-impression 2.1–2.3) ──────────
//
// The formatter is a white-list: it can only ever emit <p> <br> <ul>/<ol>/<li>
// <pre><code> <code> <strong> <h4> <a> <hr>. Every other character is escaped.
// These tests pin both halves — what renders, and what can never render.
import assert from "node:assert/strict";
import { test } from "node:test";

import { installBrowserGlobals } from "./helpers.mjs";

installBrowserGlobals();

const { renderMarkdown } = await import("../src/chat-core.js");

// ── 2.1 supported constructs render ────────────────────────────────────────

test("2.1 paragraphs split on blank lines", () => {
  assert.equal(renderMarkdown("第一段\n\n第二段"), "<p>第一段</p><p>第二段</p>");
});

test("2.1 single newlines inside a paragraph become <br>", () => {
  assert.equal(renderMarkdown("a\nb"), "<p>a<br>b</p>");
});

test("2.1 unordered list renders ul/li", () => {
  assert.equal(renderMarkdown("- 一\n- 二"), "<ul><li>一</li><li>二</li></ul>");
});

test("2.1 ordered list renders ol/li", () => {
  assert.equal(renderMarkdown("1. 一\n2. 二"), "<ol><li>一</li><li>二</li></ol>");
});

test("2.1 inline code renders <code> and is not affected by bold parsing", () => {
  assert.equal(renderMarkdown("跑 `**x**` 看"), "<p>跑 <code>**x**</code> 看</p>");
});

test("2.1 fenced block renders pre>code, escaped, preserving newlines", () => {
  assert.equal(renderMarkdown("```\nconst a = 1 < 2;\n```"), "<pre><code>const a = 1 &lt; 2;</code></pre>");
});

test("2.1 bold renders <strong>", () => {
  assert.equal(renderMarkdown("这是**重点**内容"), "<p>这是<strong>重点</strong>内容</p>");
});

test("2.1 every heading level collapses to h4 (bubble scale, no h1–h3 semantics)", () => {
  assert.equal(renderMarkdown("### 小标题"), "<h4>小标题</h4>");
  assert.equal(renderMarkdown("# 大标题"), "<h4>大标题</h4>");
});

test("2.1 horizontal rule renders <hr>", () => {
  assert.equal(renderMarkdown("a\n\n---\n\nb"), "<p>a</p><hr><p>b</p>");
});

test("2.1 links render with target and rel", () => {
  assert.equal(
    renderMarkdown("见[文档](https://example.com/a)"),
    '<p>见<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">文档</a></p>',
  );
});

test("2.1 the real production shape renders structured", () => {
  // The exact shape真机 caught: agent answering with bold lead-ins and dashes.
  const src = "寻数做**壹座**平台：\n\n- **壹座（底座）**：多租户运行时\n- **万星**：agent 执行层";
  const html = renderMarkdown(src);
  assert.ok(html.includes("<strong>壹座</strong>"), "bold lead-in renders");
  assert.ok(html.includes("<ul>"), "the dash list becomes a list");
  assert.ok(!html.includes("**"), "no literal asterisks survive");
});

// ── 2.2 injection surface ──────────────────────────────────────────────────

test("2.2 raw HTML becomes escaped text", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.ok(!html.includes("<script"), "no script tag emitted");
  assert.ok(html.includes("&lt;script&gt;"), "it appears as text");
});

test("2.2 img / onerror attribute cannot pass through", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"), "no img tag emitted");
  assert.ok(!html.includes('onerror="'), "no live attribute emitted (quotes are escaped)");
  assert.ok(html.includes("onerror=&quot;"), "it appears as inert text");
});

test("2.2 javascript: link is not an anchor", () => {
  const html = renderMarkdown("[点我](javascript:alert(1))");
  assert.ok(!html.includes("<a "), "no anchor emitted");
  assert.ok(html.includes("javascript:alert(1)"), "it stays literal text");
});

test("2.2 data: and vbscript: links are not anchors", () => {
  for (const href of ["data:text/html,<script>", "vbscript:msgbox"]) {
    assert.ok(!renderMarkdown(`[x](${href})`).includes("<a "), `${href} must not become a link`);
  }
});

test("2.2 an unterminated fence still renders escaped code, no markup leaks", () => {
  const html = renderMarkdown("```\n<b>bold</b>");
  assert.equal(html, "<pre><code>&lt;b&gt;bold&lt;/b&gt;</code></pre>");
});

test("2.2 tables are not parsed — they stay plain text", () => {
  const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
  assert.ok(!html.includes("<table"), "no table");
  assert.ok(!html.includes("<tr"), "no row");
});

test("2.2 quote characters are escaped so they cannot break out of a href", () => {
  const html = renderMarkdown('[x](https://e.com/"onmouseover="alert(1))');
  assert.ok(!html.includes('onmouseover="'), "attribute injection does not survive");
});

// ── edge cases ─────────────────────────────────────────────────────────────

test("non-string and empty input return an empty string", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
  assert.equal(renderMarkdown(undefined), "");
  assert.equal(renderMarkdown(42), "");
});

test("CRLF input is normalized", () => {
  assert.equal(renderMarkdown("a\r\n\r\nb"), "<p>a</p><p>b</p>");
});

test("a list immediately after a paragraph is its own block", () => {
  assert.equal(renderMarkdown("说明：\n- 一\n- 二"), "<p>说明：</p><ul><li>一</li><li>二</li></ul>");
});
