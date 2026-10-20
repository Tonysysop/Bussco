require "test_helper"

# Database constraints on users, tested with raw SQL so model validations and
# normalization can't hide a missing constraint.
class UserConstraintsTest < ActiveSupport::TestCase
  VALID_ROW = { full_name: "Ada Obi", email: "ada@example.com", password_digest: "digest" }.freeze

  test "a valid row is accepted" do
    assert_difference("User.count") { raw_insert(VALID_ROW) }
  end

  test "required columns reject NULL" do
    %i[full_name email password_digest account_status membership_status].each do |column|
      assert_rejected(ActiveRecord::NotNullViolation) { raw_insert(VALID_ROW.merge(column => nil)) }
    end
  end

  test "email must be stored normalized" do
    assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(email: "Ada@example.com")) }
    assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(email: "no-at-sign")) }
    assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(email: "#{"a" * 250}@b.cc")) }
  end

  test "email is unique" do
    raw_insert(VALID_ROW)
    assert_rejected(ActiveRecord::RecordNotUnique) { raw_insert(VALID_ROW.merge(full_name: "Someone Else")) }
  end

  test "full name must be trimmed and 1 to 120 characters" do
    [ "", " Ada", "Ada ", "a" * 121 ].each do |name|
      assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(full_name: name)) }
    end
  end

  test "statuses are limited to known values" do
    assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(account_status: "admin")) }
    assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(membership_status: "approved")) }
  end

  test "sap_id is unique, never blank, and may be NULL for many users" do
    raw_insert(VALID_ROW.merge(email: "one@example.com"))
    raw_insert(VALID_ROW.merge(email: "two@example.com"))
    assert_equal 2, User.where(sap_id: nil).count

    raw_insert(VALID_ROW.merge(email: "three@example.com", sap_id: "SAP1"))
    assert_rejected(ActiveRecord::RecordNotUnique) { raw_insert(VALID_ROW.merge(email: "four@example.com", sap_id: "SAP1")) }
    assert_rejected(ActiveRecord::CheckViolation) { raw_insert(VALID_ROW.merge(email: "five@example.com", sap_id: "  ")) }
  end

  test "update_columns can't bypass the constraints" do
    user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery")
    assert_rejected(ActiveRecord::CheckViolation) { user.update_columns(account_status: "superuser") }
  end

  test "verification attempts stay between 0 and 5" do
    user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery")
    assert_rejected(ActiveRecord::CheckViolation) { user.update_columns(email_verification_attempts: -1) }
    assert_rejected(ActiveRecord::CheckViolation) { user.update_columns(email_verification_attempts: 6) }
  end

  private

  def raw_insert(row)
    connection = User.connection
    row = { created_at: Time.current, updated_at: Time.current }.merge(row)
    columns = row.keys.map { |column| connection.quote_column_name(column) }.join(", ")
    values = row.values.map { |value| connection.quote(value) }.join(", ")
    connection.execute("INSERT INTO users (#{columns}) VALUES (#{values})")
  end

  # Savepoint, so a rejected statement doesn't abort the test's transaction.
  def assert_rejected(error_class, &block)
    assert_raises(error_class) { User.transaction(requires_new: true, &block) }
  end
end
