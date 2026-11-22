CREATE TABLE product_owner_modes (
  user_id text PRIMARY KEY NOT NULL REFERENCES product_profiles(user_id),
  mode text NOT NULL CHECK (mode IN ('teacher','academy_student','personal_basic','personal_premium')),
  updated_at text NOT NULL
);
