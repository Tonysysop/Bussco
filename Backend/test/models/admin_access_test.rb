require "test_helper"

# Admin roles, the role-change audit and the Super Admin guards (docs/auth/admin-access.md).
class AdminAccessTest < ActiveSupport::TestCase
  def user(email, **attrs)
    User.create!(full_name: "Some One", email:, password: "correct horse battery", email_verified_at: Time.current, **attrs)
  end

  # A savepoint, so a rejected statement doesn't abort the test's transaction.
  def assert_db_rejects(error, &) = assert_raises(error) { User.transaction(requires_new: true, &) }

  def admin_session(user) = Session.create!(user:, admin: true, token_digest: SecureRandom.hex, last_seen_at: Time.current)
  def member_session(user) = Session.create!(user:, token_digest: SecureRandom.hex, last_seen_at: Time.current)

  test "only known roles are accepted, by the model and by the database" do
    record = User.new(full_name: "X", email: "x@example.com", password: "correct horse battery",
      email_verified_at: Time.current, admin_role: "owner")
    assert_not record.valid?
    assert record.errors.key?(:admin_role)

    assert_db_rejects(ActiveRecord::CheckViolation) { user("a@example.com").update_columns(admin_role: "owner") }
  end

  test "an admin must have a verified email and an active account" do
    unverified = user("u@example.com", email_verified_at: nil)
    assert_not unverified.update(admin_role: "president")
    assert unverified.errors.key?(:email_verified_at)
    assert_db_rejects(ActiveRecord::CheckViolation) { unverified.update_columns(admin_role: "president") }

    admin = user("p@example.com", admin_role: "president")
    assert_db_rejects(ActiveRecord::CheckViolation) { admin.update_columns(email_verified_at: nil) }
    assert_not admin.update(email_verified_at: nil)

    disabled = user("d@example.com", account_status: "disabled")
    assert_raises(ActiveRecord::RecordInvalid) { disabled.change_admin_role!(:treasurer, by: "Ops", action: :grant) }
    assert_equal 0, AdminRoleChange.count
  end

  test "change_admin_role! records previous role, new role, action, operator and time" do
    target = user("t@example.com")
    freeze_time do
      assert target.change_admin_role!(:treasurer, by: "Jane Ops", action: :grant)
      assert target.change_admin_role!("president", by: "Jane Ops", action: :grant)
      assert target.change_admin_role!(nil, by: "Joe Ops", action: :revoke)

      assert_equal [ [ nil, "treasurer", "grant", "Jane Ops" ], [ "treasurer", "president", "grant", "Jane Ops" ],
        [ "president", nil, "revoke", "Joe Ops" ] ],
        target.admin_role_changes.order(:id).pluck(:previous_role, :new_role, :action, :changed_by)
      assert_equal [ Time.current ], target.admin_role_changes.distinct.pluck(:created_at)
    end
  end

  test "an unchanged role is a no-op with no audit row" do
    target = user("t@example.com", admin_role: "treasurer")
    assert_not target.change_admin_role!(:treasurer, by: "Ops", action: :grant)
    assert_not user("n@example.com").change_admin_role!(nil, by: "Ops", action: :revoke)
    assert_equal 0, AdminRoleChange.count
  end

  test "the role change and its audit row commit together" do
    target = user("t@example.com")
    assert_raises(ActiveRecord::RecordInvalid) { target.change_admin_role!(:treasurer, by: " ", action: :grant) }
    assert_nil target.reload.admin_role
    assert_db_rejects(ActiveRecord::NotNullViolation) do
      AdminRoleChange.insert!({ user_id: target.id, new_role: "treasurer", action: "grant", changed_by: nil, created_at: Time.current })
    end
  end

  test "audit rows are read-only through the application" do
    target = user("t@example.com")
    target.change_admin_role!(:treasurer, by: "Ops", action: :grant)
    row = AdminRoleChange.sole
    assert_raises(ActiveRecord::ReadOnlyRecord) { row.update!(changed_by: "Someone else") }
    assert_raises(ActiveRecord::ReadOnlyRecord) { row.destroy }
    assert_db_rejects(ActiveRecord::InvalidForeignKey) { target.delete } # audit history blocks deleting the user
  end

  test "any role change deletes admin sessions but keeps member sessions" do
    target = user("t@example.com", admin_role: "treasurer")
    admin_session(target)
    kept = member_session(target)

    target.change_admin_role!(:president, by: "Ops", action: :grant)
    assert_equal [ kept.id ], target.sessions.pluck(:id)
  end

  test "bootstrap makes the first Super Admin, once" do
    first = user("s@example.com")
    User.bootstrap_super_admin!(first, by: "Ops")
    assert first.reload.super_admin?
    assert_equal [ [ nil, "super_admin", "bootstrap", "Ops" ] ], AdminRoleChange.pluck(:previous_role, :new_role, :action, :changed_by)

    error = assert_raises(User::ProvisioningError) { User.bootstrap_super_admin!(user("x@example.com"), by: "Ops") }
    assert_match(/already provisioned/, error.message)
  end

  test "bootstrap is refused once a Super Admin was ever provisioned, even one now disabled or revoked" do
    first = user("s@example.com")
    User.bootstrap_super_admin!(first, by: "Ops")
    first.update_columns(account_status: "disabled") # no active Super Admin remains

    assert_raises(User::ProvisioningError) { User.bootstrap_super_admin!(user("x@example.com"), by: "Ops") }

    first.update_columns(admin_role: nil) # no Super Admin at all, but the audit remembers one
    assert_raises(User::ProvisioningError) { User.bootstrap_super_admin!(User.find_by!(email: "x@example.com"), by: "Ops") }
    assert_equal 1, AdminRoleChange.count
  end

  test "the last active Super Admin can't be revoked, switched or disabled" do
    only = user("s@example.com", admin_role: "super_admin")
    user("old@example.com", admin_role: "super_admin").update_columns(account_status: "disabled") # disabled ones don't count

    assert_raises(ActiveRecord::RecordNotSaved) { only.change_admin_role!(nil, by: "Ops", action: :revoke) }
    assert_raises(ActiveRecord::RecordNotSaved) { only.reload.change_admin_role!(:president, by: "Ops", action: :grant) }
    assert_raises(ActiveRecord::RecordNotSaved) { only.reload.disabled! }
    assert only.reload.super_admin?
    assert only.active?
    assert_equal 0, AdminRoleChange.count
  end

  test "a Super Admin can be revoked while another active one remains" do
    first = user("s1@example.com", admin_role: "super_admin")
    user("s2@example.com", admin_role: "super_admin")

    assert first.change_admin_role!(nil, by: "Ops", action: :revoke)
    assert_nil first.reload.admin_role
  end

  test "a Super Admin can be disabled while another active one remains, ending their sessions; the last one can't" do
    first = user("s1@example.com", admin_role: "super_admin")
    second = user("s2@example.com", admin_role: "super_admin")
    admin_session(first)
    member_session(first)
    kept = admin_session(second)

    first.disabled!
    assert first.reload.disabled?
    assert_equal 0, first.sessions.count

    assert_raises(ActiveRecord::RecordNotSaved) { second.disabled! }
    second.reload
    assert second.active?
    assert second.super_admin?
    assert_equal [ kept.id ], second.sessions.pluck(:id)
    assert_equal 0, AdminRoleChange.count
  end

  test "role changes outside change_admin_role! are rejected, so none skips the audit" do
    target = user("t@example.com", admin_role: "treasurer")
    session = admin_session(target)

    [ -> { target.president! }, -> { target.update!(admin_role: "super_admin") }, -> { target.update!(admin_role: nil) } ].each do |change|
      error = assert_raises(ActiveRecord::RecordInvalid) { change.call }
      assert_includes error.record.errors[:admin_role], "can only be changed with change_admin_role!"
      target.reload
    end
    assert_not target.update(admin_role: "president")

    assert target.reload.treasurer?
    assert Session.exists?(session.id)
    assert_equal 0, AdminRoleChange.count

    assert target.change_admin_role!(:president, by: "Ops", action: :grant) # the supported path still works
    assert_raises(ActiveRecord::RecordInvalid) { target.reload.treasurer! } # and doesn't leave the door open
    assert_equal 1, AdminRoleChange.count
  end

  test "emergency replacement swaps atomically, with two audit rows, and ends the old account's admin sessions" do
    from = user("lost@example.com", admin_role: "super_admin")
    admin_session(from)
    to = user("new@example.com")

    User.replace_super_admin!(from, to, by: "Ops")
    assert to.reload.super_admin?
    assert_nil from.reload.admin_role
    assert_equal 0, from.sessions.count
    assert_equal [ [ "new@example.com", nil, "super_admin" ], [ "lost@example.com", "super_admin", nil ] ],
      AdminRoleChange.order(:id).map { [ it.user.email, it.previous_role, it.new_role ] }
    assert_equal [ "emergency_replace" ], AdminRoleChange.distinct.pluck(:action)
  end

  test "emergency replacement recovers from a disabled Super Admin when none is active" do
    from = user("lost@example.com", admin_role: "super_admin")
    from.update_columns(account_status: "disabled")
    to = user("new@example.com")

    User.replace_super_admin!(from, to, by: "Ops")
    assert_equal [ to.id ], User.super_admin.active.pluck(:id)
    assert_nil from.reload.admin_role
  end

  test "emergency replacement with an invalid target changes nothing" do
    from = user("lost@example.com", admin_role: "super_admin")
    targets = [ user("d@example.com", account_status: "disabled"), user("u@example.com", email_verified_at: nil),
      user("p@example.com", admin_role: "president"), from ]

    targets.each do |to|
      assert_raises(User::ProvisioningError, ActiveRecord::RecordInvalid) { User.replace_super_admin!(from, to, by: "Ops") }
    end
    assert_raises(User::ProvisioningError) { User.replace_super_admin!(user("m@example.com"), user("n@example.com"), by: "Ops") }
    assert from.reload.super_admin?
    assert_equal 0, AdminRoleChange.count
  end

  test "expired uses each kind's limits" do
    target = user("t@example.com", admin_role: "president")
    admin_idle = Session.create!(user: target, admin: true, token_digest: "a", last_seen_at: 16.minutes.ago)
    member_idle = Session.create!(user: target, token_digest: "b", last_seen_at: 16.minutes.ago)
    admin_old = Session.create!(user: target, admin: true, token_digest: "c", last_seen_at: Time.current, created_at: 9.hours.ago)
    member_old = Session.create!(user: target, token_digest: "d", last_seen_at: Time.current, created_at: 9.hours.ago)

    assert_equal [ admin_idle.id, admin_old.id ].sort, Session.expired.pluck(:id).sort
    assert admin_idle.expired?
    assert_not member_idle.expired?
    assert admin_old.expired?
    assert_not member_old.expired?
  end
end
