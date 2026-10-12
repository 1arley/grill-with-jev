import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export async function readApprovedMarkdown(root: string, requestedPath: string): Promise<{ path: string; text: string }> {
  if (isAbsolute(requestedPath)) throw new Error("source path is not relative");
  const base = await realpath(root);
  const canonical = await realpath(resolve(base, requestedPath));
  const rel = relative(base, canonical);
  const normalized = rel.split(sep).join("/");
  const name = normalized.split("/").at(-1) ?? "";
  const allowedName = ["AGENTS.md", "CLAUDE.md", "GLOSSARY.md", "CONTEXT.md", "README.md"].includes(name);
  const allowedAdr = /^(?:docs\/adr|docs\/adrs|adr|ADRs)\/.*\.md$/i.test(normalized);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    || /(^|\/)(?:\.env[^/]*|\.git|node_modules)(?:\/|$)/i.test(normalized)
    || (!allowedName && !allowedAdr) || !normalized.toLowerCase().endsWith(".md")
    || !(await stat(canonical)).isFile()) throw new Error("source path is outside the allowlist");
  return { path: normalized, text: await readFile(canonical, "utf8") };
}

export async function readPrivateProfile(path: string): Promise<string> {
  try {
    const expected = resolve(path);
    const canonical = await realpath(expected);
    if (canonical !== expected || !(await stat(canonical)).isFile()) return "";
    return await readFile(canonical, "utf8");
  } catch { return ""; }
}
