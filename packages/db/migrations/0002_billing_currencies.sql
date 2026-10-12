CREATE TYPE "public"."currency" AS ENUM('USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CHF');--> statement-breakpoint
CREATE TYPE "public"."model_name_display" AS ENUM('show', 'hide');--> statement-breakpoint
CREATE TABLE "fx_rate_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"rate_per_usd" numeric(20, 10) NOT NULL,
	"effective_from" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_overrides_positive" CHECK ("fx_rate_overrides"."rate_per_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"rate_per_eur" numeric(20, 10) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_date_currency_pk" PRIMARY KEY("date","currency"),
	CONSTRAINT "fx_rates_positive" CHECK ("fx_rates"."rate_per_eur" > 0)
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_currency" "currency" DEFAULT 'USD' NOT NULL;--> statement-breakpoint
-- Existing fixed fees are USD amounts and every client starts in USD, so the values carry over unchanged.
ALTER TABLE "clients" RENAME COLUMN "fixed_fee_usd" TO "fixed_fee";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "model_names" "model_name_display";--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "show_model_names" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD COLUMN "billed" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "statements" RENAME COLUMN "monthly_fee_usd" TO "monthly_fee";--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "currency" "currency";--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "fx_rate" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "fx_date" date;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "fx_source" text;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "usage_billed" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "fixed_fee" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "total_billed" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "fx_rate_overrides" ADD CONSTRAINT "fx_rate_overrides_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rate_overrides_org_currency_from" ON "fx_rate_overrides" USING btree ("org_id","currency","effective_from");--> statement-breakpoint
-- Statements closed before billing currencies existed were billed in USD.
UPDATE "statements" SET "currency" = 'USD', "fx_rate" = 1, "fx_source" = 'identity', "usage_billed" = round("usage_billed_usd", 2), "fixed_fee" = round("fixed_fee_usd", 2), "total_billed" = round("total_billed_usd", 2) WHERE "status" = 'closed';--> statement-breakpoint
UPDATE "statement_lines" SET "billed" = round("billed_usd", 2);
