require "test_helper"

class Api::V1::Auth::PasswordResetsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/auth/password_resets".freeze
  VERIFY = "/api/v1/auth/password_resets/verify".freeze
  PASSWORD = "correct horse battery".freeze
  NEW_PASSWORD = "a brand new passphrase".freeze
  EMAIL = "ada@example.com".freeze
  INVALID_CODE = { "error" => "invalid_code" }.freeze
  INVALID_TOKEN = { "error" => "invalid_reset_token" }.freeze

  setup do
    @user = User.create!(full_name: "Ada Obi", email: EMAIL, password: PASSWORD, email_verified_at: Time.current)
    @headers = browser_headers
  end

  def request_code(email: EMAIL, headers: @headers, env: {})
    post PATH, params: { email: }, headers:, env:, as: :json
  end

  def verify(code, email: EMAIL, headers: @headers, env: {})
    post VERIFY, params: { email:, code: }, headers:, env:, as: :json
  end

  # Like the client, swaps in the rotated CSRF token after a successful reset.
  def reset(password = NEW_PASSWORD, headers: @headers)
    patch PATH, params: { password: }, headers:, as: :json
    new_token = response.parsed_body["csrf_token"] if response.media_type == "application/json"
    @headers = @headers.merge("X-CSRF-Token" => new_token) if new_token
  end

  def login(password, email: EMAIL)
    other = open_session
    other.get "/api/v1/csrf"
    other.post "/api/v1/auth/session", params: { email:, password: },
      headers: { "Origin" => "http://www.example.com", "X-CSRF-Token" => other.response.parsed_body["csrf_token"] }, as: :json
    other.response
  end

  def last_code
    ActionMailer::Base.deliveries.last.text_part.body.decoded[/\b\d{6}\b/]
  end

  def wrong_code = format("%06d", (last_code.to_i + 1) % 1_000_000)

  def verified!
    perform_enqueued_jobs { request_code }
    verify(last_code)
    assert_response :ok
  end

  test "the full flow: code, verification, new password; nobody is signed in until a fresh login" do
    perform_enqueued_jobs { request_code }
    assert_response :accepted
    assert_empty response.body

    assert_no_difference("Session.count") { verify(last_code) }
    assert_response :ok
    assert_equal({}, response.parsed_body)
    get "/api/v1/auth/me"
    assert_response :unauthorized

    old_token = @headers["X-CSRF-Token"]
    perform_enqueued_jobs { reset }
    assert_response :ok
    assert_equal [ "csrf_token" ], response.parsed_body.keys
    assert_not_equal old_token, response.parsed_body["csrf_token"]
    get "/api/v1/auth/me"
    assert_response :unauthorized

    assert_equal 401, login(PASSWORD).status
    assert_equal 201, login(NEW_PASSWORD).status
  end

  test "a successful reset revokes every existing login, and sends a confirmation without secrets" do
    2.times { assert_equal 201, login(PASSWORD).status }
    verified!
    code = last_code

    assert_difference("Session.count", -2) { perform_enqueued_jobs { reset } }
    assert_response :ok

    mail = ActionMailer::Base.deliveries.last
    assert_equal [ EMAIL ], mail.to
    assert_equal "Your BUSSCO password was changed", mail.subject
    [ mail.text_part, mail.html_part ].each do |part|
      assert_includes part.body.decoded, "signed out everywhere"
      assert_not_includes part.body.decoded, code
      assert_not_includes part.body.decoded, NEW_PASSWORD
    end
  end

  test "the reset authorization works once" do
    verified!
    reset
    assert_response :ok

    reset("another long passphrase")
    assert_response :unprocessable_content
    assert_equal INVALID_TOKEN, response.parsed_body
    assert @user.reload.authenticate(NEW_PASSWORD)
  end

  test "a replayed copy of the session cookie can't reset again" do
    verified!
    stolen_cookie, stolen_headers = cookies["_bussco_session"], @headers
    reset
    assert_response :ok

    cookies["_bussco_session"] = stolen_cookie
    reset("another long passphrase", headers: stolen_headers)
    assert_response :unprocessable_content
    assert @user.reload.authenticate(NEW_PASSWORD)
  end

  test "the reset authorization expires after 10 minutes" do
    verified!
    travel(10.minutes + 1.second) { reset }

    assert_response :unprocessable_content
    assert_equal INVALID_TOKEN, response.parsed_body
    assert @user.reload.authenticate(PASSWORD)
  end

  test "a new reset request invalidates an earlier reset authorization" do
    verified!
    travel 61.seconds
    request_code
    reset

    assert_response :unprocessable_content
    assert @user.reload.authenticate(PASSWORD)
  end

  test "resetting without a verified code is rejected" do
    perform_enqueued_jobs { request_code }
    reset

    assert_response :unprocessable_content
    assert_equal INVALID_TOKEN, response.parsed_body
  end

  test "a weak password is rejected and changes nothing; the authorization still works" do
    assert_equal 201, login(PASSWORD).status
    verified!

    [ "short pass", "x" * 11, "", 123_456_789_012, nil ].each do |password|
      assert_no_difference("Session.count") { reset(password) }
      assert_response :unprocessable_content
      assert response.parsed_body["errors"].key?("password"), password.inspect
    end
    assert @user.reload.authenticate(PASSWORD)
    assert_no_enqueued_emails { reset("x" * 11) }

    reset
    assert_response :ok
  end

  test "a disabled account gets no code, and can't use an authorization issued before" do
    verified!
    @user.update!(account_status: "disabled")
    reset
    assert_response :unprocessable_content
    assert @user.reload.authenticate(PASSWORD)

    travel 61.seconds
    assert_no_enqueued_emails { request_code }
    assert_response :accepted
  end

  test "unknown emails get the same 202 and no email; verifying one gets the same 422" do
    assert_no_enqueued_emails { request_code(email: "nobody@example.com") }
    assert_response :accepted
    assert_empty response.body

    verify("123456", email: "nobody@example.com")
    assert_response :unprocessable_content
    assert_equal INVALID_CODE, response.parsed_body
  end

  test "a wrong code is rejected and counted; after five, even the right code fails" do
    perform_enqueued_jobs { request_code }
    verify(wrong_code)
    assert_response :unprocessable_content
    assert_equal INVALID_CODE, response.parsed_body
    assert_equal 1, @user.reload.password_reset_attempts

    4.times { verify(wrong_code) }
    verify(last_code)
    assert_response :unprocessable_content
    assert_equal 5, @user.reload.password_reset_attempts
  end

  test "a code expires 10 minutes after it was issued" do
    perform_enqueued_jobs { request_code }
    travel(10.minutes + 1.second) { verify(last_code) }

    assert_response :unprocessable_content
  end

  test "a code verifies once" do
    verified!
    verify(last_code)

    assert_response :unprocessable_content
  end

  test "requests inside the cooldown send nothing; after it, a new code replaces the old one" do
    perform_enqueued_jobs { request_code }
    old_code = last_code

    assert_no_enqueued_emails { request_code }
    assert_response :accepted

    travel 61.seconds
    perform_enqueued_jobs { request_code }
    assert_equal 2, ActionMailer::Base.deliveries.size
    if old_code != last_code # 1-in-a-million collision would make the old code look valid
      verify(old_code)
      assert_response :unprocessable_content
    end
    verify(last_code)
    assert_response :ok
  end

  test "reset and email verification codes are separate" do
    @user.update!(email_verified_at: nil)
    perform_enqueued_jobs { request_code }

    patch "/api/v1/auth/email_verification", params: { email: EMAIL, code: last_code }, headers: @headers, as: :json
    assert_response :unprocessable_content
    assert_nil @user.reload.email_verified_at

    perform_enqueued_jobs { @user.send_email_verification }
    verify(last_code)
    assert_response :unprocessable_content
  end

  test "a reset keeps verification, statuses, SAP ID and the membership application" do
    @user.update!(membership_status: "awaiting_approval", sap_id: "BUA-10234")
    application = MembershipApplication.create!(user: @user, sap_staff_id: "BUA-10234", department: "Finance",
      primary_phone: "+2348031234567")
    before = [ @user.reload.attributes.slice("email", "email_verified_at", "account_status", "membership_status", "sap_id"),
      application.reload.attributes ]

    verified!
    reset
    assert_response :ok

    assert_equal before, [ @user.reload.attributes.slice(*before.first.keys), application.reload.attributes ]
  end

  test "missing CSRF token or foreign Origin: 403 on every step, nothing sent or changed" do
    perform_enqueued_jobs { request_code }
    code = last_code
    travel 61.seconds
    foreign = @headers.merge("Origin" => "http://evil.example")
    no_token = @headers.except("X-CSRF-Token")

    [ foreign, no_token ].each do |headers|
      assert_no_enqueued_emails { request_code(headers:) }
      assert_response :forbidden
      verify(code, headers:)
      assert_response :forbidden
    end
    assert_equal 0, @user.reload.password_reset_attempts

    verify(code)
    [ foreign, no_token ].each do |headers|
      reset(headers:)
      assert_response :forbidden
    end
    assert @user.reload.authenticate(PASSWORD)
    reset
    assert_response :ok
  end

  test "many people behind one office IP each get their code, up to the flood ceiling" do
    office = { "REMOTE_ADDR" => "198.51.100.7" }
    20.times { |i| request_code(email: "staff#{i}@example.com", env: office) }
    20.times { |i| verify("000000", email: "staff#{i}@example.com", env: office) }
    assert_response :unprocessable_content, "40 requests from one address are still allowed"

    20.times { |i| request_code(email: "more#{i}@example.com", env: office) }
    request_code(env: office)
    assert_response :too_many_requests
    assert_equal "900", response.headers["Retry-After"]
  end

  test "code requests are limited per email, the same for known and unknown addresses" do
    [ EMAIL, "nobody@example.com" ].each do |email|
      5.times { request_code(email:, env: { "REMOTE_ADDR" => "203.0.113.#{it}" }) }
      request_code(email:, env: { "REMOTE_ADDR" => "203.0.113.99" })

      assert_response :too_many_requests
      assert_equal "3600", response.headers["Retry-After"]
      assert_equal({ "error" => "rate_limited" }, response.parsed_body)
    end
  end

  test "verifications are limited per email, the same for known and unknown addresses" do
    [ EMAIL, "nobody@example.com" ].each do |email|
      10.times { verify("000000", email:, env: { "REMOTE_ADDR" => "203.0.113.#{it}" }) }
      verify("000000", email:, env: { "REMOTE_ADDR" => "203.0.113.99" })

      assert_response :too_many_requests
      assert_equal "900", response.headers["Retry-After"]
    end
  end

  test "codes, tokens and passwords never appear in responses, logs or job arguments" do
    token = code = nil
    log = capture_log do
      request_code
      assert_enqueued_jobs 1
      job_args = enqueued_jobs.last[:args].to_s
      perform_enqueued_jobs
      assert_not_includes job_args, last_code
      verify(wrong_code)
      code = last_code
      verify(code)
      token = session[:password_reset_token]
      perform_enqueued_jobs { reset }
    end

    assert_includes log, "Performed ActionMailer::MailDeliveryJob"
    assert token.present?
    [ code, token, NEW_PASSWORD ].each do |secret|
      assert_not_includes log, secret
    end
    assert_not_includes response.body, token
  end

  test "non-string or NUL input is treated as blank, not a server error" do
    perform_enqueued_jobs { request_code }

    post VERIFY, params: { email: EMAIL, code: last_code.to_i }, headers: @headers, as: :json
    assert_response :unprocessable_content
    post VERIFY, params: { email: { "$ne" => "" }, code: last_code }, headers: @headers, as: :json
    assert_response :unprocessable_content
    post PATH, params: { email: "ada\u0000@example.com" }, headers: @headers, as: :json
    assert_response :accepted
    verify(last_code)
    reset("a long passphrase\u0000with NUL")
    assert_response :unprocessable_content
  end
end
