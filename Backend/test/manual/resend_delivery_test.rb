require "test_helper"

# Sends one real verification email through Resend. Skipped unless RESEND_TEST_TO is set, so
# bin/rails test and CI never send mail. Run by hand (docs/auth/email-verification.md):
#   RESEND_API_KEY=re_... MAIL_FROM="BUSSCO <verify@your-domain>" RESEND_TEST_TO=you@example.com \
#     bin/rails test test/manual/resend_delivery_test.rb
class ResendDeliveryTest < ActiveSupport::TestCase
  setup do
    skip "set RESEND_TEST_TO (plus RESEND_API_KEY and MAIL_FROM) to send a real email" unless ENV["RESEND_TEST_TO"]
    @delivery_method = ActionMailer::Base.delivery_method
    ActionMailer::Base.delivery_method = :smtp
  end

  teardown { ActionMailer::Base.delivery_method = @delivery_method if @delivery_method }

  test "Resend accepts a verification email over TLS" do
    user = User.create!(full_name: "Resend Test", email: ENV.fetch("RESEND_TEST_TO"), password: "correct horse battery")
    generation = user.request_email_verification

    mail = UserMailer.with(user:, generation:).email_verification.deliver_now

    assert_equal "smtp.resend.com", ActionMailer::Base.smtp_settings[:address]
    assert ActionMailer::Base.smtp_settings[:tls]
    code = mail.text_part.body.decoded[/\b\d{6}\b/]
    assert user.verify_email_code(code), "the emailed code verifies"
  end
end
