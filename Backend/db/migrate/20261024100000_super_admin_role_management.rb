# A1.4 (docs/auth/admin-access.md): the Super Admin manages President and Treasurer in the portal.
# Portal changes record the acting admin's user id; older rows keep only their operator `changed_by` text.
# Each office has at most one holder; the migration stops if existing data already has two.
class SuperAdminRoleManagement < ActiveRecord::Migration[8.1]
  def change
    add_reference :admin_role_changes, :changed_by_user, foreign_key: { to_table: :users }
    add_index :users, :admin_role, unique: true, where: "admin_role IN ('president', 'treasurer')",
      name: "users_one_holder_per_office"
  end
end
