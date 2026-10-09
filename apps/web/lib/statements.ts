import "server-only";
import { getClientStatement, listMonthStatements } from "@llmpense/db";
import { parsePeriod } from "@llmpense/core";
import { getDb } from "./db.ts";

export function monthStatements(orgId: string, period: string, now = new Date()) {
  return listMonthStatements(getDb(), orgId, period, now);
}

export function clientStatement(orgId: string, clientId: string, period: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !parsePeriod(period)) return Promise.resolve(null);
  return getClientStatement(getDb(), orgId, clientId, period, now);
}
