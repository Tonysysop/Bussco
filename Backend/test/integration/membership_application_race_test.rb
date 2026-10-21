require "test_helper"

# Genuine concurrency on independent connections, so rows are committed (no test transaction).
# Each "tab" is a separate integration session sharing one signed-in browser's cookies.
class MembershipApplicationRaceTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  PATH = "/api/v1/membership/application".freeze
  PASSWORD = "correct horse battery".freeze
  PNG = ("\x89PNG\r\n\x1A\n".b + ("\0" * 64).b).freeze

  setup do
    @user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: PASSWORD, email_verified_at: Time.current)
    @headers = browser_headers
    post "/api/v1/auth/session", params: { email: @user.email, password: PASSWORD }, headers: @headers, as: :json
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"))
  end

  teardown do
    ActiveStorage::Attachment.delete_all
    ActiveStorage::Blob.delete_all
    User.delete_all # sessions and applications go with it (ON DELETE CASCADE)
    SolidCache::Entry.delete_all # rate-limit counters committed by the requests
  end

  test "parallel starts create one application" do
    statuses = concurrently(4) { |tab| tab.post(PATH, headers: @headers, as: :json) }

    assert_equal [ 200, 200, 200, 201 ], statuses.sort
    assert_equal 1, MembershipApplication.where(user: @user).count
  end

  test "parallel saves from the same version: one wins, the rest get 409 and change nothing" do
    post PATH, headers: @headers, as: :json
    statuses = concurrently(4) do |tab, i|
      tab.patch "#{PATH}/stages/employment", params: { lock_version: 0, application: { department: "Tab #{i}" } }, headers: @headers, as: :json
    end

    assert_equal [ 200, 409, 409, 409 ], statuses.sort
    application = MembershipApplication.find_by!(user: @user)
    assert_equal 1, application.lock_version
    assert_match(/\ATab \d\z/, application.department)
  end

  test "a photo upload racing a stage save from the same version can't both land" do
    post PATH, headers: @headers, as: :json
    statuses = concurrently(2) do |tab, i|
      if i.zero?
        tab.put "#{PATH}/passport_photo", headers: @headers,
          params: { lock_version: 0, photo: Rack::Test::UploadedFile.new(StringIO.new(PNG), "image/png", original_filename: "me.png") }
      else
        tab.patch "#{PATH}/stages/employment", params: { lock_version: 0, application: { department: "Finance" } }, headers: @headers, as: :json
      end
    end

    assert_equal [ 200, 409 ], statuses.sort
    # reload: this thread's query cache may still hold the pre-race (empty) attachment lookup.
    application = MembershipApplication.find_by!(user: @user).reload
    assert_equal 1, [ application.passport_photo.attached?, application.department.present? ].count(true)
    assert_equal ActiveStorage::Attachment.count, ActiveStorage::Blob.count, "a rolled-back upload must leave no blob row"
  end

  test "parallel submissions: exactly one succeeds" do
    post PATH, headers: @headers, as: :json
    application = MembershipApplication.find_by!(user: @user)
    application.update!(sap_staff_id: "BUA-1", business_unit: "BUA Cement", department: "Finance", office_location: "Sokoto",
      primary_phone: "+2348031234567", date_of_birth: "1988-04-12", sex: "Female", marital_status: "Married",
      nationality: "Nigerian", home_address: "12 Marina Road", next_of_kin_name: "Chidi Obi", next_of_kin_relationship: "Spouse",
      next_of_kin_address: "12 Marina Road", monthly_contribution_kobo: 3_000_000,
      contribution_start_date: Date.current.next_month.beginning_of_month)
    application.passport_photo_file = Rack::Test::UploadedFile.new(StringIO.new(PNG), "image/png", original_filename: "me.png")
    application.save!
    version = application.reload.lock_version

    statuses = concurrently(4) do |tab|
      tab.post "#{PATH}/submission", params: { lock_version: version, declaration_accepted: true, declaration_version: "draft-v1" },
        headers: @headers, as: :json
    end

    assert_equal [ 201, 409, 409, 409 ], statuses.sort
    assert application.reload.submitted?
    assert @user.reload.awaiting_approval?
  end

  private

  # Runs the block once per tab at the same moment; returns each tab's response status.
  def concurrently(count)
    start = Queue.new
    threads = Array.new(count) do |i|
      tab = open_session
      %w[_bussco_session bussco_auth].each { |name| tab.cookies[name] = cookies[name] }
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          start.pop
          yield tab, i
          tab.response.status
        end
      end
    end
    count.times { start << :go }
    threads.map(&:value)
  end
end
