ALTER TABLE `product_admin_customer_events` ADD `previous_role` text;--> statement-breakpoint
ALTER TABLE `product_admin_customer_events` ADD `new_role` text;
--> statement-breakpoint
CREATE TRIGGER `product_members_match_account_type_on_insert`
BEFORE INSERT ON `product_members`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `product_profiles`
  WHERE user_id = NEW.user_id
    AND account_type = CASE NEW.role WHEN 'teacher' THEN 'teacher' WHEN 'student' THEN 'academy_student' END
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MEMBER_ROLE_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `product_members_match_account_type_on_update`
BEFORE UPDATE OF `user_id`, `role` ON `product_members`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `product_profiles`
  WHERE user_id = NEW.user_id
    AND account_type = CASE NEW.role WHEN 'teacher' THEN 'teacher' WHEN 'student' THEN 'academy_student' END
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MEMBER_ROLE_MISMATCH');
END;
