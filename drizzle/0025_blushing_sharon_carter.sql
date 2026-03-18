ALTER TABLE "emails" ADD COLUMN "from_address" varchar(512);--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "to_addresses" text[];--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "forwarded_to" varchar(512);--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "reply_to_address" varchar(512);