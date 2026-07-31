import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadDotenv(
  dir: string = process.cwd(),
): Promise<Record<string, string>> {
  const envPath = path.resolve(dir, ".env");
  let content: string;

  try {
    content = await readFile(envPath, "utf8");
  } catch {
    return {};
  }

  const vars: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      vars[key] = value;
    }
  }

  return vars;
}
