/** Request headers the proxy reads to attribute a call. All optional except the key. */
export const HEADERS = {
  key: "x-llmpense-key",
  client: "x-llmpense-client",
  project: "x-llmpense-project",
  feature: "x-llmpense-feature",
  endUser: "x-llmpense-end-user",
  /** Caller-chosen id grouping the calls that work on one task (ticket, document, agent run). */
  run: "x-llmpense-run",
  /** Extra JSON object stored as event metadata. */
  metadata: "x-llmpense-metadata",
} as const;

/** Every x-llmpense-* header is stripped before forwarding upstream. */
export const LLMPENSE_HEADER_PREFIX = "x-llmpense-";
