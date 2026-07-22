import { useState } from "react";

/**
 * Small markdown subset renderer: fenced code, headings, lists, blockquotes,
 * and inline code/bold/italic/links. Everything is built as React elements,
 * so model output is never injected as HTML.
 */

// Order matters only for ties: the scan is left-to-right, so a `[1]` sitting
// inside a code span is consumed by the backtick token first and stays literal.
// Citation markers look like [3] or [3, 4] and are matched last so they cannot
// shadow a real markdown link such as [text](url).
// The last alternative autolinks bare URLs, which is how the model usually
// emits them. A URL inside [text](url) never reaches it: the link alternative
// matches first at the "[" and consumes the whole thing. Same for code spans.
const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^\s)]+\))|(\[\s*\d+(?:\s*,\s*\d+)*\s*\])|((?:https?:\/\/|www\.)[^\s<>"'`]+)/g;

/**
 * Splits trailing characters that punctuate the sentence rather than belong to
 * the URL: "see https://x.com/a." or "(https://x.com/a)". Closing brackets are
 * only trimmed when unbalanced, so Wikipedia-style /Foo_(bar) URLs survive.
 */
function splitUrlTail(raw) {
  let url = raw;
  let tail = "";

  while (url.length > 0) {
    const last = url[url.length - 1];

    if (".,;:!?".includes(last)) {
      tail = last + tail;
      url = url.slice(0, -1);
      continue;
    }

    if (last === ")" || last === "]" || last === "}") {
      const open = { ")": "(", "]": "[", "}": "{" }[last];
      const opens = url.split(open).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        tail = last + tail;
        url = url.slice(0, -1);
        continue;
      }
    }

    break;
  }

  return [url, tail];
}

function Citations({ indices, sources }) {
  const known = indices
    .map((n) => sources.find((source) => source.index === n))
    .filter(Boolean);

  // An index with no matching source would render as a dead link; leave the
  // original text alone instead of inventing a reference.
  if (known.length === 0) return null;

  return (
    <sup className="cite">
      {known.map((source) => (
        <a
          key={source.index}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${source.title}\n${source.url}`}
        >
          {source.index}
        </a>
      ))}
    </sup>
  );
}

function renderInline(text, keyPrefix, sources = null) {
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    const citation = /^\[\s*\d+(?:\s*,\s*\d+)*\s*\]$/.test(token);

    if (citation) {
      const indices = token.slice(1, -1).split(",").map((n) => Number(n.trim()));
      const known = indices.filter((n) => sources?.some((s) => s.index === n));
      // Keep the literal text when nothing resolves -- while the answer is
      // still streaming the sources may not have arrived, and silently
      // deleting what the model wrote would be worse than showing "[3, 4]".
      if (known.length > 0) {
        nodes.push(<Citations key={key} indices={known} sources={sources} />);
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (/^(?:https?:\/\/|www\.)/.test(token)) {
      const [url, tail] = splitUrlTail(token);
      nodes.push(
        <a
          key={key}
          className="md-autolink"
          href={url.startsWith("www.") ? `https://${url}` : url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url}
        </a>,
      );
      // Whatever was punctuation goes back as plain text.
      if (tail) nodes.push(tail);
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

export default function Markdown({ content, sources = null }) {
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
          <li key={itemIndex}>{renderInline(item, `li-${blocks.length}-${itemIndex}`, sources)}</li>
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
          {renderInline(heading[2], `h-${blocks.length}`, sources)}
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
          {renderInline(quote[1], `q-${blocks.length}`, sources)}
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
        {renderInline(paragraph.join("\n"), `p-${blocks.length}`, sources)}
      </p>,
    );
  }

  flushList();
  return <div className="md">{blocks}</div>;
}
