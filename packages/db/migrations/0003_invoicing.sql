CREATE TYPE "public"."statement_action" AS ENUM('close', 'reopen', 'mark_sent', 'mark_paid', 'unmark_sent', 'unmark_paid');--> statement-breakpoint
ALTER TYPE "public"."statement_status" ADD VALUE 'sent';--> statement-breakpoint
ALTER TYPE "public"."statement_status" ADD VALUE 'paid';--> statement-breakpoint
CREATE TABLE "statement_counters" (
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "statement_counters_org_id_year_pk" PRIMARY KEY("org_id","year")
);
--> statement-breakpoint
CREATE TABLE "statement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"action" "statement_action" NOT NULL,
	"from_status" "statement_status" NOT NULL,
	"to_status" "statement_status" NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "statement_number_format" text DEFAULT 'ST-{YYYY}-{NNNN}' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "payment_terms_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "xero_account_code" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "xero_tax_type" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_consultant_number" integer;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_client_number" integer;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_account_length" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_fiscal_year_start" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_revenue_account" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_debtor_account" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "datev_tax_key" text;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "issue_date" date;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "statement_counters" ADD CONSTRAINT "statement_counters_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_events" ADD CONSTRAINT "statement_events_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statement_events_statement" ON "statement_events" USING btree ("statement_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_org_number" ON "statements" USING btree ("org_id","number") WHERE "statements"."number" is not null;--> statement-breakpoint
-- Statements closed before numbering existed get numbers in close order, per org and year, in the default format.
WITH numbered AS (
	SELECT "id", "closed_at",
		extract(year FROM "closed_at" AT TIME ZONE 'UTC')::int AS "year",
		row_number() OVER (PARTITION BY "org_id", extract(year FROM "closed_at" AT TIME ZONE 'UTC') ORDER BY "closed_at", "id") AS "n"
	FROM "statements" WHERE "status" = 'closed' AND "number" IS NULL AND "closed_at" IS NOT NULL
)
UPDATE "statements" s SET
	"number" = 'ST-' || numbered."year" || '-' || lpad(numbered."n"::text, 4, '0'),
	"issue_date" = (numbered."closed_at" AT TIME ZONE 'UTC')::date,
	"payment_terms_days" = 14,
	"due_date" = (numbered."closed_at" AT TIME ZONE 'UTC')::date + 14
FROM numbered WHERE s."id" = numbered."id";--> statement-breakpoint
INSERT INTO "statement_counters" ("org_id", "year", "last_value")
SELECT "org_id", extract(year FROM "closed_at" AT TIME ZONE 'UTC')::int, count(*)::int
FROM "statements" WHERE "number" IS NOT NULL
GROUP BY "org_id", extract(year FROM "closed_at" AT TIME ZONE 'UTC');