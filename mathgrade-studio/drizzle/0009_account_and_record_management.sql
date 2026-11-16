CREATE TABLE product_closed_accounts (user_id text PRIMARY KEY NOT NULL, closed_at text NOT NULL);
--> statement-breakpoint
CREATE TABLE product_departures (
  class_id text NOT NULL REFERENCES product_classes(id), user_id text NOT NULL,
  status text NOT NULL, created_at text NOT NULL, PRIMARY KEY(class_id,user_id)
);
--> statement-breakpoint
CREATE TABLE product_submission_materials (
  id text PRIMARY KEY NOT NULL, submission_id text NOT NULL REFERENCES product_submissions(id),
  version integer NOT NULL, data text NOT NULL, created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX product_material_version_unique ON product_submission_materials(submission_id,version);
--> statement-breakpoint
ALTER TABLE product_messages ADD COLUMN client_request_id text;
--> statement-breakpoint
CREATE UNIQUE INDEX product_message_request_unique ON product_messages(submission_id,author_id,client_request_id);
--> statement-breakpoint
CREATE INDEX product_message_timeline ON product_messages(submission_id,created_at,id);
--> statement-breakpoint
ALTER TABLE product_oauth ADD COLUMN purpose text NOT NULL DEFAULT 'login';
--> statement-breakpoint
CREATE TABLE product_recovery_challenges (
  id text PRIMARY KEY NOT NULL, user_id text, purpose text NOT NULL, phone_hash text NOT NULL,
  provider_sid text NOT NULL, service_sid text NOT NULL, expires_at text NOT NULL,
  attempts integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending'
);
--> statement-breakpoint
CREATE TABLE product_security_tokens (
  token_hash text PRIMARY KEY NOT NULL, user_id text NOT NULL, purpose text NOT NULL,
  expires_at text NOT NULL, consumed_at text
);
