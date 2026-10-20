require "test_helper"

class Api::V1::Auth::SessionsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/auth/session".freeze
  ME = "/api/v1/auth/me".freeze
  PASSWORD = "correct horse battery".freeze
  EMAIL = "ada@example.com".freeze
  INVALID = { "error" => "invalid_credentials" }.freeze
  UNAUTHENTICATED = { "error" => "unauthenticated" }.freeze

  setup do
    @user = User.create!(full_name: "Ada Obi", email: EMAIL, password: PASSWORD, email_verified_at: Time.current)
    @headers = browser_headers
  end

  def login(email: EMAIL, password: PASSWORD, headers: @headers, env: {})
    post PATH, params: { email:, password: }, headers:, env:, as: :json
  end

  def logout(headers: @headers)
    delete PATH, headers:, as: :json
  end

  def me = get(ME, as: :json)

  def auth_set_cookie = Array(response.headers["Set-Cookie"]).join("\n")[/^bussco_auth=.*$/]

  test "login returns the user and a new CSRF token, and sets a strict HttpOnly host-only cookie" do
    assert_difference("Session.count") { login(email: " Ada@Example.COM ") }

    assert_response :created
    assert_equal EMAIL, response.parsed_body.dig("user", "email")
    assert_equal %w[account_status email email_verified full_name id membership_status],
      response.parsed_body["user"].keys.sort
    assert response.parsed_body["csrf_token"].present?

    set_cookie = auth_set_cookie
    assert_match(/; httponly/i, set_cookie)
    assert_match(/; samesite=strict/i, set_cookie)
    assert_no_match(/; domain=/i, set_cookie)
    assert_no_match(/; expires=|; max-age=/i, set_cookie)

    me
    assert_response :ok
    assert_equal @user.id, response.parsed_body.dig("user", "id")
  end

  test "the database stores only a digest of the token, which is never in a response" do
    login
    token = cookies[:bussco_auth]
    row = Session.sole

    assert_equal 43, token.length # 32 random bytes, URL-safe base64
    assert_equal Digest::SHA256.hexdigest(token), row.token_digest
    assert_not_includes row.attributes.values.map(&:to_s), token
    assert_not_includes response.body, token
  end

  test "wrong password, unknown email and disabled account get the same 401 and no session" do
    disabled = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD,
      email_verified_at: Time.current, account_status: "disabled")

    [ { password: "wrong password here" }, { email: "nobody@example.com" }, { email: disabled.email } ].each do |attempt|
      assert_no_difference("Session.count") { login(**attempt) }
      assert_response :unauthorized
      assert_equal INVALID, response.parsed_body
      assert_nil auth_set_cookie
    end
  end

  test "blank, non-string, NUL and over-long passwords get the generic 401" do
    [ "", nil, 12345, "pass\u0000word", "a" * 100 ].each do |password|
      login(password:)
      assert_response :unauthorized
      assert_equal INVALID, response.parsed_body
    end
  end

  test "an unverified account gets email_not_verified only with the right password" do
    @user.update_columns(email_verified_at: nil)

    login(password: "wrong password here")
    assert_equal INVALID, response.parsed_body

    assert_no_difference("Session.count") { login }
    assert_response :forbidden
    assert_equal({ "error" => "email_not_verified" }, response.parsed_body)
    assert_nil auth_set_cookie
  end

  test "login rotates the CSRF session: the old token fails, the returned one works" do
    old_token = @headers["X-CSRF-Token"]
    login
    new_token = response.parsed_body.fetch("csrf_token")

    logout(headers: @headers.merge("X-CSRF-Token" => old_token))
    assert_response :forbidden
    logout(headers: @headers.merge("X-CSRF-Token" => new_token))
    assert_response :ok
  end

  test "login without a valid CSRF token or from a foreign or missing Origin is rejected" do
    [ @headers.except("X-CSRF-Token"), @headers.merge("X-CSRF-Token" => SecureRandom.base64(32)),
      @headers.merge("Origin" => "https://evil.example"), @headers.except("Origin") ].each do |headers|
      assert_no_difference("Session.count") { login(headers:) }
      assert_response :forbidden
      assert_equal({ "error" => "invalid_csrf_token" }, response.parsed_body)
    end
  end

  test "logout without a valid CSRF token keeps the session" do
    login
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))

    logout(headers: @headers.except("X-CSRF-Token"))
    assert_response :forbidden
    assert_equal 1, Session.count
  end

  test "logout deletes the session server-side, so a replayed cookie gets 401" do
    login
    token = cookies[:bussco_auth]
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))

    assert_difference("Session.count", -1) { logout }
    assert_response :ok
    assert response.parsed_body["csrf_token"].present?

    cookies[:bussco_auth] = token
    me
    assert_response :unauthorized
    assert_equal UNAUTHENTICATED, response.parsed_body
  end

  test "logout without a session still returns 200" do
    logout
    assert_response :ok
  end

  test "me without a cookie, with a forged token or after the row is deleted gets 401" do
    me
    assert_response :unauthorized
    assert_equal UNAUTHENTICATED, response.parsed_body

    cookies[:bussco_auth] = SecureRandom.urlsafe_base64(32)
    me
    assert_response :unauthorized

    login
    Session.delete_all
    me
    assert_response :unauthorized
  end

  test "an idle session expires after 30 minutes and is deleted" do
    login
    travel(29.minutes) { me }
    assert_response :ok

    travel(29.minutes + 30.minutes + 1.second) { me }
    assert_response :unauthorized
    assert_equal 0, Session.count
  end

  test "an active session still expires 12 hours after login" do
    login
    started = Time.current
    ((1..24).map { (it * 29).minutes } << 11.hours + 59.minutes).each do |offset|
      travel_to(started + offset) { me }
      assert_response :ok
    end

    travel_to(started + 12.hours + 1.second) { me }
    assert_response :unauthorized
    assert_equal 0, Session.count
  end

  test "last_seen_at is written at most once a minute" do
    login
    first = Session.sole.last_seen_at

    travel(59.seconds) { me }
    assert_equal first, Session.sole.last_seen_at

    travel(61.seconds) { me }
    assert_operator Session.sole.last_seen_at, :>, first
  end

  test "disabling an account deletes its sessions; a status change that skips callbacks still blocks" do
    login
    assert_difference("Session.count", -1) { @user.disabled! }
    me
    assert_response :unauthorized

    @user.active!
    @headers = browser_headers
    login
    @user.update_columns(account_status: "disabled")
    me
    assert_response :unauthorized
    assert_equal 0, Session.count
  end

  test "login deletes the user's expired sessions and keeps live ones and other users'" do
    other = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD, email_verified_at: Time.current)
    row = ->(user, **times) { Session.create!(user:, token_digest: SecureRandom.hex, last_seen_at: Time.current, **times) }
    idle = row.(@user, last_seen_at: 31.minutes.ago)
    old = row.(@user, created_at: 13.hours.ago)
    live = row.(@user)
    others = row.(other, last_seen_at: 31.minutes.ago)

    login
    assert_response :created
    assert_not Session.exists?(idle.id)
    assert_not Session.exists?(old.id)
    assert Session.exists?(live.id)
    assert Session.exists?(others.id)
  end

  test "logging in again in the same browser revokes only that browser's previous session" do
    other_device = open_session
    other_device.get "/api/v1/csrf"
    other_device.post PATH, params: { email: EMAIL, password: PASSWORD }, as: :json,
      headers: { "Origin" => "http://www.example.com", "X-CSRF-Token" => other_device.response.parsed_body["csrf_token"] }
    assert_equal 201, other_device.response.status

    login
    old_token = cookies[:bussco_auth]
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))

    assert_no_difference("Session.count") { login }
    assert_response :created
    new_token = cookies[:bussco_auth]
    assert_not_equal old_token, new_token
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))

    me
    assert_response :ok
    other_device.get ME, as: :json
    assert_equal 200, other_device.response.status

    cookies[:bussco_auth] = old_token
    me
    assert_response :unauthorized

    cookies[:bussco_auth] = new_token
    assert_difference("Session.count", -1) { logout }
    me
    assert_response :unauthorized
    other_device.get ME, as: :json
    assert_equal 200, other_device.response.status
  end

  test "deleting a user deletes their sessions" do
    login
    assert_difference("Session.count", -1) { @user.destroy }
  end

  test "login is rate limited per IP" do
    20.times { login(email: "user#{it}@example.com") }
    login

    assert_response :too_many_requests
    assert_equal "900", response.headers["Retry-After"]
  end

  test "login is rate limited per email across IPs" do
    10.times { login(password: "wrong password here", env: { "REMOTE_ADDR" => "203.0.113.#{it}" }) }
    login(env: { "REMOTE_ADDR" => "203.0.113.99" })

    assert_response :too_many_requests
  end

  test "passwords, emails and tokens never reach the log" do
    log = capture_log do
      login
      me
    end
    token = cookies[:bussco_auth]

    assert_includes log, "Api::V1::Auth::SessionsController#create"
    [ PASSWORD, EMAIL, token ].each { |secret| assert_not_includes log, secret }
  end
end
