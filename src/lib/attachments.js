/**
 * Turns picked files into attachments the model can actually consume.
 *
 * Gemma is a vision+text model, so there are exactly two useful shapes:
 *   - image  -> sent as an image_url content part (the model literally sees it)
 *   - text   -> decoded client-side and inlined into the prompt
 * Anything else (pdf, docx, zip, audio) is rejected with a real reason instead
 * of being silently attached and ignored by the model.
 */

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_TEXT_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 120_000;

// Accept string for the "files" picker. Images are handled by a separate input.
export const FILE_ACCEPT = [
  "text/*",
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".json", ".jsonl",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".env", ".sql", ".html", ".css",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".h", ".cpp", ".cs", ".php", ".sh", ".swift",
].join(",");

const TEXT_MIME_ALLOWLIST = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/sql",
  "application/x-httpd-php",
]);

const TEXT_EXTENSIONS = new Set(
  FILE_ACCEPT.split(",")
    .filter((entry) => entry.startsWith("."))
    .map((entry) => entry.slice(1)),
);

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function isTextLike(file) {
  if (file.type.startsWith("text/")) return true;
  if (TEXT_MIME_ALLOWLIST.has(file.type)) return true;
  // iOS often hands over an empty or generic MIME type, so fall back to the
  // extension rather than rejecting the file outright.
  if (!file.type || file.type === "application/octet-stream") {
    return TEXT_EXTENSIONS.has(extensionOf(file.name));
  }
  return false;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * @returns {Promise<{attachments: Array, errors: string[]}>}
 */
export async function filesToAttachments(fileList) {
  const attachments = [];
  const errors = [];

  for (const file of Array.from(fileList)) {
    try {
      if (file.type.startsWith("image/")) {
        if (file.size > MAX_IMAGE_BYTES) {
          errors.push(`${file.name} is ${formatBytes(file.size)} — images are capped at ${formatBytes(MAX_IMAGE_BYTES)}.`);
          continue;
        }
        attachments.push({
          id: crypto.randomUUID(),
          kind: "image",
          name: file.name || "image",
          size: file.size,
          mime: file.type,
          dataUrl: await readAsDataUrl(file),
        });
        continue;
      }

      if (isTextLike(file)) {
        if (file.size > MAX_TEXT_BYTES) {
          errors.push(`${file.name} is ${formatBytes(file.size)} — text files are capped at ${formatBytes(MAX_TEXT_BYTES)}.`);
          continue;
        }
        const raw = await file.text();
        attachments.push({
          id: crypto.randomUUID(),
          kind: "text",
          name: file.name,
          size: file.size,
          mime: file.type || "text/plain",
          text: raw.length > MAX_TEXT_CHARS ? `${raw.slice(0, MAX_TEXT_CHARS)}\n\n…[truncated]` : raw,
          truncated: raw.length > MAX_TEXT_CHARS,
        });
        continue;
      }

      errors.push(`${file.name} isn't something the model can read. Attach images or text/code files.`);
    } catch (error) {
      errors.push(error.message || `Could not read ${file.name}.`);
    }
  }

  return { attachments, errors };
}

/** Builds the OpenAI-style `content` for one message. */
export function toApiContent(text, attachments = []) {
  const images = attachments.filter((item) => item.kind === "image");
  const docs = attachments.filter((item) => item.kind === "text");

  let prompt = text;
  if (docs.length > 0) {
    const blocks = docs
      .map((doc) => `--- ${doc.name} ---\n${doc.text}`)
      .join("\n\n");
    prompt = `${blocks}\n\n${text}`.trim();
  }

  if (images.length === 0) return prompt;

  return [
    { type: "text", text: prompt },
    // Keep each image's real data URL: hardcoding image/jpeg corrupts PNGs.
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    })),
  ];
}

export { formatBytes };
