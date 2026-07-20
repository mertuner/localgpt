import { useEffect, useRef, useState } from "react";
import { FILE_ACCEPT, filesToAttachments, formatBytes } from "../lib/attachments";

function AttachmentChip({ attachment, onRemove }) {
  if (attachment.kind === "image") {
    return (
      <div className="chip chip-image">
        <img src={attachment.dataUrl} alt={attachment.name} />
        <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="chip chip-file">
      <span className="chip-file-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
            stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="chip-file-meta">
        <span className="chip-file-name">{attachment.name}</span>
        <span className="chip-file-size">{formatBytes(attachment.size)}</span>
      </span>
      <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}

export default function Composer({ onSend, onStop, isLoading, onError, autoFocus }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef(null);
  const photoInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  // Grow the textarea with its content, up to a scrollable ceiling.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  async function ingest(fileList) {
    if (!fileList || fileList.length === 0) return;
    const { attachments: next, errors } = await filesToAttachments(fileList);
    if (next.length > 0) setAttachments((current) => [...current, ...next]);
    if (errors.length > 0) onError(errors.join(" "));
    else onError("");
  }

  function removeAttachment(id) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function submit(event) {
    event?.preventDefault();
    if (isLoading) return;
    if (!text.trim() && attachments.length === 0) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
  }

  const canSend = !isLoading && (text.trim().length > 0 || attachments.length > 0);

  return (
    <form
      className={`composer${isDragging ? " composer-dragging" : ""}`}
      onSubmit={submit}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        ingest(event.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className="chips">
          {attachments.map((attachment) => (
            <AttachmentChip key={attachment.id} attachment={attachment} onRemove={removeAttachment} />
          ))}
        </div>
      )}

      <div className="composer-row">
        <div className="attach" ref={menuRef}>
          <button
            type="button"
            className="icon-button"
            aria-label="Add photos or files"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>

          {menuOpen && (
            <div className="attach-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  photoInputRef.current?.click();
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" fill="none" />
                  <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                  <path d="M4 17l5-5 4 4 3-2 4 4" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" />
                </svg>
                Photos
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
                    stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round"
                  />
                </svg>
                Files
              </button>
            </div>
          )}

          {/* accept="image/*" is what makes iOS offer Photo Library / Take Photo. */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              ingest(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              ingest(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <label className="sr-only" htmlFor="prompt">Message</label>
        <textarea
          id="prompt"
          ref={textareaRef}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder="Ask anything"
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files || []);
            if (files.length > 0) {
              event.preventDefault();
              ingest(files);
            }
          }}
          onKeyDown={(event) => {
            // Enter sends on desktop only; on touch it should insert a newline
            // so the on-screen keyboard's return key behaves as expected.
            const isTouch = window.matchMedia("(pointer: coarse)").matches;
            if (event.key === "Enter" && !event.shiftKey && !isTouch) {
              event.preventDefault();
              submit();
            }
          }}
        />

        {isLoading ? (
          <button type="button" className="send-button send-button-stop" onClick={onStop} aria-label="Stop generating">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="send-button" disabled={!canSend} aria-label="Send message">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
