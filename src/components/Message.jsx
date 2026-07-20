import { useState } from "react";
import Markdown from "./Markdown";

function Attachments({ attachments }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="message-attachments">
      {attachments.map((attachment) =>
        attachment.kind === "image" && attachment.dataUrl ? (
          <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} className="message-image" />
        ) : (
          <span key={attachment.id} className="message-file">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
                stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round"
              />
            </svg>
            {attachment.name}
          </span>
        ),
      )}
    </div>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Two-part public suffixes we care about, so bbc.co.uk reads "bbc", not "co".
const COMPOUND_TLD = /\.(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/;

/** en.wikipedia.org -> "wikipedia", www.nbcnews.com -> "nbcnews" */
function siteNameOf(url) {
  const host = hostOf(url);
  if (!host) return "source";
  const bare = host.replace(COMPOUND_TLD, "").replace(/\.[a-z]{2,}$/, "");
  const parts = bare.split(".").filter(Boolean);
  // Drop subdomains ("en", "news"): the last label is the brand.
  return parts[parts.length - 1] || host;
}

function SourceIcon({ url, name }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);

  // Resolved through Google's favicon service: most news sites either 404 or
  // block hotlinking on /favicon.ico (2 of 4 failed when tested directly).
  // Trade-off: rendering an answer tells Google which domains were cited.
  // Anything it cannot resolve falls back to a lettered circle.
  if (failed || !host) {
    return <span className="source-icon source-icon-fallback">{name.charAt(0).toUpperCase()}</span>;
  }

  return (
    <img
      className="source-icon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relativeTime(timestamp) {
  if (!timestamp) return "";
  const elapsed = Date.now() - timestamp;

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

const ICONS = {
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" fill="none" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </>
  ),
  retry: (
    <path
      d="M4 9h9a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4"
      stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"
    />
  ),
  branch: (
    <>
      <circle cx="7" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.7" fill="none" />
      <circle cx="7" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.7" fill="none" />
      <circle cx="17" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.7" fill="none" />
      <path d="M7 8.2v7.6M17 12.2c0 2.4-2 3.8-5 3.8" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </>
  ),
  check: (
    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  ),
};

function ActionButton({ icon, label, onClick, disabled }) {
  return (
    <button type="button" className="action-button" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">{ICONS[icon]}</svg>
    </button>
  );
}

/**
 * navigator.clipboard is unavailable on plain http and can be blocked by
 * permission policy even on a secure origin, so fall back to a throwaway
 * textarea + execCommand. Deprecated, but it is the only thing that works
 * in those cases.
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path.
  }

  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
  document.body.appendChild(scratch);

  try {
    scratch.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    scratch.remove();
  }
}

function MessageActions({ message, onRetry, onBranch, isBusy }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyText(message.content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div className="message-actions">
      <ActionButton icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy"} onClick={copy} />
      <ActionButton
        icon="retry"
        label={message.role === "user" ? "Send again" : "Try again"}
        onClick={() => onRetry?.(message.id)}
        disabled={isBusy}
      />
      <ActionButton icon="branch" label="Branch from here" onClick={() => onBranch?.(message.id)} disabled={isBusy} />
      <time className="message-time" dateTime={message.createdAt ? new Date(message.createdAt).toISOString() : undefined}>
        {relativeTime(message.createdAt)}
      </time>
    </div>
  );
}

const MAX_STACKED_ICONS = 4;

function Sources({ sources }) {
  const [expanded, setExpanded] = useState(false);
  if (!sources || sources.length === 0) return null;

  const stacked = sources.slice(0, MAX_STACKED_ICONS);
  const overflow = sources.length - stacked.length;

  return (
    <section className="sources" aria-label="Sources">
      <button
        type="button"
        className="sources-toggle"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        // The visible label is a count beside decorative icons; spell out the
        // action so it is not announced as a bare "button".
        aria-label={`${expanded ? "Hide" : "Show"} ${sources.length} sources`}
      >
        <span className="source-stack">
          {stacked.map((source) => (
            <SourceIcon key={source.index} url={source.url} name={siteNameOf(source.url)} />
          ))}
          {overflow > 0 && <span className="source-icon source-icon-more">+{overflow}</span>}
        </span>
        <span className="sources-count">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
        <svg
          className={`sources-chevron${expanded ? " sources-chevron-open" : ""}`}
          viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <ol className="sources-list">
          {sources.map((source) => (
            <li key={source.index}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="source-row"
                // Row titles are clipped to one line, so keep the full
                // headline reachable on hover and for assistive tech.
                title={source.title}
              >
                <span className="source-row-index">{source.index}</span>
                <SourceIcon url={source.url} name={siteNameOf(source.url)} />
                <span className="source-row-text">
                  <span className="source-row-title">{source.title}</span>
                  <span className="source-row-host">{hostOf(source.url)}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function Message({ message, isStreaming, isBusy, onRetry, onBranch }) {
  if (message.role === "user") {
    return (
      <article className="message message-user">
        <div className="message-user-inner">
          <Attachments attachments={message.attachments} />
          {message.content && <div className="bubble">{message.content}</div>}
          <MessageActions message={message} onRetry={onRetry} onBranch={onBranch} isBusy={isBusy} />
        </div>
      </article>
    );
  }

  const isEmpty = message.content.length === 0;

  return (
    <article className="message message-assistant">
      <div className="avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path
            d="M12 3l2.2 5.6L20 10.8l-5.8 2.2L12 19l-2.2-5.9L4 10.8l5.8-2.2L12 3z"
            fill="currentColor"
          />
        </svg>
      </div>

      <div className="message-content">
        {isEmpty && isStreaming ? (
          // Sources land before the first token, so show them straight away
          // rather than leaving a bare spinner during the model's prefill.
          <>
            <div className="loading-dots" aria-label={message.sources?.length ? "Reading sources" : "Thinking"}>
              <span /><span /><span />
            </div>
            <Sources sources={message.sources} />
          </>
        ) : (
          <>
            <Markdown content={message.content} sources={message.sources} />
            {isStreaming && <span className="caret" aria-hidden="true" />}
            <Sources sources={message.sources} />
          </>
        )}

        {!isStreaming && !isEmpty && (
          <MessageActions message={message} onRetry={onRetry} onBranch={onBranch} isBusy={isBusy} />
        )}
      </div>
    </article>
  );
}
