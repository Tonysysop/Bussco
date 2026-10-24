require "test_helper"

# Admin roles, the single system Super Admin, the role-change audit and password changes
# (docs/auth/admin-access.md).
class AdminAccessTest < ActiveSupport::TestCase
  PASSWORD = "correct horse battery".freeze

  def user(email, **attrs)
    User.create!(full_name: "Some One", email:, password: PASSWORD, email_verified_at: Time.current, **attrs)
  end

  def provision(email = "root@example.com") = User.provision_super_admin!(email:, full_name: "System Admin", by: "Ops")

  # A savepoint, so a rejected statement doesn't abort the test's transaction.
  def assert_db_rejects(error, &) = assert_raises(error) { User.transaction(requires_new: true, &) }

  def raw_user(email, **columns)
    User.insert!({ full_name: "Raw", email:, password_digest: "x", email_verified_at: Time.current,
      created_at: Time.current, updated_at: Time.current, **columns })
  end

  def admin_session(user) = Session.create!(user:, admin: true, token_digest: SecureRandom.hex, last_seen_at: Time.current)
  def member_session(user) = Session.create!(user:, token_digest: SecureRandom.hex, last_seen_at: Time.current)

  test "only known roles and account types are accepted, by the model and by the database" do
    record = User.new(full_name: "X", email: "x@example.com", password: PASSWORD, email_verified_at: Time.current, admin_role: "owner")
    assert_not record.valid?
    assert record.errors.key?(:admin_role)

    assert_db_rejects(ActiveRecord::CheckViolation) { user("a@example.com").update_columns(admin_role: "owner") }
    assert_db_rejects(ActiveRecord::CheckViolation) { raw_user("b@example.com", account_type: "robot") }
  end

  test "the database allows one system identity, and super_admin only on it" do
    raw_user("sys@example.com", account_type: "system", admin_role: "super_admin")

    assert_db_rejects(ActiveRecord::RecordNotUnique) { raw_user("two@example.com", account_type: "system", admin_role: "super_admin") }
    assert_db_rejects(ActiveRecord::RecordNotUnique) do
      raw_user("off@example.com", account_type: "system", admin_role: "super_admin", account_status: "disabled")
    end
    assert_db_rejects(ActiveRecord::CheckViolation) { raw_user("m@example.com", admin_role: "super_admin") }
    member = user("p@example.com", admin_role: "president")
    assert_db_rejects(ActiveRecord::CheckViolation) { member.update_columns(admin_role: "super_admin") }
    assert_db_rejects(ActiveRecord::CheckViolation) { User.find_by!(email: "sys@example.com").update_columns(admin_role: "president") }
    assert_db_rejects(ActiveRecord::CheckViolation) { User.find_by!(email: "sys@example.com").update_columns(admin_role: nil) }
  end

  test "the system account can never be a member" do
    system = User.find(raw_user("sys@example.com", account_type: "system", admin_role: "super_admin").rows.first.first)
    assert_db_rejects(ActiveRecord::CheckViolation) { system.update_columns(membership_status: "awaiting_approval") }
    assert_db_rejects(ActiveRecord::CheckViolation) { system.update_columns(sap_id: "SAP-1") }

    application = MembershipApplication.new(user: system)
    assert_not application.valid?
    assert_includes application.errors[:user], "must be a member account"
  end

  test "the model refuses super_admin on members and changing the account type" do
    member = User.new(full_name: "X", email: "x@example.com", password: PASSWORD, email_verified_at: Time.current, admin_role: "super_admin")
    assert_not member.valid?
    assert_includes member.errors[:admin_role], "super_admin belongs only to the system account"

    president = user("p@example.com", admin_role: "president")
    assert_raises(User::ProvisioningError) { president.change_admin_role!(:super_admin, by: "Ops", action: :grant) }
    assert_raises(ActiveRecord::ReadonlyAttributeError) { president.update!(account_type: "system") }
    assert president.reload.member?
    assert_equal 0, AdminRoleChange.count
  end

  test "an admin must have a verified email and an active account" do
    unverified = user("u@example.com", email_verified_at: nil)
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

  test "each office has one holder, in the model and the database" do
    user("p@example.com", admin_role: "president")
    second = user("q@example.com")
    error = assert_raises(ActiveRecord::RecordInvalid) { second.change_admin_role!(:president, by: "Ops", action: :grant) }
    assert_match(/has already been taken/, error.message)
    assert_db_rejects(ActiveRecord::RecordNotUnique) { raw_user("r@example.com", admin_role: "president") }
    assert_equal 0, AdminRoleChange.count
  end

  test "assign_admin_office! demotes the holder and grants the office in one transaction, recording the actor" do
    root, = provision
    holder = user("p@example.com", admin_role: "president")
    target = user("t@example.com", admin_role: "treasurer")
    sessions = [ admin_session(holder), admin_session(target) ]
    kept = member_session(holder)

    assert target.assign_admin_office!(:president, by: root)
    assert_equal [ nil, "president" ], [ holder.reload.admin_role, target.reload.admin_role ]
    assert_equal [ [ holder.id, "president", nil, "revoke" ], [ target.id, "treasurer", "president", "grant" ] ],
      AdminRoleChange.where(changed_by_user: root).order(:id).pluck(:user_id, :previous_role, :new_role, :action)
    assert_equal [ root.email ], AdminRoleChange.where(changed_by_user: root).distinct.pluck(:changed_by)
    assert_not Session.exists?(id: sessions.map(&:id))
    assert Session.exists?(kept.id)
  end

  test "a rejected assignment leaves the holder, the audit and the holder's sessions as they were" do
    root, = provision
    holder = user("p@example.com", admin_role: "president")
    session = admin_session(holder)
    target = user("t@example.com")
    target.update_columns(account_status: "disabled") # turned ineligible after any controller check

    assert_raises(ActiveRecord::RecordInvalid) { target.assign_admin_office!(:president, by: root) }
    assert_equal "president", holder.reload.admin_role
    assert_nil target.reload.admin_role
    assert Session.exists?(session.id)
    assert_equal 1, AdminRoleChange.count # provisioning only
  end

  test "assign_admin_office! never touches super_admin" do
    root, = provision
    assert_raises(User::ProvisioningError) { user("t@example.com").assign_admin_office!(:super_admin, by: root) }
    assert_raises(User::ProvisioningError) { root.assign_admin_office!(:president, by: root) }
    assert_equal "super_admin", root.reload.admin_role
  end

  test "role changes outside change_admin_role! are rejected, so none skips the audit" do
    target = user("t@example.com", admin_role: "treasurer")
    session = admin_session(target)

    [ -> { target.president! }, -> { target.update!(admin_role: nil) } ].each do |change|
      error = assert_raises(ActiveRecord::RecordInvalid) { change.call }
      assert_includes error.record.errors[:admin_role], "can only be changed with change_admin_role!"
      target.reload
    end
    assert_not target.update(admin_role: "president")
    assert target.reload.treasurer?
    assert Session.exists?(session.id)
    assert_equal 0, AdminRoleChange.count
  end

  test "provisioning creates the one system Super Admin with a temporary password, digest only, audited" do
    freeze_time do
      user, password = provision
      assert user.system?
      assert user.super_admin?
      assert user.must_change_password?
      assert user.not_started?
      assert user.email_verified_at?
      assert_equal 72.hours.from_now, user.temporary_password_expires_at
      assert_equal 24, password.length
      assert user.authenticate(password)
      assert_not_includes user.attributes.values.map(&:to_s), password
      assert_equal [ [ nil, "super_admin", "provision", "Ops" ] ], AdminRoleChange.pluck(:previous_role, :new_role, :action, :changed_by)
    end
  end

  test "provisioning is refused once a system identity exists, even a disabled one" do
    root, = provision
    assert_raises(User::ProvisioningError) { provision("another@example.com") }
    root.update_columns(account_status: "disabled")
    assert_raises(User::ProvisioningError) { provision("another@example.com") }
    assert_equal [ root.id ], User.where(account_type: "system").pluck(:id)
    assert_equal 1, AdminRoleChange.count
  end

  test "provisioning with a taken email and no system identity changes nothing" do
    member = user("taken@example.com")
    assert_raises(ActiveRecord::RecordInvalid) { provision(member.email) }
    assert_nil User.system_account
    assert_equal 0, AdminRoleChange.count
  end

  test "changing the password needs the current one, ends every session, and the old password stops working" do
    root, temporary = provision
    admin_session(root)
    other = admin_session(root)
    started = nil

    assert_nil root.change_password("wrong password!", "a brand new password") { started = :nope }
    assert root.reload.must_change_password?

    result = root.change_password(temporary, temporary)
    assert_includes result.errors[:password], "must be different from the current password"
    assert_includes root.reload.change_password(temporary, "short").errors[:password], "is too short (minimum is 12 characters)"
    assert root.reload.must_change_password?

    result = root.reload.change_password(temporary, "a brand new password") { started = Session.count }
    assert_empty result.errors
    assert_equal 0, started, "every session ends before the block starts the replacement"
    assert_not Session.exists?(other.id)
    root.reload
    assert_not root.must_change_password?
    assert_nil root.temporary_password_expires_at
    assert_not root.authenticate(temporary)
    assert root.authenticate("a brand new password")
  end

  test "recovery reissues credentials for the same identity, re-enables it, ends sessions and is audited" do
    root, old = provision
    root.change_password(old, "the chosen password")
    root.update_columns(account_status: "disabled")
    admin_session(root)

    user, password = User.recover_super_admin!(by: "Ops", reason: "Lost device")
    assert_equal root.id, user.id
    assert user.active?
    assert user.must_change_password?
    assert user.authenticate(password)
    assert_not user.authenticate("the chosen password")
    assert_equal 0, user.sessions.count
    assert_equal [ "super_admin", "super_admin", "recover", "Lost device" ],
      AdminRoleChange.order(:id).last.attributes.values_at("previous_role", "new_role", "action", "note")
    assert_equal 1, User.where(account_type: "system").count
  end

  test "recovery can re-point the identity at a newly designated person, recording the change" do
    root, = provision
    user, = User.recover_super_admin!(by: "Ops", reason: "Handover", email: "New.Admin@Example.com", full_name: "New Admin")
    assert_equal [ root.id, "new.admin@example.com", "New Admin" ], [ user.id, user.email, user.full_name ]
    assert_equal "Handover; email root@example.com → new.admin@example.com", AdminRoleChange.order(:id).last.note
  end

  test "recovery needs a provisioned identity and a reason" do
    assert_raises(User::ProvisioningError) { User.recover_super_admin!(by: "Ops", reason: "x") }
    provision
    assert_raises(ActiveRecord::RecordInvalid) { User.recover_super_admin!(by: "Ops", reason: " ") }
    assert_equal 1, AdminRoleChange.count # the provision row only: a rejected recovery leaves nothing
  end

  test "the system account gets no password reset code" do
    root, = provision
    assert_nil root.request_password_reset
    assert_nil root.reload.password_reset_requested_at
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

  test "sessions follow the account: system rows never work as member sessions, expired temporary passwords end admin ones" do
    root, = provision
    Session.create!(user: root, token_digest: Session.digest("member"), last_seen_at: Time.current)
    assert_nil Session.resume("member")
    assert_not Session.exists?(token_digest: Session.digest("member"))

    Session.create!(user: root, admin: true, token_digest: Session.digest("admin"), last_seen_at: Time.current)
    assert Session.resume("admin", admin: true)
    root.update_columns(temporary_password_expires_at: 1.minute.ago)
    assert_nil Session.resume("admin", admin: true)
  end
end
