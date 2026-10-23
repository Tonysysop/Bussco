require "test_helper"

class Api::V1::Membership::ApplicationsControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/membership/application".freeze
  PHOTO = "#{PATH}/passport_photo".freeze
  PASSWORD = "correct horse battery".freeze
  PNG = ("\x89PNG\r\n\x1A\n".b + ("\0" * 64).b).freeze
  JPEG = ("\xFF\xD8\xFF\xE0".b + ("\0" * 64).b).freeze

  STAGES = {
    "employment" => { sap_staff_id: "BUA-10234", business_unit: "BUA Cement", department: "Finance", office_location: "Sokoto Plant" },
    "personal" => { primary_phone: "+234 803 123 4567", secondary_phone: "", date_of_birth: "1988-04-12", sex: "Female",
                    marital_status: "Married", nationality: "Nigerian", home_address: "12 Marina Road\nLagos" },
    "next_of_kin" => { next_of_kin_name: "Chidi Obi", next_of_kin_relationship: "Spouse", next_of_kin_phone: nil,
                       next_of_kin_address: "12 Marina Road\nLagos" },
    "savings" => { monthly_contribution_kobo: 3_000_000, contribution_start_date: Date.current.next_month.beginning_of_month.iso8601 }
  }.freeze

  setup do
    @user = sign_up_and_in("ada@example.com")
  end

  # Signs in through the real login endpoint and keeps the rotated CSRF token in @headers.
  def sign_up_and_in(email)
    user = User.create!(full_name: "Ada Obi", email:, password: PASSWORD, email_verified_at: Time.current)
    @headers = browser_headers
    post "/api/v1/auth/session", params: { email:, password: PASSWORD }, headers: @headers, as: :json
    @headers = @headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrf_token"), "X-Applicant-Id" => user.id.to_s)
    user
  end

  def start(headers: @headers) = post(PATH, headers:, as: :json)
  def show = get(PATH, as: :json)
  def version = MembershipApplication.find_by!(user: @user).lock_version
  def body = response.parsed_body
  def saved = MembershipApplication.find_by!(user: @user)

  def save_stage(stage, attributes, lock_version: version, headers: @headers)
    patch "#{PATH}/stages/#{stage}", params: { lock_version:, application: attributes }, headers:, as: :json
  end

  def upload(bytes, type = "image/png", name = "me.png") = Rack::Test::UploadedFile.new(StringIO.new(bytes), type, original_filename: name)

  def put_photo(file, lock_version: version, headers: @headers)
    put PHOTO, params: { photo: file, lock_version: }, headers:
  end

  def submit(lock_version: version, accepted: true, declaration_version: "draft-v1", headers: @headers)
    post "#{PATH}/submission", params: { lock_version:, declaration_accepted: accepted, declaration_version: }, headers:, as: :json
  end

  def complete_all
    start
    STAGES.each { |stage, attributes| save_stage(stage, attributes) }
    put_photo(upload(PNG))
    assert_response :ok
  end

  test "every endpoint needs a session" do
    delete "/api/v1/auth/session", headers: @headers, as: :json
    @headers = @headers.merge("X-CSRF-Token" => body.fetch("csrf_token"))

    [ -> { show }, -> { start }, -> { save_stage("employment", {}, lock_version: 0) }, -> { get PHOTO },
      -> { put_photo(upload(PNG), lock_version: 0) }, -> { submit(lock_version: 0) } ].each do |request|
      request.call
      assert_response :unauthorized
      assert_equal({ "error" => "unauthenticated" }, body)
    end
  end

  test "a disabled account can't use its application" do
    start
    @user.disabled!
    show
    assert_response :unauthorized
  end

  test "start once: 201 with prefilled applicant details, then 200 with the same draft" do
    show
    assert_response :not_found

    assert_difference("MembershipApplication.count") { start }
    assert_response :created
    assert_equal({ "full_name" => "Ada Obi", "email" => "ada@example.com", "membership_status" => "not_started" }, body["applicant"])
    assert_equal 0, body.dig("application", "lock_version")
    assert_nil body.dig("application", "submitted_at")
    assert_equal "employment", body.dig("progress", "current_stage")
    assert_equal({ "minimum_monthly_contribution_kobo" => 3_000_000, "registration_fee_kobo" => 1_000_000 },
      body["policy"].except("declaration"))
    assert_equal({ "version" => "draft-v1", "approved" => false }, body.dig("policy", "declaration").except("text"))

    assert_no_difference("MembershipApplication.count") { start }
    assert_response :ok
  end

  test "stages save on their own, can be partial, and resume with their values" do
    start
    save_stage("savings", { monthly_contribution_kobo: 3_500_000 })
    assert_response :ok
    save_stage("employment", { department: "Finance" })
    assert_response :ok

    show
    assert_equal 3_500_000, body.dig("application", "monthly_contribution_kobo")
    assert_equal "Finance", body.dig("application", "department")
    assert_nil body.dig("application", "sap_staff_id")
    assert_equal "incomplete", body.dig("progress", "stages", "employment")
    assert_equal %w[sap_staff_id business_unit office_location], body.dig("progress", "missing", "employment")
    assert_includes body.dig("progress", "missing", "savings"), "contribution_start_date"
  end

  test "moving back to edit an earlier stage, and progress following the data" do
    complete_all
    show
    assert_equal "review", body.dig("progress", "current_stage")
    assert body.dig("progress", "ready_to_submit")

    save_stage("employment", { department: "Internal Audit", office_location: "" })
    assert_response :ok
    assert_equal "Internal Audit", saved.department
    assert_nil saved.office_location
    assert_equal "employment", body.dig("progress", "current_stage")
  end

  test "values are normalised and invalid ones are rejected without saving anything" do
    start
    save_stage("personal", STAGES["personal"])
    assert_equal "+2348031234567", saved.primary_phone
    assert_nil saved.secondary_phone

    {
      "employment" => [ { sap_staff_id: "BUA 1" }, { business_unit: "x" * 121 }, { department: "Fin\u0000ance" }, { department: 7 },
                        { department: true } ],
      "personal" => [ { primary_phone: "12345" }, { date_of_birth: "12/04/1988" }, { date_of_birth: "2999-01-01" },
                      { sex: "x" * 31 }, { marital_status: "x" * 31 }, { nationality: "x" * 61 } ],
      "savings" => [ { monthly_contribution_kobo: 2_999_999 }, { monthly_contribution_kobo: 3_000_000.5 },
                     { monthly_contribution_kobo: "lots" }, { monthly_contribution_kobo: 2**63 },
                     { monthly_contribution_kobo: "9" * 25 }, { contribution_start_date: "2027-01-02" } ]
    }.each do |stage, attempts|
      attempts.each do |attributes|
        assert_no_changes -> { saved.attributes } do
          save_stage(stage, attributes)
        end
        assert_response :unprocessable_content, attributes.inspect
        assert_equal attributes.keys.map(&:to_s), body["errors"].keys, attributes.inspect
      end
    end
  end

  test "dropdown fields accept any well-formed string within their limits" do
    start
    save_stage("employment", { business_unit: "BUA Foods — Sugar (Lafiaji)" })
    save_stage("personal", { sex: "Prefer not to say", marital_status: "Civil partnership" })
    assert_response :ok
    assert_equal [ "BUA Foods — Sugar (Lafiaji)", "Prefer not to say", "Civil partnership" ],
      [ saved.business_unit, saved.sex, saved.marital_status ]
  end

  test "only the stage's own fields are written; ids, statuses and other stages are ignored" do
    start
    other = User.create!(full_name: "Ben Obi", email: "ben@example.com", password: PASSWORD)

    save_stage("employment", { department: "Finance", user_id: other.id, id: 999, submitted_at: Time.current.iso8601,
      declaration_accepted_at: Time.current.iso8601, membership_status: "approved", sap_id: "S1", email: "x@example.com",
      full_name: "Mallory", lock_version: 42, primary_phone: "+2348031234567" })
    assert_response :ok

    application = saved
    assert_equal [ "Finance", @user.id, nil, nil, nil, 1 ],
      [ application.department, application.user_id, application.submitted_at, application.declaration_accepted_at,
        application.primary_phone, application.lock_version ]
    @user.reload
    assert_equal [ "not_started", nil, "ada@example.com", "Ada Obi" ], [ @user.membership_status, @user.sap_id, @user.email, @user.full_name ]

    save_stage("declaration", { declaration_version: "draft-v1" })
    assert_response :not_found
  end

  test "an applicant only ever reaches their own application and photo" do
    complete_all
    sign_up_and_in("ben@example.com")

    show
    assert_response :not_found
    get PHOTO
    assert_response :not_found
    start
    assert_response :created
    assert_nil body.dig("application", "sap_staff_id")
    assert_nil body.dig("application", "passport_photo")
  end

  test "a save with an old lock_version gets 409 and never overwrites newer data" do
    start
    save_stage("employment", { department: "Finance" }, lock_version: 0)
    assert_response :ok

    save_stage("employment", { department: "Stale tab" }, lock_version: 0)
    assert_response :conflict
    assert_equal "stale", body["error"]
    assert_equal "Finance", body.dig("application", "department")
    assert_equal "Finance", saved.department

    stale = version
    save_stage("employment", { department: "Audit" })
    put_photo(upload(PNG), lock_version: stale)
    assert_response :conflict
    assert_not saved.passport_photo.attached?

    save_stage("employment", { department: "Finance" }, lock_version: nil)
    assert_response :unprocessable_content
    assert_equal({ "lock_version" => [ "is required" ] }, body["errors"])
  end

  test "saving unchanged values writes nothing" do
    start
    save_stage("employment", STAGES["employment"])
    before = saved.attributes.slice("lock_version", "updated_at")

    save_stage("employment", STAGES["employment"])
    assert_response :ok
    assert_equal before, saved.attributes.slice("lock_version", "updated_at")
  end

  test "photos: JPG and PNG checked by content, at most 2 MB; served only to the owner, privately" do
    start
    put_photo(upload(JPEG, "image/jpeg", "me.jpg"))
    assert_response :ok
    assert_equal({ "content_type" => "image/jpeg", "byte_size" => JPEG.bytesize, "checksum" => saved.passport_photo.blob.checksum },
      body.dig("application", "passport_photo"))

    get PHOTO
    assert_response :ok
    assert_equal JPEG, response.body.b
    assert_equal "image/jpeg", response.media_type
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal "nosniff", response.headers["X-Content-Type-Options"]
    assert_equal @user.id.to_s, response.headers["X-Applicant-Id"]
  end

  test "a photo upload or replacement returns the final lock_version: saves with it succeed, saves with the old one get 409" do
    start
    save_stage("personal", { sex: "Female" })

    [ [ upload(PNG), "image/png" ], [ upload(JPEG, "image/jpeg", "me.jpg"), "image/jpeg" ] ].each do |file, type|
      before_upload = version
      put_photo(file)
      assert_response :ok
      returned = body.dig("application", "lock_version")

      # No analysis job may touch the row after the response; the replaced photo's purge still runs.
      assert_enqueued_jobs 0, only: ActiveStorage::AnalyzeJob
      perform_enqueued_jobs
      assert_equal returned, version, "nothing after the response may move lock_version"
      assert_equal type, saved.passport_photo.blob.content_type
      assert_equal 1, ActiveStorage::Blob.count, "a replaced photo is purged"

      save_stage("personal", { sex: "Male" }, lock_version: before_upload)
      assert_response :conflict
      assert_equal "stale", body["error"]
      assert_equal "Female", saved.sex

      save_stage("personal", { marital_status: "Married" }, lock_version: returned)
      assert_response :ok
    end
  end

  test "an invalid replacement keeps the previous photo; a valid one replaces and purges it" do
    start
    put_photo(upload(PNG))
    original = saved.passport_photo.blob

    [ upload("GIF89a#{"\0" * 32}", "image/png", "me.png"), upload("hello", "image/jpeg", "me.jpg"),
      upload(PNG + ("\0".b * (2.megabytes - PNG.bytesize + 1)), "image/png", "big.png") ].each do |file|
      assert_no_difference("ActiveStorage::Blob.count") { put_photo(file) }
      assert_response :unprocessable_content
      assert_equal original, saved.passport_photo.blob
    end
    put PHOTO, params: { lock_version: version }, headers: @headers
    assert_response :unprocessable_content

    perform_enqueued_jobs do
      put_photo(upload(JPEG, "image/jpeg", "new.jpg"))
    end
    assert_response :ok
    assert_equal "image/jpeg", saved.passport_photo.blob.content_type
    assert_not ActiveStorage::Blob.exists?(original.id)
  end

  test "writes are rate limited per user, not per shared office IP" do
    start
    300.times { save_stage("employment", { department: "x" }, lock_version: 0) }
    assert_response :too_many_requests

    sign_up_and_in("ben@example.com")
    start
    assert_response :created
  end

  test "Active Storage's public routes are not mounted" do
    assert_empty Rails.application.routes.routes.map { it.path.spec.to_s }.grep(%r{/rails/active_storage})
  end

  test "submitting an incomplete application lists what's missing per stage" do
    start
    save_stage("employment", STAGES["employment"])
    submit
    assert_response :unprocessable_content
    assert_empty body.dig("missing", "employment")
    assert_includes body.dig("missing", "personal"), "passport_photo"
    assert_includes body.dig("missing", "savings"), "monthly_contribution_kobo"
    assert_nil saved.submitted_at
    assert @user.reload.not_started?
  end

  test "submission needs the current declaration explicitly accepted" do
    complete_all
    [ { accepted: false }, { accepted: "true" }, { declaration_version: "v0" }, { declaration_version: nil } ].each do |attempt|
      submit(**attempt)
      assert_response :unprocessable_content, attempt.inspect
      assert_equal({ "declaration" => [ "must be accepted" ] }, body["errors"])
    end
    assert_nil saved.submitted_at
  end

  test "submission needs a contribution start of next month's 1st or later" do
    complete_all
    saved.update_columns(contribution_start_date: Date.current.beginning_of_month)
    submit
    assert_response :unprocessable_content
    assert_equal [ "contribution_start_date" ], body.dig("missing", "savings")
  end

  test "a complete application submits once, awaits approval and becomes read-only" do
    complete_all
    freeze_time do
      submit(declaration_version: "draft-v1")
      assert_response :created
      assert_equal Time.current.as_json, body.dig("application", "submitted_at")
      assert_equal Time.current.as_json, body.dig("application", "declaration_accepted_at")
    end
    assert_equal "draft-v1", body.dig("application", "declaration_version")
    assert_equal "awaiting_approval", body.dig("applicant", "membership_status")
    assert_nil body["progress"]

    get "/api/v1/auth/me", as: :json
    assert_equal "awaiting_approval", body.dig("user", "membership_status")

    [ -> { submit }, -> { save_stage("employment", { department: "Audit" }) }, -> { put_photo(upload(PNG)) } ].each do |request|
      request.call
      assert_response :conflict
      assert_equal "already_submitted", body["error"]
    end
    assert_equal "Finance", saved.department
    show
    assert_response :ok
    get PHOTO
    assert_response :ok
  end

  test "production refuses submission until an approved declaration is configured" do
    complete_all
    Rails.configuration.x.membership_declaration_version = nil
    submit
    assert_response :service_unavailable
    assert_equal({ "error" => "declaration_unavailable" }, body)
    assert_nil saved.submitted_at
  ensure
    Rails.configuration.x.membership_declaration_version = "draft-v1"
  end

  test "every write must name the signed-in applicant; any other id, or none, is refused before anything is written" do
    start
    save_stage("employment", { department: "Finance" })
    [ @headers.merge("X-Applicant-Id" => (@user.id + 1).to_s), @headers.except("X-Applicant-Id") ].each do |headers|
      [ -> { start(headers:) }, -> { save_stage("employment", { department: "Other" }, headers:) },
        -> { put_photo(upload(PNG), headers:) }, -> { submit(headers:) } ].each do |request|
        assert_no_changes -> { saved.attributes } do
          request.call
        end
        assert_response :conflict
        assert_equal({ "error" => "identity_mismatch" }, body)
      end
    end
    assert_not saved.passport_photo.attached?
  end

  test "a save from a tab still showing A, after B signed in elsewhere, never lands in B's application" do
    a_id = @user.id
    start
    a_version = version
    ben = sign_up_and_in("ben@example.com") # the shared browser session now belongs to Ben
    start
    assert_equal a_version, MembershipApplication.find_by!(user: ben).lock_version, "same version: only the id can tell them apart"

    save_stage("next_of_kin", { next_of_kin_name: "A's next of kin" }, lock_version: a_version,
      headers: @headers.merge("X-Applicant-Id" => a_id.to_s))
    assert_response :conflict
    assert_equal "identity_mismatch", body["error"]
    assert_nil MembershipApplication.find_by!(user: ben).next_of_kin_name
  end

  test "unsafe requests need a valid CSRF token and our Origin" do
    start
    bad = [ @headers.except("X-CSRF-Token"), @headers.merge("X-CSRF-Token" => SecureRandom.base64(32)),
            @headers.merge("Origin" => "https://evil.example"), @headers.except("Origin") ]
    bad.each do |headers|
      [ -> { start(headers:) }, -> { save_stage("employment", { department: "x" }, headers:) },
        -> { put_photo(upload(PNG), headers:) }, -> { submit(headers:) } ].each do |request|
        request.call
        assert_response :forbidden
      end
    end
    assert_nil saved.department
  end

  test "personal details never reach the log" do
    log = capture_log do
      start
      STAGES.each { |stage, attributes| save_stage(stage, attributes) }
      put_photo(upload(PNG))
    end

    assert_includes log, "Api::V1::Membership::ApplicationsController#update_stage"
    [ "BUA-10234", "Sokoto", "8031234567", "1988-04-12", "Marina", "Chidi", "Nigerian", "Married", "3000000" ].each do |value|
      assert_not_includes log, value
    end
  end
end
