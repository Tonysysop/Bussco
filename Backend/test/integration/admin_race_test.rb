require "test_helper"

# Admin access under genuine concurrency (independent connections, committed rows), like
# session_race_test.rb: revokes racing logins, Super Admin guards, and admin session expiry.
class AdminRaceTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  PASSWORD = "correct horse battery".freeze

  teardown do
    AdminRoleChange.delete_all # audit rows block deleting their users
    User.delete_all # sessions go with it (ON DELETE CASCADE)
    SolidCache::Entry.delete_all # rate-limit counters committed by the requests
  end

  test "a revoke racing admin logins leaves no usable admin session" do
    admin = user("ada@example.com", admin_role: "president")
    browsers = Array.new(4) { open_session.tap { it.get "/api/v1/csrf" } }

    results = concurrently([ :revoke, *browsers ]) do |item|
      next User.find(admin.id).change_admin_role!(nil, by: "Ops", action: :revoke) if item == :revoke

      item.post "/api/v1/admin/auth/session", params: { email: admin.email, password: PASSWORD }, as: :json,
        headers: { "Origin" => "http://www.example.com", "X-CSRF-Token" => item.response.parsed_body["csrf_token"] }
      item.response.status
    end

    assert results.first, "the revoke went through"
    assert_empty results.drop(1) - [ 201, 401 ]
    assert_not Session.where(user: admin, admin: true).exists?
    browsers.each do |browser|
      browser.get "/api/v1/admin/auth/me", as: :json
      assert_equal 401, browser.response.status
    end
  end

  test "concurrent revokes of the only two active Super Admins leave exactly one" do
    admins = [ user("s1@example.com", admin_role: "super_admin"), user("s2@example.com", admin_role: "super_admin") ]

    outcomes = concurrently(admins) do |admin|
      admin.change_admin_role!(nil, by: "Ops", action: :revoke)
    rescue ActiveRecord::RecordNotSaved
      :refused
    end

    assert_equal [ :refused, true ], outcomes.sort_by(&:to_s)
    assert_equal 1, User.super_admin.active.count
    assert_equal 1, AdminRoleChange.count
  end

  test "concurrent revoke and disable of the only two active Super Admins leave exactly one" do
    first, second = user("s1@example.com", admin_role: "super_admin"), user("s2@example.com", admin_role: "super_admin")

    concurrently([ -> { first.change_admin_role!(nil, by: "Ops", action: :revoke) }, -> { second.disabled! } ]) do |change|
      change.call
    rescue ActiveRecord::RecordNotSaved
      :refused
    end

    assert_equal 1, User.super_admin.active.count
  end

  # Regression: change_admin_role! used to take the row lock before the advisory lock, the reverse of
  # replace_super_admin!, so these two deadlocked.
  test "a direct role change racing an emergency replacement of the same Super Admin never deadlocks" do
    5.times do |round|
      target = user("x#{round}@example.com", admin_role: "super_admin")
      user("y#{round}@example.com", admin_role: "super_admin")
      replacement = user("z#{round}@example.com")

      outcomes = concurrently([ :revoke, :replace ]) do |item|
        if item == :revoke
          User.find(target.id).change_admin_role!(nil, by: "Ops", action: :revoke)
        else
          User.replace_super_admin!(User.find(target.id), User.find(replacement.id), by: "Ops")
        end
      rescue User::ProvisioningError
        :not_a_super_admin # the revoke won; nothing left to replace
      rescue ActiveRecord::Deadlocked => e
        e
      end

      assert_not outcomes.any?(ActiveRecord::Deadlocked), "round #{round}: #{outcomes}"
      assert_nil target.reload.admin_role
      assert_equal outcomes.include?(:not_a_super_admin) ? 0 : 1, User.where(id: replacement.id).super_admin.count
    end
  end

  test "concurrent bootstraps provision a single Super Admin" do
    candidates = Array.new(3) { user("c#{it}@example.com") }

    outcomes = concurrently(candidates) do |candidate|
      User.bootstrap_super_admin!(candidate, by: "Ops")
    rescue User::ProvisioningError
      :refused
    end

    assert_equal [ :refused, :refused, true ], outcomes.sort_by(&:to_s)
    assert_equal 1, User.super_admin.count
  end

  test "concurrent requests can't keep an admin session past its idle or absolute limit" do
    admin = user("ada@example.com", admin_role: "president")
    session = Session.create!(user: admin, admin: true, token_digest: Session.digest("t"), last_seen_at: 2.minutes.ago)

    assert_equal 1, concurrently(Array.new(4) { session }) { it.touch_last_seen }.sum

    # 16 minutes idle is live for a member, but past the admin limit: touches can't revive it.
    session.update_columns(last_seen_at: 16.minutes.ago)
    assert_equal [ 0 ] * 4, concurrently(Array.new(4) { session }) { it.touch_last_seen }
    assert_equal [ nil ] * 4, concurrently(Array.new(4) { "t" }) { Session.resume(it, admin: true) }
    assert_not Session.exists?(session.id)

    old = Session.create!(user: admin, admin: true, token_digest: Session.digest("o"), last_seen_at: Time.current,
      created_at: (8.hours + 1.second).ago)
    assert_equal [ nil ] * 4, concurrently(Array.new(4) { "o" }) { Session.resume(it, admin: true) }
    assert_not Session.exists?(old.id)
  end

  private

  def user(email, **attrs)
    User.create!(full_name: "Some One", email:, password: PASSWORD, email_verified_at: Time.current, **attrs)
  end

  def concurrently(items)
    start = Queue.new
    threads = items.map do |item|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          start.pop
          yield item
        end
      end
    end
    items.size.times { start << :go }
    threads.map(&:value)
  end
end
