require "test_helper"

class Api::V1::Auth::EmailVerificationsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/auth/email_verification".freeze
  PASSWORD = "correct horse battery".freeze
  EMAIL = "ada@example.com".freeze

  setup { @headers = browser_headers }

  def register(email: EMAIL)
    post "/api/v1/auth/registrations", params: { user: { full_name: "Ada Obi", email:, password: PASSWORD } },
      headers: @headers, as: :json
    assert_response :created
  end

  def resend(email: EMAIL, headers: @headers, env: {})
    post PATH, params: { email: }, headers:, env:, as: :json
  end

  def verify(code, email: EMAIL, headers: @headers)
    patch PATH, params: { email:, code: }, headers:, as: :json
  end

  def last_code
    ActionMailer::Base.deliveries.last.text_part.body.decoded[/\b\d{6}\b/]
  end

  def wrong_code = format("%06d", (last_code.to_i + 1) % 1_000_000)

  def user = User.find_by!(email: EMAIL)

  test "the emailed code verifies the email once, without logging the user in" do
    perform_enqueued_jobs { register }
    verify(last_code)

    assert_response :ok
    assert_equal({ "email_verified" => true }, response.parsed_body)
    assert user.email_verified_at?
    assert_nil user.email_verification_code_digest
    assert_no_match(/bussco_auth/, Array(response.headers["Set-Cookie"]).join("\n"))
    assert_equal [ "active", "not_started" ], [ user.account_status, user.membership_status ]
  end

  test "a used code can't be replayed" do
    perform_enqueued_jobs { register }
    code = last_code
    verify(code)
    verify(code)

    assert_response :unprocessable_content
    assert_equal({ "error" => "invalid_code" }, response.parsed_body)
  end

  test "a wrong code is rejected and counted" do
    perform_enqueued_jobs { register }
    verify(wrong_code)

    assert_response :unprocessable_content
    assert_not user.email_verified_at?
    assert_equal 1, user.email_verification_attempts
  end

  test "after five wrong attempts even the right code fails" do
    perform_enqueued_jobs { register }
    5.times { verify(wrong_code) }
    verify(last_code)

    assert_response :unprocessable_content
    assert_equal 5, user.email_verification_attempts
    assert_not user.email_verified_at?
  end

  test "a code expires 10 minutes after it was issued" do
    perform_enqueued_jobs { register }
    travel(10.minutes + 1.second) { verify(last_code) }

    assert_response :unprocessable_content
    assert_not user.email_verified_at?
  end

  test "expiry counts from when the delayed job issued the code, not from the request" do
    register
    travel 5.minutes
    perform_enqueued_jobs
    travel 9.minutes
    verify(last_code)

    assert_response :ok
  end

  test "resend inside the cooldown sends nothing; after it, a new code replaces the old one" do
    perform_enqueued_jobs { register }
    old_code = last_code

    assert_no_enqueued_emails { resend }
    assert_response :accepted

    travel 61.seconds
    perform_enqueued_jobs { resend }
    assert_response :accepted
    assert_equal 2, ActionMailer::Base.deliveries.size
    new_code = last_code

    if old_code != new_code # 1-in-a-million collision would make the old code look valid
      verify(old_code)
      assert_response :unprocessable_content
    end
    verify(new_code)
    assert_response :ok
  end

  test "a delayed job for a superseded request sends nothing" do
    register # job for generation 1 waits in the queue
    travel 61.seconds
    resend   # generation 2
    perform_enqueued_jobs

    assert_equal 1, ActionMailer::Base.deliveries.size
    verify(last_code)
    assert_response :ok
  end

  test "a stale or repeated job can't overwrite the current code" do
    perform_enqueued_jobs { register }
    code = last_code
    generation = user.email_verification_generation

    assert_no_changes -> { user.email_verification_code_digest } do
      UserMailer.with(user:, generation:).email_verification.deliver_now
      UserMailer.with(user:, generation: generation - 1).email_verification.deliver_now
    end
    assert_equal 1, ActionMailer::Base.deliveries.size

    verify(code)
    assert_response :ok
  end

  test "unknown and already verified emails get the same 202 and no email" do
    perform_enqueued_jobs { register }
    verify(last_code)

    travel 61.seconds
    assert_no_enqueued_emails do
      resend(email: "nobody@example.com")
      assert_response :accepted
      resend
      assert_response :accepted
    end
    assert_empty response.body
  end

  test "verifying an unknown email gets the same 422" do
    verify("123456", email: "nobody@example.com")

    assert_response :unprocessable_content
    assert_equal({ "error" => "invalid_code" }, response.parsed_body)
  end

  test "missing CSRF token or foreign Origin: 403, nothing sent or consumed" do
    perform_enqueued_jobs { register }
    travel 61.seconds

    assert_no_enqueued_emails { resend(headers: @headers.except("X-CSRF-Token")) }
    assert_response :forbidden
    verify(last_code, headers: @headers.merge("Origin" => "http://evil.example"))
    assert_response :forbidden

    assert_equal 0, user.email_verification_attempts
    assert_not user.email_verified_at?
  end

  test "requests are rate limited per IP" do
    20.times { resend(email: "user#{it}@example.com") }
    resend(email: "another@example.com")

    assert_response :too_many_requests
    assert_equal "900", response.headers["Retry-After"]
    assert_equal({ "error" => "rate_limited" }, response.parsed_body)
  end

  test "resends are rate limited per email across IPs" do
    5.times { resend(env: { "REMOTE_ADDR" => "203.0.113.#{it}" }) }
    resend(env: { "REMOTE_ADDR" => "203.0.113.99" })

    assert_response :too_many_requests
    assert_equal "3600", response.headers["Retry-After"]
  end

  test "a failed Resend delivery leaves the account unverified and a later resend works" do
    register
    with_smtp(address: "127.0.0.1", port: 1, password: "re_fake_api_key") do
      log = capture_log { assert_raises(Errno::ECONNREFUSED) { perform_enqueued_jobs } }
      assert_no_match(/re_fake_api_key/, log)
    end

    assert_not user.email_verified_at?
    assert_empty ActionMailer::Base.deliveries

    travel 61.seconds
    perform_enqueued_jobs { resend }
    verify(last_code)
    assert_response :ok
  end

  test "the email names BUSSCO, the code and its 10-minute expiry" do
    perform_enqueued_jobs { register }
    mail = ActionMailer::Base.deliveries.last

    assert_equal [ EMAIL ], mail.to
    assert_equal "Your BUSSCO verification code", mail.subject
    assert_match(/no-reply@localhost/, mail[:from].to_s)
    [ mail.text_part, mail.html_part ].each do |part|
      assert_includes part.body.decoded, last_code
      assert_includes part.body.decoded, "expires in 10 minutes"
      assert_includes part.body.decoded, "BUSSCO"
    end
  end

  test "codes and digests never appear in responses or logs" do
    digest = nil
    log = capture_log do
      perform_enqueued_jobs { register }
      digest = user.email_verification_code_digest
      verify(wrong_code)
      verify(last_code)
    end

    assert_includes log, "Performed ActionMailer::MailDeliveryJob" # the delivery itself was logged
    assert_not_includes log, last_code
    assert_not_includes log, digest
    assert_not_includes response.body, last_code
  end

  test "non-string or NUL input is treated as blank, not a server error" do
    perform_enqueued_jobs { register }

    patch PATH, params: { email: EMAIL, code: 123_456 }, headers: @headers, as: :json
    assert_response :unprocessable_content
    patch PATH, params: { email: { "$ne" => "" }, code: last_code }, headers: @headers, as: :json
    assert_response :unprocessable_content
    post PATH, params: { email: "ada\u0000@example.com" }, headers: @headers, as: :json
    assert_response :accepted
  end

  private

  def with_smtp(**settings)
    method, smtp = ActionMailer::Base.delivery_method, ActionMailer::Base.smtp_settings
    ActionMailer::Base.delivery_method = :smtp
    ActionMailer::Base.smtp_settings = smtp.merge(settings)
    yield
  ensure
    ActionMailer::Base.delivery_method, ActionMailer::Base.smtp_settings = method, smtp
  end
end
