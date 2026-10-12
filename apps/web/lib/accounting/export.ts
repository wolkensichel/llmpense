import "server-only";
import { showModelNames } from "@llmpense/core";
import type { ClientStatement } from "@llmpense/db";
import type { Org } from "../org.ts";
import { toExportInvoices, type StatementForExport } from "./common.ts";

/** A month's statements as export input, with each client's model-name setting applied. */
export function exportInputs(org: Org, list: readonly ClientStatement[]): StatementForExport[] {
  return list.map((s) => ({
    status: s.status,
    client: { name: s.client.name, slug: s.client.slug },
    data: s.data,
    invoice: s.invoice,
    showModelNames: showModelNames(org.showModelNames, s.client.modelNames),
  }));
}

export function exportInvoices(org: Org, list: readonly ClientStatement[]) {
  return toExportInvoices(exportInputs(org, list));
}

export function fileResponse(body: Uint8Array | string, filename: string, contentType: string): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      "cache-control": "no-store",
    },
  });
}
