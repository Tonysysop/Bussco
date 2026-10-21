require "test_helper"

class UserMailerTest < ActionMailer::TestCase
  setup { @user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery") }

  test "the reset email carries the real code, its expiry, the name and no mockup leftovers" do
    mail = UserMailer.with(user: @user, generation: @user.request_password_reset).password_reset
    code = mail.text_part.body.decoded[/\b\d{6}\b/]

    assert_equal [ "ada@example.com" ], mail.to
    assert_equal "Your BUSSCO password reset code", mail.subject
    assert_equal User.find(@user.id).send(:password_reset_code_digest_for, code), @user.reload.password_reset_code_digest
    [ mail.text_part, mail.html_part ].each do |part|
      body = part.body.decoded
      assert_includes body, code
      assert_includes body, "Ada Obi"
      assert_includes body, "expires in 10 minutes"
      assert_no_match(/482916|\{\{|googleusercontent/, body)
    end
  end

  test "a superseded generation sends nothing" do
    generation = @user.request_password_reset
    @user.update_columns(password_reset_generation: generation + 1)

    assert_nil UserMailer.with(user: @user, generation:).password_reset.message.to
  end

  test "the change confirmation has no code or password" do
    mail = UserMailer.with(user: @user).password_changed

    assert_equal "Your BUSSCO password was changed", mail.subject
    assert_no_match(/\b\d{6}\b/, mail.text_part.body.decoded)
    [ mail.text_part, mail.html_part ].each do |part|
      assert_includes part.body.decoded, "Ada Obi"
      assert_no_match(/passcode|correct horse battery/i, part.body.decoded)
    end
  end
end
