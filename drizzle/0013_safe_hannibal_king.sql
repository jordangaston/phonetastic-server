CREATE TABLE "call_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" integer NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_transcript_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"transcript_id" integer NOT NULL,
	"text" text NOT NULL,
	"end_user_id" integer,
	"bot_id" integer,
	"user_id" integer,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript_entries" ADD CONSTRAINT "call_transcript_entries_transcript_id_call_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."call_transcripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript_entries" ADD CONSTRAINT "call_transcript_entries_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript_entries" ADD CONSTRAINT "call_transcript_entries_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcript_entries" ADD CONSTRAINT "call_transcript_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;