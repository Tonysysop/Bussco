require "test_helper"

class MembershipApplicationTest < ActiveSupport::TestCase
  PNG = "\x89PNG\r\n\x1A\n".b + ("\0" * 64).b

  setup do
    @user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery", email_verified_at: Time.current)
    @application = MembershipApplication.create!(user: @user)
  end

  def complete!
    @application.update!(sap_staff_id: "BUA-10234", business_unit: "BUA Cement", department: "Finance",
      office_location: "Sokoto Plant", primary_phone: "+2348031234567", date_of_birth: "1988-04-12", sex: "Female",
      marital_status: "Married", nationality: "Nigerian", home_address: "12 Marina Road", next_of_kin_name: "Chidi Obi",
      next_of_kin_relationship: "Spouse", next_of_kin_address: "12 Marina Road",
      monthly_contribution_kobo: 3_000_000, contribution_start_date: Date.current.next_month.beginning_of_month)
    @application.passport_photo_file = Rack::Test::UploadedFile.new(StringIO.new(PNG), "image/png", original_filename: "me.png")
    @application.save!
  end

  test "declaration texts are append-only: each version's wording is pinned" do
    pinned = { "draft-v1" => "273b7942a998954e1b2577d024bac1a68c4d089b43e6f29329998b62c51c7743" }
    actual = MembershipApplication::DECLARATIONS.transform_values { Digest::SHA256.hexdigest(it[:text]) }

    assert_equal pinned.keys, actual.keys & pinned.keys, "a declaration version was removed"
    pinned.each { |version, digest| assert_equal digest, actual[version], "#{version} wording changed; add a new version instead" }
    assert_not MembershipApplication::DECLARATIONS["draft-v1"][:approved]
  end

  test "the draft declaration is usable outside production but not in production" do
    assert_equal "draft-v1", MembershipApplication.current_declaration[:version]

    assert_nil MembershipApplication.current_declaration("draft-v1", production: true)
    assert_nil MembershipApplication.current_declaration(nil, production: true)
    assert_nil MembershipApplication.current_declaration("unknown")
    assert_nil MembershipApplication.current_declaration(nil)
  end

  test "drafts may be empty; values are trimmed, phones normalised and blanks cleared" do
    assert @application.valid?
    @application.update!(department: "  Finance ", primary_phone: "+234 (803) 123-4567", nationality: "  ")

    assert_equal "Finance", @application.department
    assert_equal "+2348031234567", @application.primary_phone
    assert_nil @application.nationality
  end

  test "present values are checked even in a draft" do
    {
      sap_staff_id: "BUA 1", business_unit: "x" * 121, sex: "x" * 31, marital_status: "x" * 31, nationality: "x" * 61,
      department: "Fin\u0007ance", primary_phone: "12345", secondary_phone: "+abc1234567", date_of_birth: "12/04/1988",
      monthly_contribution_kobo: 2_999_999, contribution_start_date: "2026-13-01"
    }.each do |field, value|
      application = MembershipApplication.new(user: @user, field => value)
      assert_not application.valid?, "#{field}=#{value.inspect} should be invalid"
      assert application.errors.key?(field), "#{field}: #{application.errors.full_messages}"
    end
  end

  test "addresses may span lines, other text may not contain control characters" do
    assert MembershipApplication.new(user: @user, home_address: "12 Marina Road\r\nLagos").valid?
    assert_not MembershipApplication.new(user: @user, home_address: "12 Marina\u0000Road").valid?
    assert_not MembershipApplication.new(user: @user, next_of_kin_name: "Chidi\nObi").valid?
  end

  test "money must be a whole number of kobo, at least the minimum" do
    [ "abc", "3000000.5", 3_000_000.5, "12abc", -1, 2**63, "9" * 25 ].each do |value|
      assert_not MembershipApplication.new(user: @user, monthly_contribution_kobo: value).valid?, value.inspect
    end
    assert MembershipApplication.new(user: @user, monthly_contribution_kobo: "3000000").valid?
    assert MembershipApplication.new(user: @user, monthly_contribution_kobo: 2**63 - 1).valid?
  end

  test "dates: birth in the past; contributions start on the 1st, next month or later at submission" do
    assert_not MembershipApplication.new(user: @user, date_of_birth: Date.current).valid?
    assert_not MembershipApplication.new(user: @user, contribution_start_date: Date.current.next_month.change(day: 2)).valid?

    this_month = MembershipApplication.new(user: @user, contribution_start_date: Date.current.beginning_of_month)
    assert this_month.valid?, "a draft may hold any 1st"
    assert_not this_month.valid?(:submit)
    assert this_month.errors.key?(:contribution_start_date)
  end

  # 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Lagos (UTC+1): the rules must follow Lagos.
  test "date rules use Nigerian dates around midnight and month boundaries" do
    submit_errors = ->(attributes) do
      application = MembershipApplication.new(user: @user, **attributes)
      application.valid?(:submit)
      application.errors
    end

    travel_to Time.utc(2026, 10, 31, 23, 30) do
      assert_equal Date.new(2026, 11, 1), Date.current
      assert submit_errors.(contribution_start_date: "2026-11-01").key?(:contribution_start_date), "1 Nov is today in Lagos"
      assert_not submit_errors.(contribution_start_date: "2026-12-01").key?(:contribution_start_date)
      assert submit_errors.(date_of_birth: "2026-11-01").key?(:date_of_birth), "born today in Lagos"
      assert_not submit_errors.(date_of_birth: "2026-10-31").key?(:date_of_birth)
    end

    travel_to Time.utc(2026, 10, 31, 22, 30) do # 23:30 on 31 Oct in Lagos
      assert_not submit_errors.(contribution_start_date: "2026-11-01").key?(:contribution_start_date)
      assert submit_errors.(date_of_birth: "2026-10-31").key?(:date_of_birth)
    end

    travel_to Time.utc(2026, 12, 31, 23, 30) do # 00:30 on 1 Jan 2027 in Lagos
      assert submit_errors.(contribution_start_date: "2027-01-01").key?(:contribution_start_date)
      assert_not submit_errors.(contribution_start_date: "2027-02-01").key?(:contribution_start_date)
      assert_includes submit_errors.(contribution_start_date: "2027-01-01")[:contribution_start_date], "must be 2027-02-01 or later"
    end
  end

  test "the photo's type comes from its bytes, not its name or declared type" do
    @application.passport_photo_file = Rack::Test::UploadedFile.new(StringIO.new("GIF89a" + "\0" * 32), "image/png", original_filename: "me.png")
    assert_not @application.valid?
    assert_includes @application.errors[:passport_photo], "must be a JPG or PNG image"

    @application.passport_photo_file = Rack::Test::UploadedFile.new(StringIO.new("\xFF\xD8\xFF\xE0".b + "\0" * 32), "text/plain", original_filename: "x.txt")
    assert @application.valid?
    assert_equal "image/jpeg", @application.passport_photo.blob.content_type
  end

  test "submission validates everything, then marks it submitted and the user awaiting approval, atomically" do
    assert_not @application.submit("draft-v1")
    assert_includes @application.fields_with_errors["employment"], "sap_staff_id"
    assert_includes @application.fields_with_errors["personal"], "passport_photo"
    assert_nil @application.reload.submitted_at

    complete!
    assert @application.submit("draft-v1")
    assert @application.reload.submitted?
    assert_equal "draft-v1", @application.declaration_version
    assert_equal @application.submitted_at, @application.declaration_accepted_at
    assert @user.reload.awaiting_approval?
    assert_raises(ActiveRecord::ReadOnlyRecord) { @application.update!(department: "Audit") }
    assert_equal "Finance", @application.reload.department
  end

  test "if the user update fails, the application is not submitted either" do
    complete!
    @application.user.full_name = "" # makes user.update! raise after the application row is written
    assert_raises(ActiveRecord::RecordInvalid) { @application.submit("draft-v1") }
    assert_nil @application.reload.submitted_at
    assert @user.reload.not_started?
  end

  # Each violation in a savepoint, so the test transaction survives the error.
  def assert_violates(error = ActiveRecord::StatementInvalid, message: nil, &block)
    assert_raises(error, *message) { MembershipApplication.transaction(requires_new: true, &block) }
  end

  test "database constraints back the model" do
    row = MembershipApplication.where(id: @application.id)
    [ { submitted_at: Time.current }, { contribution_start_date: Date.new(2027, 1, 2) }, { monthly_contribution_kobo: 0 },
      { primary_phone: "call me" }, { sex: "x" * 31 }, { sap_staff_id: "BUA 1" },
      "nationality = ' Nigerian'" ].each do |values| # SQL string: update_all would apply normalizes
      assert_violates(message: values.inspect) { row.update_all(values) }
    end
    assert_violates(ActiveRecord::RecordNotUnique) { MembershipApplication.create!(user: @user) }
    assert_violates { User.where(id: @user.id).update_all(membership_status: "approved") }
  end

  test "deleting the user deletes even a submitted application and its photo" do
    complete!
    @application.submit("draft-v1")
    assert_difference([ "MembershipApplication.count", "ActiveStorage::Attachment.count" ], -1) { @user.destroy }
  end
end
