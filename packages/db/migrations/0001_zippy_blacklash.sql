CREATE TYPE "public"."alert_kind" AS ENUM('budget', 'fixed_fee_loss');--> statement-breakpoint
CREATE TYPE "public"."statement_line_kind" AS ENUM('usage', 'fixed_fee');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('draft', 'closed');--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "statement_line_kind" NOT NULL,
	"project" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"billed_usd" numeric(18, 8) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" "statement_status" DEFAULT 'draft' NOT NULL,
	"client_name" text,
	"billing_mode" "billing_mode",
	"markup_pct" numeric(7, 2),
	"monthly_fee_usd" numeric(18, 8),
	"requests" bigint,
	"tokens" bigint,
	"cost_usd" numeric(18, 8),
	"usage_billed_usd" numeric(18, 8),
	"fixed_fee_usd" numeric(18, 8),
	"total_billed_usd" numeric(18, 8),
	"closed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "budget_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "threshold" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "kind" "alert_kind" DEFAULT 'budget' NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "fee_usd" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "brand_address" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "brand_footer" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "brand_logo_url" text;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statement_lines_statement" ON "statement_lines" USING btree ("statement_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_client_period" ON "statements" USING btree ("client_id","period");--> statement-breakpoint
CREATE INDEX "statements_org_period" ON "statements" USING btree ("org_id","period");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_fixed_fee_loss_once" ON "alerts" USING btree ("client_id","period_start") WHERE "alerts"."kind" = 'fixed_fee_loss';--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_kind_fields" CHECK (("alerts"."kind" = 'budget' and "alerts"."budget_id" is not null and "alerts"."threshold" is not null) or ("alerts"."kind" = 'fixed_fee_loss' and "alerts"."client_id" is not null));