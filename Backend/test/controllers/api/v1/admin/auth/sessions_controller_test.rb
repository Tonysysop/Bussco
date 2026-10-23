require "test_helper"

class Api::V1::Admin::Auth::SessionsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/admin/auth/session".freeze
  ME = "/api/v1/admin/auth/me".freeze
  MEMBER_PATH = "/api/v1/auth/session".freeze
  MEMBER_ME = "/api/v1/auth/me".freeze
  PASSWORD = "correct horse battery".freeze
  EMAIL = "ada@example.com".freeze
  INVALID = { "error" => "invalid_credentials" }.freeze
  UNAUTHENTICATED = { "error" => "unauthenticated" }.freeze

  setup do
    @admin = User.create!(full_name: "Ada Obi", email: EMAIL, password: PASSWORD, email_verified_at: Time.current,
      admin_role: "president")
    @headers = browser_headers
  end

  def login(email: EMAIL, password: PASSWORD, headers: @headers, env: {}, **extra)
    post PATH, params: { email:, password:, **extra }, headers:, env:, as: :json
  end

  def logout(headers: @headers) = delete(PATH, headers:, as: :json)
  def me = get(ME, as: :json)
  def member_login(email:) = post(MEMBER_PATH, params: { email:, password: PASSWORD }, headers: @headers, as: :json)
  def renew_token = @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))
  def admin_set_cookie = Array(response.headers["Set-Cookie"]).join("\n")[/^bussco_admin=.*$/]

  test "each admin role signs in and gets only its safe identity and role" do
    { "super_admin" => "sam@example.com", "president" => EMAIL, "treasurer" => "tia@example.com" }.each do |role, email|
      user = User.find_by(email:) || User.create!(full_name: "Some Admin", email:, password: PASSWORD,
        email_verified_at: Time.current, admin_role: role)
      @headers = browser_headers

      assert_difference("Session.where(user:, admin: true).count") { login(email:) }
      assert_response :created
      body = response.parsed_body
      assert_equal({ "id" => user.id, "full_name" => user.full_name, "email" => email, "admin_role" => role }, body["user"])
      assert body["csrf_token"].present?
      assert_no_match(/password|digest/, response.body)

      me
      assert_response :ok
      assert_equal role, response.parsed_body.dig("user", "admin_role")
    end
  end

  test "the admin cookie is strict, HttpOnly and host-only, and only its digest is stored" do
    login(email: " Ada@Example.COM ")
    set_cookie = admin_set_cookie
    assert_match(/; httponly/i, set_cookie)
    assert_match(/; samesite=strict/i, set_cookie)
    assert_no_match(/; domain=|; expires=|; max-age=/i, set_cookie)
    assert_no_match(/bussco_auth=/, Array(response.headers["Set-Cookie"]).join("\n"))

    token = cookies[:bussco_admin]
    row = Session.sole
    assert row.admin?
    assert_equal Digest::SHA256.hexdigest(token), row.token_digest
    assert_not_includes response.body, token
  end

  test "wrong password, unknown email, disabled admin and non-admin member get the same 401 and no session" do
    member = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD, email_verified_at: Time.current)
    disabled = User.create!(full_name: "Cy Obi", email: "cy@example.com", password: PASSWORD,
      email_verified_at: Time.current, admin_role: "treasurer")
    disabled.update_columns(account_status: "disabled")

    [ { password: "wrong password here" }, { email: "nobody@example.com" }, { email: disabled.email }, { email: member.email } ].each do |attempt|
      assert_no_difference("Session.count") { login(**attempt) }
      assert_response :unauthorized
      assert_equal INVALID, response.parsed_body
      assert_nil admin_set_cookie
    end
  end

  test "blank, non-string, NUL and over-long passwords, and a missing email, get the generic 401" do
    [ "", nil, 12345, "pass\u0000word", "a" * 100 ].each do |password|
      login(password:)
      assert_response :unauthorized
      assert_equal INVALID, response.parsed_body
    end
    post PATH, params: {}, headers: @headers, as: :json
    assert_response :unauthorized
  end

  test "an unparseable body gets a bare 400" do
    post PATH, params: "{not json", headers: @headers.merge("Content-Type" => "application/json")
    assert_response :bad_request
    assert_equal({ "error" => "bad_request" }, response.parsed_body)
  end

  test "client-supplied roles and admin flags grant nothing" do
    member = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD, email_verified_at: Time.current)

    login(email: member.email, admin_role: "super_admin", admin: true, role: "super_admin",
      headers: @headers.merge("X-Admin-Role" => "super_admin"))
    assert_response :unauthorized
    assert_nil member.reload.admin_role

    login(admin_role: "super_admin", headers: @headers.merge("X-Admin-Role" => "super_admin"))
    assert_equal "president", response.parsed_body.dig("user", "admin_role")
    assert_equal "president", @admin.reload.admin_role
  end

  test "missing or forged CSRF token, and missing or foreign Origin, get 403 and no session" do
    [ @headers.except("X-CSRF-Token"), @headers.merge("X-CSRF-Token" => SecureRandom.base64(64)),
      @headers.except("Origin"), @headers.merge("Origin" => "https://evil.example") ].each do |headers|
      assert_no_difference("Session.count") { login(headers:) }
      assert_response :forbidden
      assert_equal({ "error" => "invalid_csrf_token" }, response.parsed_body)
    end
  end

  test "login rotates the CSRF token, and logging in again revokes this browser's previous admin session" do
    login
    first_token = cookies[:bussco_admin]
    stale = @headers
    renew_token

    login(headers: stale) # the pre-login CSRF token no longer works
    assert_response :forbidden

    assert_no_difference("Session.count") { login }
    assert_response :created
    assert_not_equal first_token, cookies[:bussco_admin]

    second = cookies[:bussco_admin]
    cookies[:bussco_admin] = first_token
    me
    assert_response :unauthorized
    cookies[:bussco_admin] = second
    me
    assert_response :ok
  end

  test "logout deletes the session; a replayed cookie gets 401; logout works signed out" do
    login
    token = cookies[:bussco_admin]
    renew_token

    assert_difference("Session.count", -1) { logout }
    assert_response :ok
    renew_token

    cookies[:bussco_admin] = token
    me
    assert_response :unauthorized
    assert_equal UNAUTHENTICATED, response.parsed_body

    logout
    assert_response :ok
  end

  test "me without an admin session is 401" do
    me
    assert_response :unauthorized
    assert_equal UNAUTHENTICATED, response.parsed_body
  end

  test "a member session never reaches admin endpoints, and an admin session never reaches member ones" do
    member = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD, email_verified_at: Time.current)
    member_login(email: member.email)
    assert_response :created
    member_token = cookies[:bussco_auth]
    renew_token

    me
    assert_response :unauthorized
    cookies[:bussco_admin] = member_token # a member token presented as the admin cookie
    me
    assert_response :unauthorized
    assert Session.exists?(token_digest: Session.digest(member_token)), "a wrong-kind lookup must not touch the row"

    login
    admin_token = cookies[:bussco_admin]
    cookies[:bussco_auth] = admin_token # an admin token presented as the member cookie
    get MEMBER_ME, as: :json
    assert_response :unauthorized
    get "/api/v1/membership/application", as: :json
    assert_response :unauthorized
    assert Session.exists?(token_digest: Session.digest(admin_token))
  end

  test "member and admin logins in one browser are independent" do
    login
    admin_token = cookies[:bussco_admin]
    renew_token

    member_login(email: EMAIL) # the same person, as a member
    assert_response :created
    renew_token
    me
    assert_response :ok
    assert_equal admin_token, cookies[:bussco_admin]
    get MEMBER_ME, as: :json
    assert_response :ok

    logout # admin logout leaves the member session
    renew_token
    get MEMBER_ME, as: :json
    assert_response :ok
    me
    assert_response :unauthorized

    login
    renew_token
    delete MEMBER_PATH, headers: @headers, as: :json # member logout leaves the admin session
    me
    assert_response :ok
  end

  test "admin sessions expire after 15 idle minutes or 8 hours, sooner than member sessions" do
    login
    travel(15.minutes + 1.second) { me }
    assert_response :unauthorized
    assert_equal 0, Session.count

    @headers = browser_headers
    login
    Session.update_all(created_at: (8.hours + 1.second).ago) # active throughout, but past the 8-hour limit
    me
    assert_response :unauthorized
    assert_equal 0, Session.count
  end

  test "revoking, switching or disabling, and changes that skip callbacks, end the admin session at once" do
    super_admin = User.create!(full_name: "Sam Obi", email: "sam@example.com", password: PASSWORD,
      email_verified_at: Time.current, admin_role: "super_admin")
    changes = {
      "role revoked" => -> { @admin.change_admin_role!(nil, by: "Ops", action: :revoke) },
      "role switched" => -> { @admin.change_admin_role!(:treasurer, by: "Ops", action: :grant) },
      "account disabled" => -> { @admin.disabled! },
      "password reset" => -> { User.reset_password(@admin.generate_token_for(:password_reset), "a brand new password") },
      "role removed in SQL" => -> { @admin.update_columns(admin_role: nil) },
      "status changed in SQL" => -> { @admin.update_columns(account_status: "disabled") }
    }

    changes.each do |name, change|
      @admin.update_columns(admin_role: "president", account_status: "active", email_verified_at: Time.current)
      @admin.update!(password: PASSWORD)
      @headers = browser_headers
      login
      assert_response :created, name
      me
      assert_response :ok, name

      change.call
      me
      assert_response :unauthorized, name
      assert_not Session.where(user: @admin, admin: true).exists?, name
    end
    assert super_admin.reload.super_admin?
  end

  test "admin login is rate limited per IP and per email, separately from member login" do
    20.times { login(email: "user#{it}@example.com") }
    login
    assert_response :too_many_requests
    assert_equal "900", response.headers["Retry-After"]

    member_login(email: EMAIL)
    assert_response :created
    renew_token

    10.times { login(email: "x@example.com", env: { "REMOTE_ADDR" => "203.0.113.#{it}" }) }
    login(email: "x@example.com", env: { "REMOTE_ADDR" => "203.0.113.99" })
    assert_response :too_many_requests
  end

  test "passwords, emails and tokens never reach the log" do
    log = capture_log do
      login
      me
    end
    token = cookies[:bussco_admin]

    assert_includes log, "Api::V1::Admin::Auth::SessionsController#create"
    [ PASSWORD, EMAIL, token ].each { |secret| assert_not_includes log, secret }
  end
end
