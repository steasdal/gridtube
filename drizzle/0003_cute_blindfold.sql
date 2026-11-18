CREATE TABLE "public_grids" (
	"id" text PRIMARY KEY NOT NULL,
	"grid_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_grids_grid_id_unique" UNIQUE("grid_id")
);
--> statement-breakpoint
ALTER TABLE "public_grids" ADD CONSTRAINT "public_grids_grid_id_grids_id_fk" FOREIGN KEY ("grid_id") REFERENCES "public"."grids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_grids" ADD CONSTRAINT "public_grids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_grids_user_id_idx" ON "public_grids" USING btree ("user_id");