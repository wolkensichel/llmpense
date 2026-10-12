import { getCurrentOrg } from "@/lib/org.ts";
import { brandingOf } from "@/lib/branding.ts";
import { Panel } from "@/components/ui.tsx";
import { BrandingForm } from "./branding-form.tsx";

/** Agency details shown on client-facing statements. */
export async function BrandingSettings() {
  const org = await getCurrentOrg();
  return (
    <section id="branding" className="scroll-mt-28">
      <Panel title="Statement branding" sub="Shown on the client-facing statements and PDFs, with the statement number and payment terms.">
        <BrandingForm branding={brandingOf(org)} numbering={{ format: org.statementNumberFormat, paymentTermsDays: org.paymentTermsDays }} />
      </Panel>
    </section>
  );
}
