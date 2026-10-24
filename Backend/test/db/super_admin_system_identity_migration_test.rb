require "test_helper"
require Rails.root.join("db/migrate/20261024090000_super_admin_system_identity")

# The A1.3 data step: A1.1 allowed a member account to hold super_admin. The migration removes only that
# role, before the new constraints exist. The schema here already has them, so each test drops them
# inside its own transaction (PostgreSQL DDL is transactional, and the test rolls back).
class SuperAdminSystemIdentityMigrationTest < ActiveSupport::TestCase
  setup do
    connection = ActiveRecord::Base.connection
    connection.remove_check_constraint :users, name: "users_super_admin_is_system"
    connection.remove_index :users, name: "users_one_system_identity"
  end

  def revoke = SuperAdminSystemIdentity.revoke_legacy_super_admins(ActiveRecord::Base.connection)

  test "a legacy member Super Admin loses only the role; the member, their data, member sessions and history stay" do
    legacy = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery",
      email_verified_at: Time.current)
    legacy.update_columns(admin_role: "super_admin") # as A1.1 left it
    application = MembershipApplication.create!(user: legacy, department: "Finance")
    member_session = Session.create!(user: legacy, token_digest: "m", last_seen_at: Time.current)
    Session.create!(user: legacy, admin: true, token_digest: "a", last_seen_at: Time.current)
    history = AdminRoleChange.create!(user: legacy, new_role: "super_admin", action: "bootstrap", changed_by: "Old Ops")
    president = User.create!(full_name: "Pat", email: "pat@example.com", password: "correct horse battery",
      email_verified_at: Time.current, admin_role: "president")

    revoke

    legacy.reload
    assert_nil legacy.admin_role
    assert legacy.member?
    assert legacy.authenticate("correct horse battery")
    assert_equal "Finance", application.reload.department
    assert_equal [ member_session.id ], legacy.sessions.pluck(:id)
    assert_equal history.attributes, AdminRoleChange.find(history.id).attributes
    assert_equal [ [ "super_admin", nil, "revoke", "A1.3 policy migration" ] ],
      AdminRoleChange.where.not(id: history.id).pluck(:previous_role, :new_role, :action, :changed_by)
    assert president.reload.president?
  end

  test "with no Super Admin at all, nothing changes and no audit row is written" do
    User.create!(full_name: "Pat", email: "pat@example.com", password: "correct horse battery",
      email_verified_at: Time.current, admin_role: "treasurer")

    assert_no_difference([ "AdminRoleChange.count", "Session.count" ]) { revoke }
    assert User.find_by!(email: "pat@example.com").treasurer?
  end
end
