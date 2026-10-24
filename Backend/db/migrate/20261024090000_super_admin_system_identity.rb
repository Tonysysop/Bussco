# A1.3 (docs/auth/admin-access.md): the Super Admin is the single system identity, never a member.
# Exactly one `system` user may exist, and only it may hold super_admin. A1.1 let a member account hold
# super_admin; such roles are revoked first (the member and their cooperative data are kept), with an
# audit row and their admin sessions ended.
class SuperAdminSystemIdentity < ActiveRecord::Migration[8.1]
  def up
    change_table :users do |t|
      t.string :account_type, null: false, default: "member"
      t.boolean :must_change_password, null: false, default: false
      t.datetime :temporary_password_expires_at
    end
    add_column :admin_role_changes, :note, :string

    self.class.revoke_legacy_super_admins(connection)

    add_check_constraint :users, "account_type IN ('member', 'system')", name: "users_account_type_allowed"
    add_check_constraint :users, "(admin_role IS NOT DISTINCT FROM 'super_admin') = (account_type = 'system')",
      name: "users_super_admin_is_system"
    add_check_constraint :users, "account_type <> 'system' OR (membership_status = 'not_started' AND sap_id IS NULL)",
      name: "users_system_not_member"
    add_index :users, :account_type, unique: true, where: "account_type = 'system'", name: "users_one_system_identity"

    remove_check_constraint :admin_role_changes, name: "admin_role_changes_action_allowed"
    add_check_constraint :admin_role_changes,
      "action IN ('bootstrap', 'grant', 'revoke', 'emergency_replace', 'provision', 'recover')",
      name: "admin_role_changes_action_allowed"
    remove_check_constraint :admin_role_changes, name: "admin_role_changes_changes_role"
    add_check_constraint :admin_role_changes, "previous_role IS DISTINCT FROM new_role OR action = 'recover'",
      name: "admin_role_changes_changes_role"
    add_check_constraint :admin_role_changes, "action <> 'recover' OR (note IS NOT NULL AND note !~ '^\\s*$')",
      name: "admin_role_changes_recover_note"
  end

  def down
    remove_check_constraint :admin_role_changes, name: "admin_role_changes_recover_note"
    remove_check_constraint :admin_role_changes, name: "admin_role_changes_changes_role"
    add_check_constraint :admin_role_changes, "previous_role IS DISTINCT FROM new_role", name: "admin_role_changes_changes_role"
    remove_check_constraint :admin_role_changes, name: "admin_role_changes_action_allowed"
    add_check_constraint :admin_role_changes, "action IN ('bootstrap', 'grant', 'revoke', 'emergency_replace')",
      name: "admin_role_changes_action_allowed"
    remove_column :admin_role_changes, :note
    remove_index :users, name: "users_one_system_identity"
    remove_check_constraint :users, name: "users_system_not_member"
    remove_check_constraint :users, name: "users_super_admin_is_system"
    remove_check_constraint :users, name: "users_account_type_allowed"
    remove_column :users, :temporary_password_expires_at
    remove_column :users, :must_change_password
    remove_column :users, :account_type
  end

  # Plain SQL, so it doesn't depend on model code that later changes. Removes only the role: the user,
  # their member sessions and membership data stay. Existing audit rows are never touched.
  def self.revoke_legacy_super_admins(connection)
    ids = connection.select_values("SELECT id FROM users WHERE admin_role = 'super_admin' AND account_type = 'member'")
    return if ids.empty?

    list = ids.map { connection.quote(it) }.join(", ")
    connection.execute("DELETE FROM sessions WHERE admin AND user_id IN (#{list})")
    connection.execute("UPDATE users SET admin_role = NULL, updated_at = now() WHERE id IN (#{list})")
    connection.execute(<<~SQL)
      INSERT INTO admin_role_changes (user_id, previous_role, new_role, action, changed_by, created_at)
      SELECT id, 'super_admin', NULL, 'revoke', 'A1.3 policy migration', now() FROM users WHERE id IN (#{list})
    SQL
  end
end
