import { existsSync, readFileSync } from "node:fs";
import { APP_CONFIG } from "../../config/project.config.mjs";

export function loadLocalEnv() {
  const envPath = APP_CONFIG.paths.localEnv;
  if (!existsSync(envPath)) {
    return { loaded: false, path: envPath };
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = stripQuotes(rawValue);

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  return { loaded: true, path: envPath };
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
