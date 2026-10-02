import type { SourceAdapter } from "../types.ts";
import { genaiPrices } from "./genai-prices.ts";
import { litellm } from "./litellm.ts";
import { modelsDev } from "./models-dev.ts";
import { portkey } from "./portkey.ts";

/**
 * Price sources in precedence order (highest first).
 * Precedence only breaks ties: a value two sources agree on beats a lone dissent.
 */
export const SOURCES: SourceAdapter[] = [litellm, genaiPrices, modelsDev, portkey];
