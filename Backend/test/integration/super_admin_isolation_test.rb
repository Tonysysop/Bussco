require "test_helper"

# The Super Admin is the system account, not a cooperative member (docs/auth/admin-access.md): it never
# gets a member session, a password reset code or a membership application. President and Treasurer are
# member accounts and keep every member function.
class SuperAdminIsolationTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PASSWORD = "correct horse battery".freeze

  setup do
    @root, temporary = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    @root.change_password(temporary, PASSWORD)
  end

  def member_login(email) = post("/api/v1/auth/session", params: { email:, password: PASSWORD }, headers: browser_headers, as: :json)

  test "the Super Admin can't sign in as a member and gets the generic answer" do
    assert_no_difference("Session.count") { member_login(@root.email) }
    assert_response :unauthorized
    assert_equal({ "error" => "invalid_credentials" }, response.parsed_body)

    get "/api/v1/membership/application", as: :json
    assert_response :unauthorized
    post "/api/v1/membership/application", headers: browser_headers, as: :json
    assert_response :unauthorized
    assert_nil @root.reload.membership_application
  end

  test "an admin session of the Super Admin opens no member endpoint" do
    post "/api/v1/admin/auth/session", params: { email: @root.email, password: PASSWORD }, headers: browser_headers, as: :json
    assert_response :created
    cookies[:bussco_auth] = cookies[:bussco_admin]

    get "/api/v1/auth/me", as: :json
    assert_response :unauthorized
    get "/api/v1/membership/application", as: :json
    assert_response :unauthorized
  end

  test "password reset for the Super Admin's email answers 202 but sends nothing" do
    assert_no_enqueued_jobs do
      post "/api/v1/auth/password_resets", params: { email: @root.email }, headers: browser_headers, as: :json
    end
    assert_response :accepted
    assert_nil @root.reload.password_reset_code_digest
    assert_nil @root.issue_password_reset_code(@root.password_reset_generation)
  end

  test "registration can't create or claim the system account" do
    post "/api/v1/auth/registrations", headers: browser_headers, as: :json, params: { user: { full_name: "Mallory",
      email: "mallory@example.com", password: PASSWORD, account_type: "system", admin_role: "super_admin" } }
    assert_response :created
    mallory = User.find_by!(email: "mallory@example.com")
    assert mallory.member?
    assert_nil mallory.admin_role

    post "/api/v1/auth/registrations", headers: browser_headers, as: :json,
      params: { user: { full_name: "Mallory", email: @root.email, password: PASSWORD } }
    assert_response :unprocessable_content
    assert_equal 1, User.where(account_type: "system").count
  end

  test "President and Treasurer keep member sign-in and their membership application" do
    %w[president treasurer].each do |role|
      officer = User.create!(full_name: "Officer", email: "#{role}@example.com", password: PASSWORD,
        email_verified_at: Time.current, admin_role: role)
      reset!
      member_login(officer.email)
      assert_response :created, role
      post "/api/v1/membership/application", headers: browser_headers.merge("X-Applicant-Id" => officer.id.to_s), as: :json
      assert_response :created, role
      assert officer.reload.membership_application, role
    end
  end
end
