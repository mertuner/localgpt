const STORAGE_KEY = "localllmui.conversations.v1";

/**
 * Image data URLs are megabytes each and would blow the ~5MB localStorage
 * quota after a couple of chats, so persisted messages keep the attachment
 * metadata but drop the payload. Images stay visible for the live session.
 */
function stripPayloads(conversations) {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: (message.attachments || []).map(({ id, kind, name, mime }) => ({
        id,
        kind,
        name,
        mime,
        dropped: true,
      })),
    })),
  }));
}

export function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripPayloads(conversations)));
  } catch {
    // Quota exceeded or storage disabled (Safari private browsing): the app
    // stays fully usable, it just will not remember this session.
  }
}

export function titleFor(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}
