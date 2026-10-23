# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_23_090000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "active_storage_attachments", force: :cascade do |t|
    t.string "name", null: false
    t.string "record_type", null: false
    t.bigint "record_id", null: false
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.string "key", null: false
    t.string "filename", null: false
    t.string "content_type"
    t.text "metadata"
    t.string "service_name", null: false
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "admin_role_changes", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.string "previous_role"
    t.string "new_role"
    t.string "action", null: false
    t.string "changed_by", null: false
    t.datetime "created_at", null: false
    t.index ["user_id"], name: "index_admin_role_changes_on_user_id"
    t.check_constraint "action::text = ANY (ARRAY['bootstrap'::character varying, 'grant'::character varying, 'revoke'::character varying, 'emergency_replace'::character varying]::text[])", name: "admin_role_changes_action_allowed"
    t.check_constraint "changed_by::text !~ '^\\s*$'::text", name: "admin_role_changes_changed_by_present"
    t.check_constraint "new_role IS NULL OR (new_role::text = ANY (ARRAY['super_admin'::character varying, 'president'::character varying, 'treasurer'::character varying]::text[]))", name: "admin_role_changes_new_role_allowed"
    t.check_constraint "previous_role IS NULL OR (previous_role::text = ANY (ARRAY['super_admin'::character varying, 'president'::character varying, 'treasurer'::character varying]::text[]))", name: "admin_role_changes_previous_role_allowed"
    t.check_constraint "previous_role::text IS DISTINCT FROM new_role::text", name: "admin_role_changes_changes_role"
  end

  create_table "membership_applications", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.string "sap_staff_id"
    t.string "business_unit"
    t.string "department"
    t.string "office_location"
    t.string "primary_phone"
    t.string "secondary_phone"
    t.date "date_of_birth"
    t.string "sex"
    t.string "marital_status"
    t.string "nationality"
    t.text "home_address"
    t.string "next_of_kin_name"
    t.string "next_of_kin_relationship"
    t.string "next_of_kin_phone"
    t.text "next_of_kin_address"
    t.bigint "monthly_contribution_kobo"
    t.date "contribution_start_date"
    t.string "declaration_version"
    t.datetime "declaration_accepted_at"
    t.datetime "submitted_at"
    t.integer "lock_version", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id"], name: "index_membership_applications_on_user_id", unique: true
    t.check_constraint "business_unit IS NULL OR char_length(business_unit::text) >= 1 AND char_length(business_unit::text) <= 120 AND business_unit::text !~ '^\\s|\\s$'::text", name: "membership_applications_business_unit_format"
    t.check_constraint "contribution_start_date IS NULL OR EXTRACT(day FROM contribution_start_date) = 1::numeric", name: "membership_applications_contribution_start_first_of_month"
    t.check_constraint "department IS NULL OR char_length(department::text) >= 1 AND char_length(department::text) <= 120 AND department::text !~ '^\\s|\\s$'::text", name: "membership_applications_department_format"
    t.check_constraint "home_address IS NULL OR char_length(home_address) >= 1 AND char_length(home_address) <= 300 AND home_address !~ '^\\s|\\s$'::text", name: "membership_applications_home_address_format"
    t.check_constraint "marital_status IS NULL OR char_length(marital_status::text) >= 1 AND char_length(marital_status::text) <= 30 AND marital_status::text !~ '^\\s|\\s$'::text", name: "membership_applications_marital_status_format"
    t.check_constraint "monthly_contribution_kobo IS NULL OR monthly_contribution_kobo > 0", name: "membership_applications_monthly_contribution_positive"
    t.check_constraint "nationality IS NULL OR char_length(nationality::text) >= 1 AND char_length(nationality::text) <= 60 AND nationality::text !~ '^\\s|\\s$'::text", name: "membership_applications_nationality_format"
    t.check_constraint "next_of_kin_address IS NULL OR char_length(next_of_kin_address) >= 1 AND char_length(next_of_kin_address) <= 300 AND next_of_kin_address !~ '^\\s|\\s$'::text", name: "membership_applications_next_of_kin_address_format"
    t.check_constraint "next_of_kin_name IS NULL OR char_length(next_of_kin_name::text) >= 1 AND char_length(next_of_kin_name::text) <= 120 AND next_of_kin_name::text !~ '^\\s|\\s$'::text", name: "membership_applications_next_of_kin_name_format"
    t.check_constraint "next_of_kin_phone IS NULL OR next_of_kin_phone::text ~ '^\\+?[0-9]{7,15}$'::text", name: "membership_applications_next_of_kin_phone_format"
    t.check_constraint "next_of_kin_relationship IS NULL OR char_length(next_of_kin_relationship::text) >= 1 AND char_length(next_of_kin_relationship::text) <= 50 AND next_of_kin_relationship::text !~ '^\\s|\\s$'::text", name: "membership_applications_next_of_kin_relationship_format"
    t.check_constraint "office_location IS NULL OR char_length(office_location::text) >= 1 AND char_length(office_location::text) <= 200 AND office_location::text !~ '^\\s|\\s$'::text", name: "membership_applications_office_location_format"
    t.check_constraint "primary_phone IS NULL OR primary_phone::text ~ '^\\+?[0-9]{7,15}$'::text", name: "membership_applications_primary_phone_format"
    t.check_constraint "sap_staff_id IS NULL OR sap_staff_id::text ~ '^[A-Za-z0-9/-]{1,30}$'::text", name: "membership_applications_sap_staff_id_format"
    t.check_constraint "secondary_phone IS NULL OR secondary_phone::text ~ '^\\+?[0-9]{7,15}$'::text", name: "membership_applications_secondary_phone_format"
    t.check_constraint "sex IS NULL OR char_length(sex::text) >= 1 AND char_length(sex::text) <= 30 AND sex::text !~ '^\\s|\\s$'::text", name: "membership_applications_sex_format"
    t.check_constraint "submitted_at IS NULL OR sap_staff_id IS NOT NULL AND business_unit IS NOT NULL AND department IS NOT NULL AND office_location IS NOT NULL AND primary_phone IS NOT NULL AND date_of_birth IS NOT NULL AND sex IS NOT NULL AND marital_status IS NOT NULL AND nationality IS NOT NULL AND home_address IS NOT NULL AND next_of_kin_name IS NOT NULL AND next_of_kin_relationship IS NOT NULL AND next_of_kin_address IS NOT NULL AND monthly_contribution_kobo IS NOT NULL AND contribution_start_date IS NOT NULL AND declaration_version IS NOT NULL AND declaration_accepted_at IS NOT NULL", name: "membership_applications_submitted_complete"
  end

  create_table "sessions", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.string "token_digest", null: false
    t.string "ip_address"
    t.string "user_agent"
    t.datetime "last_seen_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.boolean "admin", default: false, null: false
    t.index ["token_digest"], name: "index_sessions_on_token_digest", unique: true
    t.index ["user_id"], name: "index_sessions_on_user_id"
  end

  create_table "solid_cache_entries", force: :cascade do |t|
    t.binary "key", null: false
    t.binary "value", null: false
    t.datetime "created_at", null: false
    t.bigint "key_hash", null: false
    t.integer "byte_size", null: false
    t.index ["byte_size"], name: "index_solid_cache_entries_on_byte_size"
    t.index ["key_hash", "byte_size"], name: "index_solid_cache_entries_on_key_hash_and_byte_size"
    t.index ["key_hash"], name: "index_solid_cache_entries_on_key_hash", unique: true
  end

  create_table "users", force: :cascade do |t|
    t.string "full_name", null: false
    t.string "email", null: false
    t.string "password_digest", null: false
    t.datetime "email_verified_at"
    t.string "account_status", default: "active", null: false
    t.string "membership_status", default: "not_started", null: false
    t.string "sap_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "email_verification_code_digest"
    t.datetime "email_verification_code_issued_at"
    t.datetime "email_verification_requested_at"
    t.integer "email_verification_generation", default: 0, null: false
    t.integer "email_verification_attempts", default: 0, null: false
    t.string "password_reset_code_digest"
    t.datetime "password_reset_code_issued_at"
    t.datetime "password_reset_requested_at"
    t.integer "password_reset_generation", default: 0, null: false
    t.integer "password_reset_attempts", default: 0, null: false
    t.string "admin_role"
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["sap_id"], name: "index_users_on_sap_id", unique: true
    t.check_constraint "account_status::text = ANY (ARRAY['active'::character varying, 'disabled'::character varying]::text[])", name: "users_account_status_allowed"
    t.check_constraint "admin_role IS NULL OR (admin_role::text = ANY (ARRAY['super_admin'::character varying, 'president'::character varying, 'treasurer'::character varying]::text[]))", name: "users_admin_role_allowed"
    t.check_constraint "admin_role IS NULL OR email_verified_at IS NOT NULL", name: "users_admin_email_verified"
    t.check_constraint "char_length(full_name::text) >= 1 AND char_length(full_name::text) <= 120 AND full_name::text !~ '^\\s|\\s$'::text", name: "users_full_name_trimmed_length"
    t.check_constraint "email::text = lower(email::text) AND char_length(email::text) <= 254 AND email::text ~ '^[^@\\s]+@[^@\\s]+$'::text", name: "users_email_normalized"
    t.check_constraint "email_verification_attempts >= 0 AND email_verification_attempts <= 5", name: "users_email_verification_attempts_range"
    t.check_constraint "membership_status::text = ANY (ARRAY['not_started'::character varying, 'awaiting_approval'::character varying]::text[])", name: "users_membership_status_allowed"
    t.check_constraint "password_reset_attempts >= 0 AND password_reset_attempts <= 5", name: "users_password_reset_attempts_range"
    t.check_constraint "sap_id IS NULL OR sap_id::text !~ '^\\s*$'::text", name: "users_sap_id_not_blank"
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "admin_role_changes", "users"
  add_foreign_key "membership_applications", "users", on_delete: :cascade
  add_foreign_key "sessions", "users", on_delete: :cascade
end
