ALTER TABLE "phone_numbers" DROP CONSTRAINT "phone_numbers_end_user_id_end_users_id_fk";
--> statement-breakpoint
ALTER TABLE "phone_numbers" DROP COLUMN "end_user_id";
--> statement-breakpoint
ALTER TABLE "end_users" ADD COLUMN "phone_number_id" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE no action ON UPDATE no action;
