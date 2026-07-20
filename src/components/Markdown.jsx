import { useState } from "react";

/**
 * Small markdown subset renderer: fenced code, headings, lists, blockquotes,
 * and inline code/bold/italic/links. Everything is built as React elements,
 * so model output is never injected as HTML.
 */

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^\s)]+\))/g;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable over plain http on some mobile browsers.
    }
  }

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span>{language || "code"}</span>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function Markdown({ content }) {
  const blocks = [];
  const lines = content.split("\n");
  let index = 0;
  let listBuffer = null;

  function flushList() {
    if (!listBuffer) return;
    const { ordered, items } = listBuffer;
    const Tag = ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blocks.length}`} className="md-list">
        {items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item, `li-${blocks.length}-${itemIndex}`)}</li>
        ))}
      </Tag>,
    );
    listBuffer = null;
  }

  while (index < lines.length) {
    const line = lines[index];

    // Fenced code block (kept open while streaming so partial code still shows).
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flushList();
      const language = fence[1];
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <CodeBlock key={`code-${blocks.length}`} language={language} code={body.join("\n")} />,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushList();
      const Tag = `h${Math.min(heading[1].length + 2, 6)}`;
      blocks.push(
        <Tag key={`h-${blocks.length}`} className="md-heading">
          {renderInline(heading[2], `h-${blocks.length}`)}
        </Tag>,
      );
      index += 1;
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!listBuffer || listBuffer.ordered !== ordered) {
        flushList();
        listBuffer = { ordered, items: [] };
      }
      listBuffer.items.push((bullet || numbered)[1]);
      index += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushList();
      blocks.push(
        <blockquote key={`q-${blocks.length}`} className="md-quote">
          {renderInline(quote[1], `q-${blocks.length}`)}
        </blockquote>,
      );
      index += 1;
      continue;
    }

    if (line.trim() === "") {
      flushList();
      index += 1;
      continue;
    }

    // Gather consecutive non-empty lines into one paragraph.
    flushList();
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !/^(#{1,4})\s/.test(lines[index]) &&
      !/^\s*([-*+]|\d+[.)])\s/.test(lines[index]) &&
      !lines[index].startsWith(">")
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="md-p">
        {renderInline(paragraph.join("\n"), `p-${blocks.length}`)}
      </p>,
    );
  }

  flushList();
  return <div className="md">{blocks}</div>;
}
