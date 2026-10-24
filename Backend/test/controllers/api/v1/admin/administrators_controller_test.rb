require "test_helper"

class Api::V1::Admin::AdministratorsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/admin/administrators".freeze
  PASSWORD = "correct horse battery".freeze

  setup do
    @root = account("root@example.com", account_type: "system", admin_role: "super_admin", full_name: "System Admin")
    @president = account("pres@example.com", admin_role: "president", full_name: "Emeka Nwosu")
    @member = account("chi@example.com", full_name: "Chinedu Eze", membership_status: "awaiting_approval")
    @member.create_membership_application!(sap_staff_id: "BUA-1")
    sign_in(@root)
  end

  def account(email, **attrs)
    User.create!(full_name: "Some One", email:, password: PASSWORD, email_verified_at: Time.current, **attrs)
  end

  def sign_in(user)
    @headers = browser_headers
    post "/api/v1/admin/auth/session", params: { email: user.email, password: PASSWORD }, headers: @headers, as: :json
    assert_response :created
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))
  end

  def change(user, params, headers: @headers) = patch("#{PATH}/#{user.id}", params:, headers:, as: :json)

  test "the Super Admin lists administrators without any authentication data" do
    get PATH, as: :json
    assert_response :ok
    assert_equal [ "Emeka Nwosu", "System Admin" ], response.parsed_body["administrators"].pluck("full_name")
    assert_equal %w[account_status admin_role email full_name id], response.parsed_body["administrators"].first.keys.sort
    assert_no_match(/digest|password|token|code/, response.body)
  end

  test "President, Treasurer, member and anonymous callers are refused on every endpoint" do
    treasurer = account("tia@example.com", admin_role: "treasurer")
    requests = [ -> { get PATH, as: :json }, -> { get "#{PATH}/eligible", params: { q: "chi" } },
      -> { change(@member, { role: "president" }) }, -> { get "/api/v1/admin/role_changes", as: :json } ]

    [ @president, treasurer ].each do |admin|
      sign_in(admin)
      requests.each { it.call; assert_response :forbidden }
    end

    delete "/api/v1/admin/auth/session", headers: @headers, as: :json
    post "/api/v1/auth/session", params: { email: @member.email, password: PASSWORD }, headers: browser_headers, as: :json
    assert_response :created # a member session opens no admin endpoint
    requests.each { it.call; assert_includes [ 401, 403 ], response.status }
    assert_nil @member.reload.admin_role
  end

  test "the Super Admin may not act with a temporary password" do
    @root.update!(must_change_password: true)
    change(@member, { role: "treasurer" })
    assert_response :forbidden
    assert_nil @member.reload.admin_role
  end

  test "unsafe requests need CSRF and Origin" do
    change(@member, { role: "treasurer" }, headers: @headers.except("X-CSRF-Token"))
    assert_response :forbidden
    change(@member, { role: "treasurer" }, headers: @headers.except("Origin"))
    assert_response :forbidden
    assert_nil @member.reload.admin_role
  end

  test "eligible search returns only active, verified members without a role" do
    account("chi.disabled@example.com", full_name: "Chi Disabled", account_status: "disabled")
    account("chi.unverified@example.com", full_name: "Chi Unverified", email_verified_at: nil)
    account("chioma@example.com", full_name: "Chioma Treasurer", admin_role: "treasurer")

    get "#{PATH}/eligible", params: { q: "CHI" }
    assert_response :ok
    assert_equal [ "Chinedu Eze" ], response.parsed_body["accounts"].pluck("full_name")

    get "#{PATH}/eligible", params: { q: "root" }
    assert_empty response.parsed_body["accounts"], "never the system account"
    get "#{PATH}/eligible", params: { q: "%" }
    assert_empty response.parsed_body["accounts"], "LIKE wildcards are literal"
    get "#{PATH}/eligible", params: { q: "c" }
    assert_empty response.parsed_body["accounts"]
  end

  test "assigning an office records the Super Admin's id, ends the target's admin sessions and keeps member data" do
    change(@member, { role: "treasurer" })
    assert_response :ok
    assert_equal({ "id" => @member.id, "full_name" => "Chinedu Eze", "email" => "chi@example.com",
      "admin_role" => "treasurer", "account_status" => "active" }, response.parsed_body["administrator"])

    row = @member.admin_role_changes.sole
    assert_equal [ nil, "treasurer", "grant", @root.id, @root.email ],
      [ row.previous_role, row.new_role, row.action, row.changed_by_user_id, row.changed_by ]
    @member.reload
    assert_equal [ "awaiting_approval", "active", "BUA-1" ],
      [ @member.membership_status, @member.account_status, @member.membership_application.sap_staff_id ]
  end

  test "assigning an occupied office demotes the holder in the same change, with two audit rows" do
    holder_browser = open_session
    holder_browser.get "/api/v1/csrf"
    holder_browser.post "/api/v1/admin/auth/session", params: { email: @president.email, password: PASSWORD }, as: :json,
      headers: { "Origin" => "http://www.example.com", "X-CSRF-Token" => holder_browser.response.parsed_body["csrf_token"] }
    assert_equal 201, holder_browser.response.status

    change(@member, { role: "president" })
    assert_response :ok
    assert_equal "president", @member.reload.admin_role
    assert_nil @president.reload.admin_role
    assert_equal "not_started", @president.membership_status
    assert_equal [ [ "president", nil, "revoke" ] ], @president.admin_role_changes.pluck(:previous_role, :new_role, :action)
    assert_equal [ [ nil, "president", "grant" ] ], @member.admin_role_changes.pluck(:previous_role, :new_role, :action)

    holder_browser.get "/api/v1/admin/auth/me", as: :json
    assert_equal 401, holder_browser.response.status, "the demoted holder is signed out of the admin portal"
  end

  test "a President switches to Treasurer, demoting the current Treasurer" do
    treasurer = account("tia@example.com", admin_role: "treasurer")
    change(@president, { role: "treasurer" })
    assert_response :ok
    assert_equal "treasurer", @president.reload.admin_role
    assert_nil treasurer.reload.admin_role
    assert_equal [ "president", "treasurer", "grant" ], @president.admin_role_changes.sole.slice(:previous_role, :new_role, :action).values
  end

  test "revoking removes the role and is audited; repeating it changes nothing" do
    change(@president, { role: nil })
    assert_response :ok
    assert_nil @president.reload.admin_role
    assert_equal true, response.parsed_body["changed"]

    assert_no_difference("AdminRoleChange.count") { change(@president, { role: nil }) }
    assert_equal false, response.parsed_body["changed"]
  end

  test "role spoofing: super_admin, unknown roles, a missing role and extra fields are rejected or ignored" do
    [ { role: "super_admin" }, { role: "vice_president" }, { role: [ "president" ] }, { role: { x: 1 } }, {},
      { admin_role: "president" } ].each do |params|
      assert_no_difference("AdminRoleChange.count") { change(@member, params) }
      assert_response :unprocessable_content
      assert_equal "invalid_role", response.parsed_body["error"]
    end

    change(@member, { role: "treasurer", changed_by: "Someone else", actor: @president.id, by: @president.id })
    assert_response :ok
    assert_equal [ @root.id, @root.email ], AdminRoleChange.last.slice(:changed_by_user_id, :changed_by).values
    assert_equal "treasurer", @member.reload.admin_role
  end

  test "the system identity, the Super Admin itself, unknown, disabled and unverified targets are refused" do
    disabled = account("off@example.com", account_status: "disabled")
    unverified = account("new@example.com", email_verified_at: nil)

    change(@root, { role: "president" })
    assert_equal [ 422, "not_allowed" ], [ response.status, response.parsed_body["error"] ]
    change(@root, { role: nil })
    assert_equal [ 422, "not_allowed" ], [ response.status, response.parsed_body["error"] ]
    patch "#{PATH}/0", params: { role: "president" }, headers: @headers, as: :json
    assert_response :not_found
    [ disabled, unverified ].each do |user|
      change(user, { role: "treasurer" })
      assert_equal [ 422, "not_eligible" ], [ response.status, response.parsed_body["error"] ]
    end

    assert_equal "super_admin", @root.reload.admin_role
    assert_equal [ "president" ], User.where.not(admin_role: [ nil, "super_admin" ]).pluck(:admin_role)
    assert_equal 0, AdminRoleChange.count
  end
end
