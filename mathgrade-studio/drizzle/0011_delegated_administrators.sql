ALTER TABLE product_admin_customers ADD is_admin integer NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
--> statement-breakpoint
ALTER TABLE product_admin_customer_events ADD previous_admin integer;
--> statement-breakpoint
ALTER TABLE product_admin_customer_events ADD new_admin integer;
