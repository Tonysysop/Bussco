# Identity store (docs/auth/registration.md). The constraints are the source of truth;
# User validations mirror them for friendly errors.
class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :full_name, null: false
      t.string :email, null: false
      t.string :password_digest, null: false
      t.datetime :email_verified_at
      t.string :account_status, null: false, default: "active"
      # Widened by the membership increment's own migration.
      t.string :membership_status, null: false, default: "not_started"
      t.string :sap_id
      t.timestamps

      t.index :email, unique: true
      t.index :sap_id, unique: true

      t.check_constraint "char_length(full_name) BETWEEN 1 AND 120 AND full_name !~ '^\\s|\\s$'", name: "users_full_name_trimmed_length"
      t.check_constraint "email = lower(email) AND char_length(email) <= 254 AND email ~ '^[^@\\s]+@[^@\\s]+$'", name: "users_email_normalized"
      t.check_constraint "account_status IN ('active', 'disabled')", name: "users_account_status_allowed"
      t.check_constraint "membership_status IN ('not_started')", name: "users_membership_status_allowed"
      t.check_constraint "sap_id IS NULL OR sap_id !~ '^\\s*$'", name: "users_sap_id_not_blank"
    end
  end
end
