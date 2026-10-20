require "test_helper"

class Api::V1::Auth::RegistrationsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/auth/registrations".freeze
  PASSWORD = "correct horse battery".freeze
  ALLOWED_KEYS = %w[id full_name email email_verified account_status membership_status].freeze

  def register(headers: browser_headers, env: {}, **user)
    post PATH, params: { user: { full_name: "Ada Obi", email: "ada@example.com", password: PASSWORD }.merge(user) },
      headers: headers, env: env, as: :json
  end

  test "creates an unverified, non-member account and returns only allowlisted fields" do
    assert_difference("User.count") { register(full_name: "  Ada Obi  ", email: " Ada@Example.COM ") }

    assert_response :created
    body = response.parsed_body.fetch("user")
    assert_equal ALLOWED_KEYS.sort, body.keys.sort
    assert_equal({ "full_name" => "Ada Obi", "email" => "ada@example.com", "email_verified" => false,
                   "account_status" => "active", "membership_status" => "not_started" }, body.except("id"))
  end

  test "registration does not log the user in" do
    register
    assert_response :created
    assert_no_match(/bussco_auth/, Array(response.headers["Set-Cookie"]).join("\n"))
    assert_not response.parsed_body.key?("csrf_token")
  end

  test "privileged attributes in the request are ignored" do
    register(role: "admin", admin: true, sap_id: "SAP-1", account_status: "disabled", membership_status: "approved",
             email_verified_at: Time.current.iso8601, id: 999, password_digest: "x")

    assert_response :created
    user = User.sole
    assert_equal [ nil, "active", "not_started", nil ],
      [ user.email_verified_at, user.account_status, user.membership_status, user.sap_id ]
    assert_not_equal 999, user.id
    assert user.authenticate(PASSWORD)
  end

  test "invalid fields return 422 with field errors" do
    register(full_name: "", email: "not-an-email", password: "a" * 11)

    assert_response :unprocessable_content
    errors = response.parsed_body.fetch("errors")
    assert_equal %w[email full_name password], errors.keys.sort
    assert_includes errors["password"], "is too short (minimum is 12 characters)"
  end

  test "72-byte multibyte password is accepted, 73 bytes is rejected" do
    register(password: "€" * 24)
    assert_response :created

    register(email: "bea@example.com", password: "€" * 24 + "a")
    assert_response :unprocessable_content
    assert_includes response.parsed_body.dig("errors", "password"), "is too long"
  end

  test "duplicate email in another case is rejected and the existing account is untouched" do
    register
    original_digest = User.sole.password_digest

    register(email: "ADA@example.com", password: "a different password")

    assert_response :unprocessable_content
    assert_equal({ "email" => [ "has already been taken" ] }, response.parsed_body["errors"])
    assert_equal original_digest, User.sole.password_digest
  end

  test "missing or non-object user is a 400" do
    headers = browser_headers
    [ {}, { user: "ada@example.com" }, { user: [ { email: "ada@example.com" } ] }, { other: 1 } ].each do |params|
      post PATH, params: params, headers: headers, as: :json
      assert_response :bad_request, "params: #{params.inspect}"
      assert_equal({ "error" => "bad_request" }, response.parsed_body)
    end
    assert_equal 0, User.count
  end

  # No Accept header, like a default browser fetch: these used to get Rails' HTML error page.
  test "malformed bodies get a JSON 400 without details" do
    headers = browser_headers.merge("Content-Type" => "application/json")
    { "empty" => "", "invalid JSON" => '{"user": {"email": ', "array root" => "[1, 2]",
      "string root" => '"ada"', "number root" => "5", "null root" => "null" }.each do |name, body|
      post PATH, params: body, headers: headers

      assert_response :bad_request, name
      assert_equal "application/json", response.media_type, name
      assert_equal({ "error" => "bad_request" }, response.parsed_body, name)
    end
    assert_equal 0, User.count
  end

  # Invalid UTF-8 fails in Rails' instrumentation, before rescue_from; Rails then picks the error
  # format from Accept. The API client contract is to send Accept: application/json.
  test "invalid UTF-8 is a 400, JSON when the client accepts JSON" do
    post PATH, params: "{\"user\":{\"full_name\":\"\xFF\"}}".b,
      headers: browser_headers.merge("Content-Type" => "application/json", "Accept" => "application/json")

    assert_response :bad_request
    assert_equal "application/json", response.media_type
    assert_equal 0, User.count
  end

  test "non-string and nested values fail validation instead of erroring" do
    register(full_name: 123, email: { "nested" => "x@example.com" }, password: 123456789012345)
    assert_response :unprocessable_content
    assert_equal %w[email full_name password], response.parsed_body.fetch("errors").keys.sort

    register(full_name: [ "Ada" ], email: true, password: [ PASSWORD ])
    assert_response :unprocessable_content
    assert_equal 0, User.count
  end

  # Regression: a NUL made bcrypt raise ArgumentError (500) when the password was assigned.
  test "NUL characters fail validation instead of erroring" do
    register(full_name: "Ada\u0000Obi", password: "correct horse\u0000battery")
    assert_response :unprocessable_content
    assert_equal %w[full_name password], response.parsed_body.fetch("errors").keys.sort
    assert_equal 0, User.count
  end

  # Regression: EM SPACE around the name reached the DB check (unhandled CheckViolation, 500).
  test "Unicode spaces around the name are trimmed" do
    register(full_name: " Ada Obi ")
    assert_response :created
    assert_equal "Ada Obi", response.parsed_body.dig("user", "full_name")
  end

  test "requires CSRF token and same-origin Origin" do
    headers = browser_headers
    register(headers: headers.except("X-CSRF-Token"))
    assert_response :forbidden

    register(headers: headers.merge("Origin" => "https://evil.example"))
    assert_response :forbidden

    register(headers: headers.except("Origin"))
    assert_response :forbidden

    assert_equal 0, User.count
  end

  test "the 11th request from one IP within 15 minutes is rate limited" do
    headers = browser_headers
    10.times { |i| register(email: "user#{i}@example.com", headers: headers) }
    assert_equal 10, User.count

    register(email: "eleventh@example.com", headers: headers)
    assert_response :too_many_requests
    assert_equal "900", response.headers["Retry-After"]
    assert_equal({ "error" => "rate_limited" }, response.parsed_body)

    register(email: "other-ip@example.com", headers: headers, env: { "REMOTE_ADDR" => "203.0.113.7" })
    assert_response :created
  end

  test "rejected CSRF requests don't consume the rate limit" do
    headers = browser_headers
    11.times { register(headers: headers.except("X-CSRF-Token")) }
    register(headers: headers)
    assert_response :created
  end

  test "rate limiter fails open and logs when the store is unavailable" do
    entry = SolidCache::Entry.singleton_class
    entry.alias_method(:original_lock_and_write, :lock_and_write)
    entry.define_method(:lock_and_write) { |*| raise ActiveRecord::ConnectionNotEstablished, "cache database down" }
    headers = browser_headers

    log = capture_log { 11.times { |i| register(email: "user#{i}@example.com", headers: headers) } }

    assert_equal 11, User.count, "store errors must not block registration"
    assert_match(/Rate limit store increment failed \(ActiveRecord::ConnectionNotEstablished\); request allowed/, log)
    assert_no_match(/cache database down/, log)
  ensure
    entry.alias_method(:lock_and_write, :original_lock_and_write)
    entry.remove_method(:original_lock_and_write)
  end

  test "password and digest never appear in responses or logs" do
    log = capture_log { register }
    digest = User.sole.password_digest

    [ response.body, log ].each do |output|
      assert_not_includes output, PASSWORD
      assert_not_includes output, digest
    end
    assert_no_match(/password/i, response.body)
    assert_match(/\[FILTERED\]/, log)
  end

  private

  def capture_log
    io = StringIO.new
    sink = ActiveSupport::Logger.new(io)
    Rails.logger.broadcast_to(sink)
    yield
    io.string
  ensure
    Rails.logger.stop_broadcasting_to(sink)
  end
end
