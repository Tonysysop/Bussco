require "test_helper"

# Model validations and normalization. Database constraints are tested separately in
# user_constraints_test.rb, with validations bypassed.
class UserTest < ActiveSupport::TestCase
  def build_user(**attributes)
    User.new({ full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery" }.merge(attributes))
  end

  test "normalizes name and email" do
    user = build_user(full_name: "  Ada Obi  ", email: " Ada@Example.COM ")
    assert user.save
    assert_equal [ "Ada Obi", "ada@example.com" ], user.reload.values_at(:full_name, :email)
  end

  # Regression: EM SPACE passed validation, then the DB check rejected it (unhandled CheckViolation).
  test "trims Unicode spaces from the name so the database check accepts it" do
    user = build_user(full_name: " Ada Obi ")
    assert user.save
    assert_equal "Ada Obi", user.reload.full_name
  end

  test "a new user has exactly the initial account state" do
    user = build_user
    user.save!
    user.reload

    assert_nil user.email_verified_at
    assert_equal "active", user.account_status
    assert_equal "not_started", user.membership_status
    assert_nil user.sap_id
  end

  test "requires full name, email and password" do
    user = User.new(full_name: " ", email: "", password: nil)
    assert_not user.valid?
    assert_includes user.errors[:full_name], "can't be blank"
    assert_includes user.errors[:email], "can't be blank"
    assert_includes user.errors[:password], "can't be blank"
  end

  test "full name is at most 120 characters after trimming" do
    assert build_user(full_name: " #{"a" * 120} ").valid?
    assert_includes build_user(full_name: "a" * 121).tap(&:valid?).errors[:full_name], "is too long (maximum is 120 characters)"
  end

  test "email must be well formed and at most 254 characters" do
    assert_includes build_user(email: "not-an-email").tap(&:valid?).errors[:email], "is invalid"

    email_of_length = ->(length) { "#{"a" * 64}@#{"b" * 63}.#{"c" * 63}.#{"d" * (length - 197)}.com" }
    assert_equal 254, email_of_length.(254).length
    assert build_user(email: email_of_length.(254)).valid?, "254-character email should be valid"
    assert_includes build_user(email: email_of_length.(255)).tap(&:valid?).errors[:email],
      "is too long (maximum is 254 characters)"
  end

  test "email uniqueness ignores case and surrounding spaces" do
    build_user.save!
    duplicate = build_user(email: " ADA@example.com ")
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:email], "has already been taken"
  end

  test "password needs at least 12 characters" do
    assert_includes build_user(password: "a" * 11).tap(&:valid?).errors[:password], "is too short (minimum is 12 characters)"
    assert build_user(password: "a" * 12).valid?
  end

  test "password is limited to 72 bytes, not characters, and is never truncated" do
    euros = "€" * 24
    assert_equal [ 24, 72 ], [ euros.length, euros.bytesize ]
    assert build_user(password: euros).save

    too_long = build_user(email: "bea@example.com", password: euros + "a")
    assert_not too_long.valid?
    assert_includes too_long.errors[:password], "is too long"
  end

  test "password whitespace is preserved" do
    password = "  spaced password  "
    user = build_user(password: password)
    user.save!

    assert user.authenticate(password)
    assert_not user.authenticate(password.strip)
  end

  test "password reset tokens are not part of this increment" do
    assert_not_respond_to build_user, :password_reset_token
  end
end
