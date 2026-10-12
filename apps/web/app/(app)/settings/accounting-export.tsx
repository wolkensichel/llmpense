import { getCurrentOrg } from "@/lib/org.ts";
import { accountingSettingsOf } from "@/lib/accounting/settings.ts";
import { Panel } from "@/components/ui.tsx";
import { AccountingExportForm } from "./accounting-export-form.tsx";

/** Account codes and numbers for the Xero and DATEV file exports on the monthly statements page. */
export async function AccountingExportSettings() {
  const org = await getCurrentOrg();
  return (
    <section id="accounting-export" className="scroll-mt-28">
      <Panel
        title="Accounting export"
        sub="Used by the Xero and DATEV files on the monthly statements page. Files only: nothing is sent to these services and no credentials are stored."
      >
        <AccountingExportForm settings={accountingSettingsOf(org)} />
      </Panel>
    </section>
  );
}
