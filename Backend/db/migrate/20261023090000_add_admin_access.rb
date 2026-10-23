# Admin access (docs/auth/admin-access.md): one admin role per user, admin sessions flagged on the
# shared sessions table, and an append-only audit of every role change.
class AddAdminAccess < ActiveRecord::Migration[8.1]
  ROLES = "'super_admin', 'president', 'treasurer'".freeze

  def change
    change_table :users do |t|
      t.string :admin_role

      t.check_constraint "admin_role IS NULL OR admin_role IN (#{ROLES})", name: "users_admin_role_allowed"
      t.check_constraint "admin_role IS NULL OR email_verified_at IS NOT NULL", name: "users_admin_email_verified"
    end

    add_column :sessions, :admin, :boolean, null: false, default: false

    create_table :admin_role_changes do |t|
      # No cascade: a user with audit history can't be deleted.
      t.references :user, null: false, foreign_key: true
      t.string :previous_role
      t.string :new_role
      t.string :action, null: false
      t.string :changed_by, null: false
      t.datetime :created_at, null: false

      t.check_constraint "previous_role IS NULL OR previous_role IN (#{ROLES})", name: "admin_role_changes_previous_role_allowed"
      t.check_constraint "new_role IS NULL OR new_role IN (#{ROLES})", name: "admin_role_changes_new_role_allowed"
      t.check_constraint "previous_role IS DISTINCT FROM new_role", name: "admin_role_changes_changes_role"
      t.check_constraint "action IN ('bootstrap', 'grant', 'revoke', 'emergency_replace')", name: "admin_role_changes_action_allowed"
      t.check_constraint "changed_by !~ '^\\s*$'", name: "admin_role_changes_changed_by_present"
    end
  end
end
