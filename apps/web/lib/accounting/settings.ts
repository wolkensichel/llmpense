import { z } from "zod";

/** Org-level settings for the accounting file exports. Everything starts empty. */
export interface AccountingSettings {
  xeroAccountCode: string | null;
  xeroTaxType: string | null;
  datevConsultantNumber: number | null;
  datevClientNumber: number | null;
  datevAccountLength: number;
  datevFiscalYearStart: number;
  datevRevenueAccount: string | null;
  datevDebtorAccount: string | null;
  datevTaxKey: string | null;
}

export function accountingSettingsOf(org: AccountingSettings): AccountingSettings {
  return {
    xeroAccountCode: org.xeroAccountCode,
    xeroTaxType: org.xeroTaxType,
    datevConsultantNumber: org.datevConsultantNumber,
    datevClientNumber: org.datevClientNumber,
    datevAccountLength: org.datevAccountLength,
    datevFiscalYearStart: org.datevFiscalYearStart,
    datevRevenueAccount: org.datevRevenueAccount,
    datevDebtorAccount: org.datevDebtorAccount,
    datevTaxKey: org.datevTaxKey,
  };
}

/** What is still missing before an export can be built; empty when ready. */
export function missingForXero(s: AccountingSettings): string[] {
  const out: string[] = [];
  if (!s.xeroAccountCode) out.push("Xero account code");
  if (!s.xeroTaxType) out.push("Xero tax rate");
  return out;
}

export function missingForDatev(s: AccountingSettings): string[] {
  const out: string[] = [];
  if (!s.datevConsultantNumber) out.push("DATEV consultant number");
  if (!s.datevClientNumber) out.push("DATEV client number");
  if (!s.datevRevenueAccount) out.push("revenue account");
  if (!s.datevDebtorAccount) out.push("debtor account");
  return out;
}

const empty = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? v.trim() : v);
const optional = <T extends z.ZodType>(t: T) => z.preprocess(empty, t.nullable());

export const accountingSchema = z
  .object({
    xeroAccountCode: optional(z.string().max(10, "Xero account codes have at most 10 characters.")),
    xeroTaxType: optional(z.string().max(50, "The Xero tax rate name is limited to 50 characters.")),
    datevConsultantNumber: optional(
      z.coerce.number({ message: "The consultant number must be a number." }).int().min(1001, "The consultant number is between 1001 and 9999999.").max(9_999_999, "The consultant number is between 1001 and 9999999."),
    ),
    datevClientNumber: optional(
      z.coerce.number({ message: "The client number must be a number." }).int().min(1, "The client number is between 1 and 99999.").max(99_999, "The client number is between 1 and 99999."),
    ),
    datevAccountLength: z.coerce.number().int().min(4, "The account length is 4 to 8.").max(8, "The account length is 4 to 8."),
    datevFiscalYearStart: z.coerce.number().int().min(1).max(12),
    datevRevenueAccount: optional(z.string().regex(/^[1-9]\d{0,8}$/, "The revenue account must be a number without leading zeros.")),
    datevDebtorAccount: optional(z.string().regex(/^[1-9]\d{0,8}$/, "The debtor account must be a number without leading zeros.")),
    datevTaxKey: optional(z.string().regex(/^\d{1,4}$/, "The tax key (BU-Schlüssel) has 1 to 4 digits.")),
  })
  .superRefine((v, ctx) => {
    if (v.datevRevenueAccount && v.datevRevenueAccount.length !== v.datevAccountLength) {
      ctx.addIssue({ code: "custom", path: ["datevRevenueAccount"], message: `The revenue account must have ${v.datevAccountLength} digits, the account length.` });
    }
    // Debtors are person accounts: one digit longer than G/L accounts (a collective G/L account also works).
    if (v.datevDebtorAccount && v.datevDebtorAccount.length > v.datevAccountLength + 1) {
      ctx.addIssue({ code: "custom", path: ["datevDebtorAccount"], message: `The debtor account can have at most ${v.datevAccountLength + 1} digits.` });
    }
  });

export type AccountingInput = z.output<typeof accountingSchema>;
