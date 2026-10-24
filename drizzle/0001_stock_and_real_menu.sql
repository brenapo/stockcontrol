CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock" (
	"holder" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_holder_sku_pk" PRIMARY KEY("holder","sku")
);
--> statement-breakpoint
CREATE TABLE "stock_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"from_holder" text,
	"from_name" text,
	"to_holder" text,
	"to_name" text,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"order_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "allow_note" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "retired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_log_at" ON "stock_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "stock_log_from" ON "stock_log" USING btree ("from_holder");--> statement-breakpoint
CREATE INDEX "stock_log_to" ON "stock_log" USING btree ("to_holder");--> statement-breakpoint
-- Real menu. The old A–Z placeholders are kept (retired + hidden) so old orders and any ids they reference stay valid;
-- orders already store the item names they were placed with.
UPDATE "menu_items" SET "retired" = true, "active" = false WHERE length("letter") = 1;--> statement-breakpoint
INSERT INTO "menu_items" ("letter", "name", "price_cents", "allow_note", "sort_order")
SELECT v.letter, v.name, 300, v.allow_note, v.sort_order
FROM (VALUES
  ('cannoli', 'Cannoli', false, 0),
  ('kitkat', 'KitKat', false, 1),
  ('eclair', 'Éclair', false, 2),
  ('macaron', 'Macaron', false, 3),
  ('xocolat', 'Xocolat', false, 4),
  ('amorade', 'Amorade', false, 5),
  ('other', 'Other', true, 6)
) AS v(letter, name, allow_note, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "menu_items" m WHERE m."letter" = v.letter)
ORDER BY v.sort_order;
