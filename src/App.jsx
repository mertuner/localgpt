import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchHealth, fetchWithStreaming } from "./api/gemmaStream";
import { toApiContent } from "./lib/attachments";
import { loadConversations, saveConversations, titleFor } from "./lib/storage";
import Composer from "./components/Composer";
import Message from "./components/Message";
import Sidebar from "./components/Sidebar";

const SYSTEM_PROMPT = "You are a helpful local AI assistant.";
const SUGGESTIONS = [
  "Explain this screenshot",
  "Summarize a document",
  "Help me write something",
  "Debug this code",
];

function newConversation() {
  return { id: crypto.randomUUID(), title: "New chat", messages: [], createdAt: Date.now() };
}

export default function App() {
  const [conversations, setConversations] = useState(() => loadConversations());
  const [activeId, setActiveId] = useState(() => loadConversations()[0]?.id ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [health, setHealth] = useState({ status: "checking", model: "Connecting…", modelId: null });

  const viewportRef = useRef(null);
  const abortRef = useRef(null);
  const pinnedToBottom = useRef(true);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = active?.messages ?? [];
  const hasMessages = messages.length > 0;

  useEffect(() => {
    let ignore = false;
    fetchHealth()
      .then((data) => {
        if (ignore) return;
        const id = data.model_id || data.model_alias || null;
        setHealth({
          status: data.model_loaded ? "online" : "offline",
          // Drop the org prefix ("google/gemma-…") for display only.
          model: id ? id.split("/").pop() : "Unknown model",
          modelId: id,
        });
      })
      .catch(() => {
        if (!ignore) setHealth({ status: "offline", model: "Backend unavailable", modelId: null });
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // Only autoscroll while the user is already at the bottom, so scrolling up
  // to read earlier output does not get yanked back down by the stream.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !pinnedToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  function handleScroll(event) {
    const el = event.currentTarget;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const patchConversation = useCallback((id, updater) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...conversation, ...updater(conversation) } : conversation,
      ),
    );
  }, []);

  function startNewChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setError("");
    setSidebarOpen(false);
  }

  function selectConversation(id) {
    abortRef.current?.abort();
    setActiveId(id);
    setError("");
    setSidebarOpen(false);
    pinnedToBottom.current = true;
  }

  function deleteConversation(id) {
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (id === activeId) setActiveId(null);
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  /**
   * Streams one completion for `history` (which must end with a user message)
   * and appends the assistant reply. Shared by sending and regenerating.
   */
  async function runCompletion(conversationId, history) {
    setError("");
    const assistantId = crypto.randomUUID();

    patchConversation(conversationId, () => ({
      messages: [
        ...history,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          attachments: [],
          sources: null,
          createdAt: Date.now(),
        },
      ],
    }));

    pinnedToBottom.current = true;
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const payload = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((message) => ({
        role: message.role,
        content: toApiContent(message.content, message.attachments),
      })),
    ];

    try {
      await fetchWithStreaming(payload, {
        // Prefer the id the server reports as loaded over the build-time default.
        ...(health.modelId ? { model: health.modelId } : {}),
        signal: controller.signal,
        onSources: (sources) => {
          patchConversation(conversationId, (current) => ({
            messages: current.messages.map((message) =>
              message.id === assistantId ? { ...message, sources } : message,
            ),
          }));
        },
        onToken: (token) => {
          patchConversation(conversationId, (current) => ({
            messages: current.messages.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + token }
                : message,
            ),
          }));
        },
      });
    } catch (requestError) {
      if (requestError.name === "AbortError") {
        // Stopped by the user: keep whatever streamed in so far.
        patchConversation(conversationId, (current) => ({
          messages: current.messages.filter(
            (message) => message.id !== assistantId || message.content.length > 0,
          ),
        }));
      } else {
        setError(requestError.message || "Request failed.");
        patchConversation(conversationId, (current) => ({
          messages: current.messages.filter((message) => message.id !== assistantId),
        }));
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }

  async function handleSend(text, attachments) {
    let conversation = active;
    if (!conversation) {
      conversation = newConversation();
      conversation.title = titleFor(text || attachments[0]?.name || "New chat");
      setConversations((current) => [conversation, ...current]);
      setActiveId(conversation.id);
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      attachments,
      createdAt: Date.now(),
    };

    await runCompletion(conversation.id, [...conversation.messages, userMessage]);
  }

  /**
   * Re-answers from a given message: drops it and everything after, then
   * streams a fresh reply to the user turn that preceded it.
   */
  async function handleRetry(messageId) {
    if (!active || isLoading) return;

    const index = active.messages.findIndex((message) => message.id === messageId);
    if (index === -1) return;

    // Retrying a user message re-sends it; retrying a reply re-answers its prompt.
    const end = active.messages[index].role === "user" ? index + 1 : index;
    const history = active.messages.slice(0, end);

    if (history.length === 0 || history[history.length - 1].role !== "user") return;
    await runCompletion(active.id, history);
  }

  /** Forks the conversation into a new chat ending at this message. */
  function handleBranch(messageId) {
    if (!active) return;

    const index = active.messages.findIndex((message) => message.id === messageId);
    if (index === -1) return;

    const messages = active.messages.slice(0, index + 1);
    const firstUser = messages.find((message) => message.role === "user");
    const branched = {
      ...newConversation(),
      title: titleFor(firstUser?.content || active.title),
      messages,
    };

    setConversations((current) => [branched, ...current]);
    setActiveId(branched.id);
    pinnedToBottom.current = true;
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={startNewChat}
        onSelect={selectConversation}
        onDelete={deleteConversation}
        health={health}
      />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>

          <div className="topbar-title">
            <span className={`dot dot-${health.status}`} aria-hidden="true" />
            {active?.title ?? "Local LLM"}
          </div>

          <button type="button" className="icon-button" onClick={startNewChat} aria-label="New chat">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z"
                stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round"
              />
            </svg>
          </button>
        </header>

        {hasMessages ? (
          <main className="chat" ref={viewportRef} onScroll={handleScroll}>
            <div className="thread">
              {messages.map((message, index) => (
                <Message
                  key={message.id}
                  message={message}
                  isStreaming={isLoading && index === messages.length - 1 && message.role === "assistant"}
                  isBusy={isLoading}
                  onRetry={handleRetry}
                  onBranch={handleBranch}
                />
              ))}
            </div>
          </main>
        ) : (
          <main className="home">
            <div className="home-inner">
              <h1>What can I help with?</h1>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestion"
                    onClick={() => handleSend(suggestion, [])}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </main>
        )}

        <div className="dock">
          <Composer
            onSend={handleSend}
            onStop={stopGenerating}
            isLoading={isLoading}
            onError={setError}
            autoFocus={!hasMessages}
          />
          <p className={`footnote${error ? " footnote-error" : ""}`}>
            {error ||
              (health.status === "offline"
                ? "Model offline — check the backend."
                : "Responses are generated locally and may be inaccurate.")}
          </p>
        </div>
      </div>
    </div>
  );
}
