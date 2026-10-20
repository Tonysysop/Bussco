require "test_helper"

# Test-only controller so unsafe requests can be exercised without shipping a placeholder route.
class Api::V1::ForgeryProbeController < Api::V1::BaseController
  def show = render(json: { ok: true })
  def create = head(:no_content)
  def rotate = render(json: { csrf_token: rotate_browser_session })
end

class Api::V1::BaseControllerTest < ActionDispatch::IntegrationTest
  SAME_ORIGIN = "http://www.example.com".freeze
  CSRF_ERROR = { "error" => "invalid_csrf_token" }.freeze

  test "unsafe request with same Origin and valid token succeeds" do
    with_probe_routes do
      post "/api/v1/probe", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => fetch_token }
      assert_response :no_content
    end
  end

  test "missing token is rejected" do
    with_probe_routes do
      fetch_token
      post "/api/v1/probe", headers: { "Origin" => SAME_ORIGIN }
      assert_csrf_rejected
    end
  end

  test "forged token is rejected" do
    with_probe_routes do
      fetch_token
      post "/api/v1/probe", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => SecureRandom.base64(64) }
      assert_csrf_rejected
    end
  end

  test "missing Origin is rejected even with a valid token" do
    with_probe_routes do
      post "/api/v1/probe", headers: { "X-CSRF-Token" => fetch_token }
      assert_csrf_rejected
    end
  end

  test "null Origin is rejected" do
    with_probe_routes do
      post "/api/v1/probe", headers: { "Origin" => "null", "X-CSRF-Token" => fetch_token }
      assert_csrf_rejected
    end
  end

  test "cross-site Origin is rejected even with a valid token" do
    with_probe_routes do
      post "/api/v1/probe", headers: { "Origin" => "https://evil.example", "X-CSRF-Token" => fetch_token }
      assert_csrf_rejected
    end
  end

  test "GET needs neither token nor Origin" do
    with_probe_routes do
      get "/api/v1/probe"
      assert_response :success
    end
  end

  test "rotating the session invalidates the previous token" do
    with_probe_routes do
      old_token = fetch_token
      post "/api/v1/probe/rotate", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => old_token }
      assert_response :success
      new_token = response.parsed_body["csrf_token"]
      assert_predicate new_token, :present?

      post "/api/v1/probe", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => old_token }
      assert_csrf_rejected

      post "/api/v1/probe", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => new_token }
      assert_response :no_content
    end
  end

  # Documents a limit of the cookie store: rotation can't revoke a copy of the old cookie,
  # because the CSRF secret lives in the cookie itself. Server-side revocation is increment 3's job.
  test "a replayed pre-rotation cookie still carries its own valid token" do
    with_probe_routes do
      old_token = fetch_token
      old_cookie = cookies["_bussco_session"]
      post "/api/v1/probe/rotate", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => old_token }
      assert_not_equal old_cookie, cookies["_bussco_session"]

      cookies["_bussco_session"] = old_cookie
      post "/api/v1/probe", headers: { "Origin" => SAME_ORIGIN, "X-CSRF-Token" => old_token }
      assert_response :no_content
    end
  end

  private

  def with_probe_routes
    with_routing do |set|
      set.draw do
        namespace :api do
          namespace :v1 do
            get "csrf", to: "csrf#show"
            get "probe", to: "forgery_probe#show"
            post "probe", to: "forgery_probe#create"
            post "probe/rotate", to: "forgery_probe#rotate"
          end
        end
      end
      yield
    end
  end

  def fetch_token
    get "/api/v1/csrf"
    response.parsed_body["csrf_token"]
  end

  def assert_csrf_rejected
    assert_response :forbidden
    assert_equal CSRF_ERROR, response.parsed_body
  end
end
