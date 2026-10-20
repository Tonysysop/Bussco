require "test_helper"

class Api::V1::CsrfControllerTest < ActionDispatch::IntegrationTest
  test "issues a token and an HttpOnly SameSite=Lax session cookie" do
    get "/api/v1/csrf"

    assert_response :success
    assert_predicate response.parsed_body["csrf_token"], :present?
    assert_equal "no-store", response.headers["Cache-Control"]

    cookie = Array(response.headers["Set-Cookie"]).join("\n")
    assert_match(/\A_bussco_session=/, cookie)
    assert_match(/;\s*httponly/i, cookie)
    assert_match(/;\s*samesite=lax/i, cookie)
    assert_no_match(/;\s*secure/i, cookie, "Secure is production-only")
  end

  test "session cookie is Secure only in production" do
    assert_equal Rails.env.production?, Rails.application.config.session_options[:secure]
  end
end
