CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'stored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."chat_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."chat_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."email_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('received', 'pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "email_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"address" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_addresses_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"end_user_id" integer NOT NULL,
	"channel" "chat_channel" NOT NULL,
	"status" "chat_status" DEFAULT 'open' NOT NULL,
	"bot_enabled" boolean DEFAULT true NOT NULL,
	"subject" varchar(1024),
	"summary" text,
	"email_address_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"direction" "email_direction" NOT NULL,
	"end_user_id" integer,
	"bot_id" integer,
	"user_id" integer,
	"subject" varchar(1024),
	"body_text" text,
	"body_html" text,
	"external_email_id" varchar(255),
	"message_id" varchar(512),
	"in_reply_to" varchar(512),
	"reference_ids" text[],
	"status" "email_status" DEFAULT 'received' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "emails_external_email_id_unique" UNIQUE("external_email_id"),
	CONSTRAINT "exactly_one_sender" CHECK ((
      (CASE WHEN "emails"."end_user_id" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "emails"."bot_id" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "emails"."user_id" IS NOT NULL THEN 1 ELSE 0 END)
    ) = 1)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer NOT NULL,
	"external_attachment_id" varchar(255),
	"filename" varchar(512) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size_bytes" integer,
	"storage_key" varchar(1024),
	"status" "attachment_status" DEFAULT 'pending' NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "end_users" ALTER COLUMN "phone_number_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "end_users" ADD COLUMN "email" varchar(255);--> statement-breakpoint
ALTER TABLE "email_addresses" ADD CONSTRAINT "email_addresses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_email_address_id_email_addresses_id_fk" FOREIGN KEY ("email_address_id") REFERENCES "public"."email_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_emails_chat_id" ON "emails" ("chat_id");--> statement-breakpoint
CREATE INDEX "idx_emails_external_email_id" ON "emails" ("external_email_id");--> statement-breakpoint
CREATE INDEX "idx_emails_in_reply_to" ON "emails" ("in_reply_to");--> statement-breakpoint
CREATE INDEX "idx_chats_company_updated" ON "chats" ("company_id", "updated_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_chats_end_user_company_status" ON "chats" ("end_user_id", "company_id", "status");--> statement-breakpoint
CREATE INDEX "idx_end_users_email_company" ON "end_users" ("email", "company_id");--> statement-breakpoint
CREATE INDEX "idx_attachments_email_id" ON "attachments" ("email_id");