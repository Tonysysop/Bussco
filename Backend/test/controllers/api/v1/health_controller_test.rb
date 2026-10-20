require "test_helper"

class Api::V1::HealthControllerTest < ActionDispatch::IntegrationTest
  test "liveness returns ok" do
    get "/up"
    assert_response :success
  end

  test "readiness returns ok when the database answers" do
    get "/api/v1/health/ready"
    assert_response :success
    assert_equal({ "status" => "ok" }, response.parsed_body)
  end

  test "health endpoints set no cookies" do
    get "/up"
    assert_nil response.headers["Set-Cookie"]

    get "/api/v1/health/ready"
    assert_nil response.headers["Set-Cookie"]
  end

  test "readiness returns 503 without details when the database fails" do
    connection = ActiveRecord::Base.connection
    connection.define_singleton_method(:select_value) do |*|
      raise ActiveRecord::ConnectionNotEstablished, "secret-host password=hunter2"
    end

    get "/api/v1/health/ready"

    assert_response :service_unavailable
    assert_equal({ "status" => "unavailable" }, response.parsed_body)
    assert_no_match(/secret-host|hunter2/, response.body)
  ensure
    connection.singleton_class.remove_method(:select_value)
  end
end
