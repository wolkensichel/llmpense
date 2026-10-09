import { z } from "zod";
import { usageEventInputSchema } from "@llmpense/core";
import { authenticate, json, type AuthOptions, type IngestDeps } from "../ingest.ts";
import { queryDefaults, type Integration, type MapResult, type QueryDefaults } from "./common.ts";
import {
  HELICONE_SECRET_ENV,
  HELICONE_SIGNATURE_HEADER,
  heliconeBodySchema,
  mapHelicone,
  verifyHeliconeSignature,
} from "./helicone.ts";
import { litellmBodySchema, mapLiteLLM, parseLiteLLMBody } from "./litellm.ts";
import { mapOpenRouter, openrouterBodySchema } from "./openrouter.ts";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

interface Connector {
  auth: AuthOptions;
  parse(text: string): unknown;
  schema: z.ZodType;
  map(body: never, query: QueryDefaults): MapResult;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const asList = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);

export const CONNECTORS: Record<Integration, Connector> = {
  litellm: {
    auth: { keyHeader: true },
    parse: parseLiteLLMBody,
    schema: litellmBodySchema,
    map: (body: z.infer<typeof litellmBodySchema>, q) => mapLiteLLM(asList(body), q),
  },
  helicone: {
    // Helicone webhooks are configured with a URL only, so the key may travel as ?key=.
    auth: { keyHeader: true, queryKey: true },
    parse: parseJson,
    schema: heliconeBodySchema,
    map: (body: z.infer<typeof heliconeBodySchema>, q) => mapHelicone(asList(body), q),
  },
  openrouter: {
    auth: { keyHeader: true },
    // The connection test sends an empty payload.
    parse: (text) => (text.trim() === "" ? {} : parseJson(text)),
    schema: openrouterBodySchema,
    map: (body: z.infer<typeof openrouterBodySchema>, q) => mapOpenRouter(body, q),
  },
};

export interface IntegrationOptions {
  /** Helicone webhook signing secret; defaults to the HELICONE_WEBHOOK_SECRET env var. */
  heliconeSecret?: string;
}

/** POST /api/v1/integrations/<tool>. Pure apart from `deps`. */
export async function handleIntegration(
  req: Request,
  tool: Integration,
  deps: IngestDeps,
  opts: IntegrationOptions = {},
): Promise<Response> {
  const connector = CONNECTORS[tool];
  const key = await authenticate(req, deps, connector.auth);
  if (key instanceof Response) return key;

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);
  const text = await req.text();
  const body = connector.parse(text);

  if (tool === "helicone") {
    const secret = opts.heliconeSecret ?? process.env[HELICONE_SECRET_ENV];
    if (secret && !verifyHeliconeSignature(secret, text, body, req.headers.get(HELICONE_SIGNATURE_HEADER))) {
      return json({ error: `Invalid or missing ${HELICONE_SIGNATURE_HEADER}` }, 401);
    }
  }

  if (body === undefined) return json({ error: "Body must be JSON" }, 400);
  const parsed = connector.schema.safeParse(body);
  if (!parsed.success) return json({ error: `Invalid ${tool} payload`, issues: parsed.error.issues }, 400);

  const { events, skipped } = connector.map(parsed.data as never, queryDefaults(new URL(req.url)));
  const checked = z.array(usageEventInputSchema).safeParse(events);
  if (!checked.success) return json({ error: `Invalid ${tool} payload`, issues: checked.error.issues }, 400);

  const { inserted } = checked.data.length > 0 ? await deps.record(key, checked.data) : { inserted: 0 };
  return json({ received: events.length + skipped, inserted, skipped }, 200);
}
