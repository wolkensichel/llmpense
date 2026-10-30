import "server-only";
import { getClientStatement, listMonthStatements } from "@llmpense/db";
import { parsePeriod } from "@llmpense/core";
import { getDb } from "./db.ts";
import { ensureRatesFor } from "./fx.ts";

export async function monthStatements(orgId: string, period: string, now = new Date()) {
  await ensureRatesFor([period], now);
  return listMonthStatements(getDb(), orgId, period, now);
}

export async function clientStatement(orgId: string, clientId: string, period: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !parsePeriod(period)) return null;
  await ensureRatesFor([period], now);
  return getClientStatement(getDb(), orgId, clientId, period, now);
}
