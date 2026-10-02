import type { UpstreamName } from "./usage.ts";

export interface ProxyConfig {
  port: number;
  upstreams: Record<UpstreamName, string>;
}

const DEFAULTS: Record<UpstreamName, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  return {
    port: Number(env.PROXY_PORT ?? env.PORT ?? 8787),
    upstreams: {
      openai: trimSlash(env.OPENAI_BASE_URL || DEFAULTS.openai),
      anthropic: trimSlash(env.ANTHROPIC_BASE_URL || DEFAULTS.anthropic),
      gemini: trimSlash(env.GEMINI_BASE_URL || DEFAULTS.gemini),
    },
  };
}
