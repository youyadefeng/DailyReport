import { loadLocalEnv } from "./lib/env.mjs";

loadLocalEnv();
await import("./main.mjs");
