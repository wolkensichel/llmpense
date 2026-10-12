CREATE TYPE "public"."outcome_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "outcome_status" NOT NULL,
	"value_amount" numeric(18, 4),
	"value_currency" "currency",
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_value_pair" CHECK (("outcomes"."value_amount" is null and "outcomes"."value_currency" is null) or ("outcomes"."value_amount" is not null and "outcomes"."value_currency" is not null))
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_org_run_name" ON "outcomes" USING btree ("org_id","run_id","name");--> statement-breakpoint
CREATE INDEX "outcomes_org_ts" ON "outcomes" USING btree ("org_id","ts");--> statement-breakpoint
CREATE INDEX "usage_events_org_run" ON "usage_events" USING btree ("org_id","run_id") WHERE "usage_events"."run_id" is not null;