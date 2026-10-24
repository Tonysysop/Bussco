require "test_helper"

# PATCH /api/v1/admin/auth/password: first-login change of the Super Admin's temporary password, and any
# admin's own password change (docs/auth/admin-access.md).
class Api::V1::Admin::Auth::PasswordsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/admin/auth/password".freeze
  LOGIN = "/api/v1/admin/auth/session".freeze
  ME = "/api/v1/admin/auth/me".freeze
  NEW_PASSWORD = "a brand new password".freeze

  setup do
    @root, @temporary = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    @headers = browser_headers
  end

  def login(email: @root.email, password: @temporary)
    post LOGIN, params: { email:, password: }, headers: @headers, as: :json
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body["csrf_token"]) if response.status == 201
  end

  def change(current_password: @temporary, password: NEW_PASSWORD, headers: @headers)
    patch PATH, params: { current_password:, password: }, headers:, as: :json
  end

  test "the temporary password signs in to a restricted session; changing it opens the portal with a fresh session" do
    login
    assert_response :created
    assert response.parsed_body.dig("user", "must_change_password")
    old_cookie = cookies[:bussco_admin]
    stale_headers = @headers

    change
    assert_response :ok
    body = response.parsed_body
    assert_equal false, body.dig("user", "must_change_password")
    assert body["csrf_token"].present?
    assert_not_equal old_cookie, cookies[:bussco_admin]

    get ME, as: :json
    assert_response :ok
    assert_equal false, response.parsed_body.dig("user", "must_change_password")

    cookies[:bussco_admin] = old_cookie # the pre-change session was revoked
    get ME, as: :json
    assert_response :unauthorized

    @headers = browser_headers
    login # the temporary password no longer works
    assert_response :unauthorized
    login(password: NEW_PASSWORD)
    assert_response :created
    assert_equal false, response.parsed_body.dig("user", "must_change_password")

    change(headers: stale_headers) # the CSRF token from before the change is dead
    assert_response :forbidden
  end

  test "a wrong current password, an unchanged or weak new password, change nothing" do
    login
    change(current_password: "not the temporary one")
    assert_response :unprocessable_content
    assert_equal({ "error" => "invalid_current_password" }, response.parsed_body)

    change(password: @temporary)
    assert_response :unprocessable_content
    assert_includes response.parsed_body.dig("errors", "password"), "must be different from the current password"

    [ "short", "", nil, 12345, "a" * 73 ].each do |password|
      change(password:)
      assert_response :unprocessable_content
    end
    assert @root.reload.must_change_password?
    assert @root.authenticate(@temporary)
  end

  test "needs an admin session, CSRF and an allowed Origin" do
    change
    assert_response :unauthorized

    login
    change(headers: @headers.except("X-CSRF-Token"))
    assert_response :forbidden
    change(headers: @headers.except("Origin"))
    assert_response :forbidden
    assert @root.reload.must_change_password?
  end

  test "an expired temporary password neither signs in nor keeps a session" do
    login
    assert_response :created
    @root.update_columns(temporary_password_expires_at: 1.minute.ago)
    get ME, as: :json
    assert_response :unauthorized

    @headers = browser_headers
    login
    assert_response :unauthorized
    assert_equal({ "error" => "invalid_credentials" }, response.parsed_body)
  end

  test "President and Treasurer can change their own password too" do
    president = User.create!(full_name: "Pat", email: "pat@example.com", password: "correct horse battery",
      email_verified_at: Time.current, admin_role: "president")
    login(email: president.email, password: "correct horse battery")
    change(current_password: "correct horse battery")
    assert_response :ok
    assert president.reload.authenticate(NEW_PASSWORD)
  end

  test "is rate limited" do
    login
    10.times { change(current_password: "wrong guess number #{it}") }
    change
    assert_response :too_many_requests
  end

  test "passwords never reach the log" do
    log = capture_log do
      login
      change
    end
    [ @temporary, NEW_PASSWORD ].each { assert_not_includes log, it }
  end
end
