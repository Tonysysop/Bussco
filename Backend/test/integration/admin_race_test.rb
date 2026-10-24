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

  test "concurrent assignments to a vacant office serialize: one holder, and the audit replays to it" do
    root, = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    targets = Array.new(4) { |i| user("t#{i}@example.com") }

    results = concurrently(targets) { User.find(it.id).assign_admin_office!(:president, by: User.find(root.id)) }

    assert_equal [ true ] * 4, results, "each runs after the previous one commits; none deadlocks or half-applies"
    assert_equal 1, User.where(admin_role: "president").count
    assert_audit_matches_roles
    assert_equal 4, AdminRoleChange.where(action: "grant").count
    assert_equal 3, AdminRoleChange.where(action: "revoke").count
  end

  test "concurrent assignments across both offices and switches keep one holder per office" do
    root, = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    president = user("p@example.com", admin_role: "president")
    treasurer = user("t@example.com", admin_role: "treasurer")
    others = Array.new(2) { |i| user("m#{i}@example.com") }
    jobs = [ [ president, :treasurer ], [ treasurer, :president ], [ others[0], :president ], [ others[1], :treasurer ] ]

    concurrently(jobs) { |target, role| User.find(target.id).assign_admin_office!(role, by: User.find(root.id)) }

    assert_operator User.where(admin_role: "president").count, :<=, 1
    assert_operator User.where(admin_role: "treasurer").count, :<=, 1
    assert_audit_matches_roles
    assert_empty Session.where(admin: true, user: User.where(admin_role: nil)) # demoted admins keep no admin session
  end

  test "concurrent provisioning creates a single system Super Admin" do
    outcomes = concurrently(%w[a b c]) do |name|
      User.provision_super_admin!(email: "#{name}@example.com", full_name: "System #{name}", by: "Ops")
      :created
    rescue User::ProvisioningError
      :refused
    end

    assert_equal [ :created, :refused, :refused ], outcomes.sort
    assert_equal 1, User.where(account_type: "system").count
    assert_equal 1, AdminRoleChange.where(action: "provision").count
  end

  test "parallel password changes with the same old password: one wins, every old session ends, the winner's new one works" do
    root, temporary = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    get "/api/v1/csrf"
    post "/api/v1/admin/auth/session", params: { email: root.email, password: temporary }, as: :json,
      headers: { "Origin" => "http://www.example.com", "X-CSRF-Token" => response.parsed_body["csrf_token"] }
    headers = { "Origin" => "http://www.example.com", "X-CSRF-Token" => response.parsed_body["csrf_token"] }
    browser = { "_bussco_session" => cookies["_bussco_session"], "bussco_admin" => cookies["bussco_admin"] }

    # Four tabs of the signed-in browser, each choosing a different new password.
    tabs = Array.new(4) { |i| [ open_session.tap { |tab| browser.each { |k, v| tab.cookies[k] = v } }, "new password number #{i}" ] }
    results = concurrently(tabs) do |tab, password|
      tab.patch "/api/v1/admin/auth/password", params: { current_password: temporary, password: }, headers:, as: :json
      [ tab.response.status, password, tab.cookies["bussco_admin"] ]
    end

    winners = results.select { |status, *| status == 200 }
    assert_equal 1, winners.size, results.map(&:first).inspect
    assert_empty results.map(&:first) - [ 200, 401, 422 ]
    _, chosen, new_cookie = winners.sole
    root.reload
    assert root.authenticate(chosen)
    assert_not root.authenticate(temporary)
    assert_not root.must_change_password?
    assert_equal 1, root.sessions.where(admin: true).count

    check = open_session
    check.cookies["bussco_admin"] = browser["bussco_admin"]
    check.get "/api/v1/admin/auth/me", as: :json
    assert_equal 401, check.response.status, "the pre-change session is revoked"
    check.cookies["bussco_admin"] = new_cookie
    check.get "/api/v1/admin/auth/me", as: :json
    assert_equal 200, check.response.status, "the winner's fresh session works"
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

  # Each account's latest audit row names its current role, so no change escaped the audit.
  def assert_audit_matches_roles
    User.where(account_type: "member").find_each do |member|
      last = member.admin_role_changes.order(:id).last
      assert_equal member.admin_role.to_s, last&.new_role.to_s, member.email
    end
  end

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
