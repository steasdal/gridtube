CREATE TABLE "grid_urls" (
	"id" text PRIMARY KEY NOT NULL,
	"grid_id" text NOT NULL,
	"slot" integer NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"volume" integer DEFAULT 100 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "grid_urls_grid_id_slot_unique" UNIQUE("grid_id","slot")
);
--> statement-breakpoint
ALTER TABLE "grid_urls" ADD CONSTRAINT "grid_urls_grid_id_grids_id_fk" FOREIGN KEY ("grid_id") REFERENCES "public"."grids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "grid_urls" ("id", "grid_id", "slot", "url", "volume", "muted")
SELECT
	g."id" || ':' || (elem.ord - 1)::text,
	g."id",
	(elem.ord - 1)::integer,
	CASE
		WHEN jsonb_typeof(elem.val) = 'string' THEN BTRIM(elem.val #>> '{}')
		ELSE COALESCE(BTRIM(elem.val->>'url'), '')
	END,
	CASE
		WHEN jsonb_typeof(elem.val) = 'object' AND (elem.val->>'volume') ~ '^-?[0-9]+$'
			THEN LEAST(100, GREATEST(0, (elem.val->>'volume')::integer))
		ELSE 100
	END,
	CASE
		WHEN jsonb_typeof(elem.val) = 'object' AND (elem.val->>'muted') IN ('true', 'false')
			THEN (elem.val->>'muted')::boolean
		ELSE false
	END
FROM "grids" g
CROSS JOIN LATERAL jsonb_array_elements(g."feeds") WITH ORDINALITY AS elem(val, ord)
WHERE jsonb_typeof(g."feeds") = 'array'
	AND (elem.ord - 1) BETWEEN 0 AND 3;
--> statement-breakpoint
ALTER TABLE "grids" DROP COLUMN "feeds";