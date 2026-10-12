export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      result = result.replaceAll(secret, "[REDACTED]");
    }
    return result
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/((?:api[_-]?key|token|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  }
  return value;
}

export function maskedKey(key: string): string {
  return `***${key.slice(-4)}`;
}
