CREATE TYPE "public"."subdomain_status" AS ENUM('not_started', 'pending', 'verified', 'partially_verified', 'partially_failed', 'failed', 'temporary_failure');--> statement-breakpoint
ALTER TABLE "subdomains" ADD COLUMN "status" "subdomain_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "subdomains" DROP COLUMN "verified";