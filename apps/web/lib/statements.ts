import "server-only";
import { getClientStatement, listMonthStatements } from "@llmpense/db";
import { parsePeriod } from "@llmpense/core";
import { getDb } from "./db.ts";
import { ensureFreshRates } from "./fx.ts";

export async function monthStatements(orgId: string, period: string, now = new Date()) {
  await ensureFreshRates(now);
  return listMonthStatements(getDb(), orgId, period, now);
}

export async function clientStatement(orgId: string, clientId: string, period: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !parsePeriod(period)) return null;
  await ensureFreshRates(now);
  return getClientStatement(getDb(), orgId, clientId, period, now);
}
