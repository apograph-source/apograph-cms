CREATE TABLE "mail_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"link" text,
	"user_id" uuid,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dead_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_deliveries_claimable_idx" ON "mail_deliveries" USING btree ("next_attempt_at") WHERE "mail_deliveries"."dead_at" is null;--> statement-breakpoint
CREATE INDEX "mail_deliveries_expires_idx" ON "mail_deliveries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mail_deliveries_user_idx" ON "mail_deliveries" USING btree ("user_id","created_at");