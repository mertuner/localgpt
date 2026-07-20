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

export default function Message({ message, isStreaming }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <article className="message message-user">
        <div className="message-user-inner">
          <Attachments attachments={message.attachments} />
          {message.content && <div className="bubble">{message.content}</div>}
        </div>
      </article>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard requires a secure context; ignore when unavailable.
    }
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
          <div className="loading-dots" aria-label="Thinking">
            <span /><span /><span />
          </div>
        ) : (
          <>
            <Markdown content={message.content} />
            {isStreaming && <span className="caret" aria-hidden="true" />}
          </>
        )}

        {!isStreaming && !isEmpty && (
          <div className="message-actions">
            <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        )}
      </div>
    </article>
  );
}
