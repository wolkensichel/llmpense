import { CURRENCIES, ECB_ACKNOWLEDGEMENT, formatRate, formatRateDate, periodOf, selectRate, type FxRate } from "@llmpense/core";
import { listRateOverrides, loadEurRates, utcDay } from "@llmpense/db";
import { getCurrentOrg } from "@/lib/org.ts";
import { getDb } from "@/lib/db.ts";
import { autoFetchEnabled, ensureFreshRates } from "@/lib/fx.ts";
import { EmptyState, Panel } from "@/components/ui.tsx";
import { deleteRateOverride } from "./exchange-rates-actions.ts";
import { RateOverrideForm, SyncRatesButton } from "./exchange-rates-form.tsx";

const SOURCE_LABEL: Record<FxRate["source"], string> = {
  ecb: "ECB reference rate",
  manual: "Manual rate",
  seed: "Demo rate (seed data)",
  identity: "",
};

/** Exchange rates for billing currencies: the reference rates in use and the org's manual rates. */
export async function ExchangeRatesSettings() {
  const org = await getCurrentOrg();
  const now = new Date();
  await ensureFreshRates(now);
  const today = utcDay(now);
  const period = periodOf(now);
  const db = getDb();
  const [rates, overrideRows] = await Promise.all([loadEurRates(db, [today]), listRateOverrides(db, org.id)]);
  const overrides = overrideRows.map((o) => ({ currency: o.currency, perUsd: Number(o.ratePerUsd), effectiveFrom: o.effectiveFrom }));
  const currencies = CURRENCIES.filter((c) => c !== "USD");
  const rows = currencies.map((currency) => ({
    currency,
    reference: selectRate({ currency, period, today, rates }),
    applied: selectRate({ currency, period, today, rates, overrides }),
  }));

  return (
    <section id="exchange-rates" className="scroll-mt-28">
      <Panel
        title="Exchange rates"
        sub="Clients can be billed in EUR, GBP, JPY, CNY or CHF. Statements convert USD amounts with the rate of the month's last business day (the latest rate while the month runs); closing a statement freezes its rate."
        actions={<SyncRatesButton />}
      >
        <div className="-mx-4 overflow-x-auto lg:-mx-5">
          <table className="dtable min-w-[520px]">
            <thead>
              <tr>
                <th className="pl-4 lg:pl-5">Currency</th>
                <th className="r">Reference rate</th>
                <th>Date</th>
                <th className="r">Used now</th>
                <th className="pr-4 lg:pr-5">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.currency}>
                  <td className="pl-4 font-medium lg:pl-5">{r.currency}</td>
                  <td className="r">{r.reference ? `1 USD = ${formatRate(r.reference.perUsd)}` : "–"}</td>
                  <td className="num text-ink-2">{r.reference?.date ? formatRateDate(r.reference.date) : "None stored"}</td>
                  <td className="r font-medium">{r.applied ? formatRate(r.applied.perUsd) : "–"}</td>
                  <td className="pr-4 text-ink-2 lg:pr-5">{r.applied ? SOURCE_LABEL[r.applied.source] : "No rate"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-3">
          {ECB_ACKNOWLEDGEMENT} Published for information purposes; fetched with <code>pnpm fx:sync</code>
          {autoFetchEnabled() ? " and by this server at most once a day" : " (automatic fetching is off: FX_AUTO_FETCH=0)"}.
        </p>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Manual rates</h3>
          <p className="mt-0.5 mb-3 text-[13px] text-ink-3">
            For offline installs or contractual rates. A manual rate applies to every month ending on or after its date and takes
            precedence over reference rates. Closed statements keep the rate they were closed with.
          </p>
          <RateOverrideForm today={today} />
          <div className="mt-4">
            {overrideRows.length === 0 ? (
              <EmptyState title="No manual rates">Statements use the ECB reference rates.</EmptyState>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {overrideRows.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="num font-medium">
                        1 USD = {formatRate(Number(o.ratePerUsd))} {o.currency}
                      </p>
                      <p className="text-[13px] text-ink-3">
                        From {formatRateDate(o.effectiveFrom)}
                        {o.note ? `. ${o.note}` : ""}
                      </p>
                    </div>
                    <form action={deleteRateOverride}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="btn btn-quiet min-h-11 px-3 text-[13px] text-loss-ink" aria-label={`Delete manual ${o.currency} rate from ${o.effectiveFrom}`}>
                        Delete
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );
}
