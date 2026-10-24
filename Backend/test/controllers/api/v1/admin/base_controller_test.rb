require "test_helper"

# Test-only admin controllers, so the authorization foundation is tested without shipping a route. Any
# future controller inheriting Admin::BaseController gets the same defaults.
class Api::V1::Admin::AnyAdminProbeController < Api::V1::Admin::BaseController
  def show = render(json: { role: current_admin.admin_role })
end

class Api::V1::Admin::SuperAdminProbeController < Api::V1::Admin::BaseController
  before_action -> { require_admin_role(:super_admin) }
  def show = render(json: { ok: true })
end

class Api::V1::Admin::BaseControllerTest < ActionDispatch::IntegrationTest
  PASSWORD = "correct horse battery".freeze

  setup do
    @member = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD, email_verified_at: Time.current)
    %w[president treasurer].each do |role|
      User.create!(full_name: "Some Admin", email: "#{role}@example.com", password: PASSWORD,
        email_verified_at: Time.current, admin_role: role)
    end
    @root, @temporary = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
  end

  test "admin endpoints deny by default: no session and a member session get 401" do
    with_probe_routes do
      get "/api/v1/admin/any", as: :json
      assert_response :unauthorized

      post "/api/v1/auth/session", params: { email: @member.email, password: PASSWORD }, headers: browser_headers, as: :json
      assert_response :created
      get "/api/v1/admin/any", as: :json
      assert_response :unauthorized
      get "/api/v1/admin/super", as: :json
      assert_response :unauthorized
    end
  end

  test "a temporary password opens no admin endpoint until it is changed, then the role check applies" do
    with_probe_routes do
      admin_login(@root.email, @temporary)
      assert response.parsed_body.dig("user", "must_change_password")

      [ "/api/v1/admin/any", "/api/v1/admin/super" ].each do |path|
        get path, as: :json
        assert_response :forbidden
        assert_equal({ "error" => "password_change_required" }, response.parsed_body)
      end
      get "/api/v1/admin/auth/me", as: :json
      assert_response :ok

      patch "/api/v1/admin/auth/password", params: { current_password: @temporary, password: "a brand new password" },
        headers: browser_headers, as: :json
      assert_response :ok

      get "/api/v1/admin/any", as: :json
      assert_equal "super_admin", response.parsed_body["role"]
      get "/api/v1/admin/super", as: :json
      assert_response :ok
    end
  end

  test "any admin passes authentication; only super_admin passes require_admin_role(:super_admin)" do
    @root.change_password(@temporary, PASSWORD)
    with_probe_routes do
      { "root" => [ "super_admin", :ok ], "president" => [ "president", :forbidden ], "treasurer" => [ "treasurer", :forbidden ] }
        .each do |name, (role, status)|
          admin_login("#{name}@example.com")
          get "/api/v1/admin/any", as: :json
          assert_equal role, response.parsed_body["role"]

          get "/api/v1/admin/super", headers: { "X-Admin-Role" => "super_admin" }, params: { admin_role: "super_admin" }
          assert_response status, role
          assert_equal({ "error" => "forbidden" }, response.parsed_body) if status == :forbidden
        end
    end
  end

  test "the role is re-read on every request" do
    with_probe_routes do
      admin_login("president@example.com")
      get "/api/v1/admin/any", as: :json
      assert_equal "president", response.parsed_body["role"]

      User.find_by(email: "treasurer@example.com").update_columns(admin_role: nil) # one holder per office
      User.find_by(email: "president@example.com").update_columns(admin_role: "treasurer") # skips the callbacks
      get "/api/v1/admin/any", as: :json
      assert_equal "treasurer", response.parsed_body["role"]
    end
  end

  private

  def admin_login(email, password = PASSWORD)
    post "/api/v1/admin/auth/session", params: { email:, password: }, headers: browser_headers, as: :json
    assert_response :created
  end

  def with_probe_routes
    with_routing do |set|
      set.draw do
        namespace :api do
          namespace :v1 do
            get "csrf", to: "csrf#show"
            post "auth/session", to: "auth/sessions#create"
            namespace :admin do
              post "auth/session", to: "auth/sessions#create"
              get "auth/me", to: "auth/sessions#show"
              patch "auth/password", to: "auth/passwords#update"
              get "any", to: "any_admin_probe#show"
              get "super", to: "super_admin_probe#show"
            end
          end
        end
      end
      yield
    end
  end
end
