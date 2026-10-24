require "test_helper"

class Api::V1::Admin::RoleChangesControllerTest < ActionDispatch::IntegrationTest
  PASSWORD = "correct horse battery".freeze

  setup do
    @root = User.create!(full_name: "System Admin", email: "root@example.com", password: PASSWORD,
      email_verified_at: Time.current, account_type: "system", admin_role: "super_admin")
    @target = User.create!(full_name: "Tunde Bakare", email: "tunde@example.com", password: PASSWORD, email_verified_at: Time.current)
    headers = browser_headers
    post "/api/v1/admin/auth/session", params: { email: @root.email, password: PASSWORD }, headers:, as: :json
    assert_response :created
  end

  test "history lists portal and operator changes newest first, keeping the operator's recorded name" do
    @target.change_admin_role!(:president, by: "Jane Ops", action: :grant)
    @target.assign_admin_office!(:treasurer, by: @root)

    get "/api/v1/admin/role_changes", as: :json
    assert_response :ok
    rows = response.parsed_body["role_changes"]
    assert_equal [ [ "president", "treasurer", "grant", "System Admin" ], [ nil, "president", "grant", "Jane Ops" ] ],
      rows.map { it.values_at("previous_role", "new_role", "action", "actor") }
    assert_equal({ "id" => @target.id, "full_name" => "Tunde Bakare", "email" => "tunde@example.com" }, rows.first["user"])
    assert rows.first["created_at"].present?
    assert_no_match(/digest|password|token|note/, response.body)
  end

  test "history is read-only: no write routes exist" do
    @target.change_admin_role!(:president, by: "Jane Ops", action: :grant)
    id = AdminRoleChange.sole.id
    %i[patch put delete].each do |verb|
      send(verb, "/api/v1/admin/role_changes/#{id}", as: :json)
      assert_response :not_found
    end
    assert_equal "Jane Ops", AdminRoleChange.find(id).changed_by
  end
end
