/**
 * Streaming client for the OpenAI-compatible endpoint.
 *
 * The base URL is relative ("/api") by default so requests are same-origin:
 * in dev the Vite proxy forwards them, in production the reverse proxy in
 * front of the static build does. An absolute 127.0.0.1 URL would break every
 * client that is not the machine running the model (phones included).
 *
 * Set VITE_API_BASE_URL to point at a different origin -- note that a
 * cross-origin backend must send CORS headers.
 */

const DEFAULT_API_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const DEFAULT_MODEL = import.meta.env.VITE_MODEL_ID || "google/gemma-4-E2B-it";

/**
 * Turns a failed response into something worth showing a human.
 *
 * A misconfigured deploy returns the host's HTML error page, not JSON, and
 * dumping that raw into the UI is unreadable. Detect that case and say what
 * actually needs fixing instead.
 */
async function describeFailure(response, apiUrl, { misrouted = false } = {}) {
  const body = await response.text().catch(() => "");
  const isHtml =
    misrouted ||
    (response.headers.get("content-type") || "").includes("text/html") ||
    body.trimStart().toLowerCase().startsWith("<!doctype");

  if (isHtml || !body.trim()) {
    const where = apiUrl.startsWith("http") ? apiUrl : `${window.location.origin}${apiUrl}`;
    // Both cases mean the same thing: the web host answered, not a model.
    if (misrouted || response.status === 404) {
      return `No model API at ${where} — the web host answered instead of a model server. Check VITE_API_BASE_URL or the /api proxy.`;
    }
    return `Model API at ${where} returned ${response.status} ${response.statusText}.`;
  }

  // A real API error (JSON or plain text) is worth surfacing verbatim.
  try {
    const json = JSON.parse(body);
    const detail = json.error?.message || json.detail || json.message;
    if (detail) return String(detail).slice(0, 300);
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return body.slice(0, 300);
}

export async function fetchWithStreaming(
  messages,
  { apiUrl = DEFAULT_API_URL, model = DEFAULT_MODEL, onToken, onSources, signal } = {},
) {
  let response;
  try {
    response = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 3000,
        stream: true,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    // fetch rejects with a bare "Failed to fetch" for DNS failures, a dead
    // host, and CORS rejections alike. Name the address so the message points
    // somewhere -- a restarted tunnel changes hostname and lands here.
    throw new Error(`Cannot reach the model server at ${apiUrl}. It may be offline or its address may have changed.`);
  }

  if (!response.ok) {
    throw new Error(await describeFailure(response, apiUrl));
  }

  // A 2xx does not mean we reached the model. An SPA fallback happily answers
  // POST /api/... with 200 + index.html, which would otherwise parse as a
  // stream containing zero tokens and fail silently as an empty reply.
  if ((response.headers.get("content-type") || "").includes("text/html")) {
    throw new Error(await describeFailure(response, apiUrl, { misrouted: true }));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let finishReason = null;
  let sources = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Carry the remainder forward: SSE events can be split across chunks.
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);

        // Web-search grounding: `sources` rides on a chunk of its own,
        // alongside `choices` and ahead of the first content token, so the UI
        // can show references before the answer starts arriving.
        if (Array.isArray(json.sources) && json.sources.length > 0) {
          sources = json.sources;
          onSources?.(sources);
        }

        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          fullContent += token;
          onToken?.(token);
        }
        if (json.choices?.[0]?.finish_reason) {
          finishReason = json.choices[0].finish_reason;
        }
      } catch {
        // Ignore keep-alives and partial JSON.
      }
    }
  }

  return { content: fullContent, finishReason, sources };
}

export async function fetchHealth(apiUrl = DEFAULT_API_URL) {
  const response = await fetch(`${apiUrl}/health`);
  if (!response.ok) throw new Error("Could not reach the local model.");
  return response.json();
}
