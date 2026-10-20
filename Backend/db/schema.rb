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

ActiveRecord::Schema[8.1].define(version: 2026_10_20_074107) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

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
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["sap_id"], name: "index_users_on_sap_id", unique: true
    t.check_constraint "account_status::text = ANY (ARRAY['active'::character varying, 'disabled'::character varying]::text[])", name: "users_account_status_allowed"
    t.check_constraint "char_length(full_name::text) >= 1 AND char_length(full_name::text) <= 120 AND full_name::text !~ '^\\s|\\s$'::text", name: "users_full_name_trimmed_length"
    t.check_constraint "email::text = lower(email::text) AND char_length(email::text) <= 254 AND email::text ~ '^[^@\\s]+@[^@\\s]+$'::text", name: "users_email_normalized"
    t.check_constraint "membership_status::text = 'not_started'::text", name: "users_membership_status_allowed"
    t.check_constraint "sap_id IS NULL OR sap_id::text !~ '^\\s*$'::text", name: "users_sap_id_not_blank"
  end
end
