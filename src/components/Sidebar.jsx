export default function Sidebar({
  conversations,
  activeId,
  open,
  onClose,
  onNewChat,
  onSelect,
  onDelete,
  health,
}) {
  return (
    <>
      <div
        className={`scrim${open ? " scrim-visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar${open ? " sidebar-open" : ""}`} aria-label="Conversations">
        <div className="sidebar-head">
          <button type="button" className="new-chat" onClick={onNewChat}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
            New chat
          </button>
          <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Close sidebar">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>

        <nav className="conversation-list">
          {conversations.length === 0 ? (
            <p className="sidebar-empty">No chats yet.</p>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`conversation${conversation.id === activeId ? " conversation-active" : ""}`}
              >
                <button type="button" className="conversation-title" onClick={() => onSelect(conversation.id)}>
                  {conversation.title}
                </button>
                <button
                  type="button"
                  className="conversation-delete"
                  onClick={() => onDelete(conversation.id)}
                  aria-label={`Delete ${conversation.title}`}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path
                      d="M5 7h14M10 7V5h4v2M6 7l1 12h10l1-12"
                      stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-foot">
          <span className={`dot dot-${health.status}`} aria-hidden="true" />
          <span className="sidebar-model">{health.model}</span>
        </div>
      </aside>
    </>
  );
}
