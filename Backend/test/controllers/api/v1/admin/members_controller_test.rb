require "test_helper"

class Api::V1::Admin::MembersControllerTest < ActionDispatch::IntegrationTest
  PATH = "/api/v1/admin/members".freeze
  PASSWORD = "correct horse battery".freeze
  PNG = ("\x89PNG\r\n\x1A\n".b + ("\0" * 64).b).freeze

  setup do
    @root = account("root@example.com", account_type: "system", admin_role: "super_admin", full_name: "System Admin")
    @fresh = account("ada@example.com", full_name: "Ada Fresh", email_verified_at: nil)
    @drafting = account("bola@example.com", full_name: "Bola Draft")
    @drafting.create_membership_application!(sap_staff_id: "BUA-100", department: "Finance")
    @waiting = account("chi@example.com", full_name: "Chi Waiting", membership_status: "awaiting_approval",
      admin_role: "president")
    @waiting.create_membership_application!(sap_staff_id: "BUA-200")
    @disabled = account("dayo@example.com", full_name: "Dayo Off", account_status: "disabled")
    sign_in(@root)
  end

  def account(email, **attrs)
    User.create!(full_name: "Some One", email:, password: PASSWORD, email_verified_at: Time.current, **attrs)
  end

  def sign_in(user)
    post "/api/v1/admin/auth/session", params: { email: user.email, password: PASSWORD }, headers: browser_headers, as: :json
    assert_response :created
  end

  def list(**params)
    get(PATH, params:)
    response.parsed_body
  end

  def names(body) = body["members"].pluck("full_name")

  test "lists every member account newest first, never the system Super Admin, with only directory fields" do
    body = list
    assert_response :ok
    assert_equal [ "Dayo Off", "Chi Waiting", "Bola Draft", "Ada Fresh" ], names(body)
    assert_equal({ "page" => 1, "per_page" => 25, "total" => 4 }, body.slice("page", "per_page", "total"))
    assert_equal %w[account_status admin_role application email email_verified full_name id photo registered_at stage],
      body["members"].first.keys.sort
    assert_equal %w[business_unit department office_location sap_staff_id started_at submitted_at],
      body["members"].find { it["full_name"] == "Bola Draft" }["application"].keys.sort
    assert_no_match(/digest|password|token|code|phone|birth|kin|address|passport|kobo/, response.body)
  end

  test "stages come from membership status and the application; a disabled account stays separate" do
    stages = list["members"].to_h { [ it["full_name"], [ it["stage"], it["account_status"], it["email_verified"] ] ] }
    assert_equal [ "not_started", "active", false ], stages["Ada Fresh"]
    assert_equal [ "in_progress", "active", true ], stages["Bola Draft"]
    assert_equal [ "awaiting_approval", "active", true ], stages["Chi Waiting"]
    assert_equal [ "not_started", "disabled", true ], stages["Dayo Off"]

    assert_equal [ "Dayo Off", "Ada Fresh" ], names(list(stage: "not_started"))
    assert_equal [ "Bola Draft" ], names(list(stage: "in_progress"))
    assert_equal [ "Chi Waiting" ], names(list(stage: "awaiting_approval"))
    body = list(stage: "disabled")
    assert_equal [ "Dayo Off" ], names(body)
    assert_equal 1, body["total"]
  end

  test "search covers name, email and self-reported staff ID, treats % and _ literally, and the counts follow it" do
    assert_equal [ "Bola Draft" ], names(list(q: "bua-1"))
    assert_equal [ "Chi Waiting" ], names(list(q: "CHI@"))
    assert_equal [ "Ada Fresh" ], names(list(q: " fresh "))
    assert_empty list(q: "%")["members"]
    assert_empty list(q: "_")["members"]

    body = list(q: "bua", stage: "awaiting_approval")
    assert_equal [ "Chi Waiting" ], names(body)
    assert_equal({ "all" => 2, "not_started" => 0, "in_progress" => 1, "awaiting_approval" => 1, "disabled" => 0 },
      body["counts"])
  end

  test "the role filter narrows the list and the counts" do
    assert_equal [ "Chi Waiting" ], names(list(role: "president"))
    assert_empty list(role: "treasurer")["members"]
    body = list(role: "member")
    assert_equal [ "Dayo Off", "Bola Draft", "Ada Fresh" ], names(body)
    assert_equal 3, body["counts"]["all"]
    assert_equal 1, body["counts"]["disabled"]
  end

  test "pages are stable, and a page past the end is empty with accurate metadata" do
    26.times { |i| account("bulk#{i}@example.com", full_name: "Bulk #{i}") }
    first, second = list(page: 1), list(page: 2)
    assert_equal 25, first["members"].size
    assert_equal 5, second["members"].size
    assert_empty first["members"].pluck("id") & second["members"].pluck("id")
    assert_equal 30, second["total"]

    beyond = list(page: 9)
    assert_empty beyond["members"]
    assert_equal({ "page" => 9, "per_page" => 25, "total" => 30 }, beyond.slice("page", "per_page", "total"))
  end

  test "rejects unknown stages and roles, bad pages and long searches" do
    [ { stage: "approved" }, { stage: "suspended" }, { role: "super_admin" }, { role: "vice_president" },
      { page: "0" }, { page: "-1" }, { page: "two" }, { page: [ "1" ] }, { q: "x" * 101 } ].each do |params|
      get(PATH, params:)
      assert_response :unprocessable_content, params.inspect
      assert_equal "invalid_param", response.parsed_body["error"]
    end
  end

  test "a page costs the same number of queries however many members it holds" do
    list
    small = count_queries { list }
    assert_operator small, :>=, 3 # the page, its applications and the counts are all counted
    10.times { |i| with_photo(account("more#{i}@example.com")) }
    assert_equal small, count_queries { list }
  end

  test "serves a member's passport photo, never cached, and 404s without one or for the system account" do
    with_photo(@drafting)
    assert_equal [ true, false ], list(q: "bola").then { [ it["members"].first["photo"], list(q: "ada")["members"].first["photo"] ] }

    get "#{PATH}/#{@drafting.id}/photo"
    assert_response :ok
    assert_equal "image/png", response.media_type
    assert_equal PNG, response.body
    assert_equal "private, no-store", response.headers["Cache-Control"]

    [ @fresh, @waiting, @root ].each do |user|
      get "#{PATH}/#{user.id}/photo"
      assert_response :not_found
    end
    get "#{PATH}/0/photo"
    assert_response :not_found
  end

  test "President, Treasurer, member and anonymous callers are refused" do
    treasurer = account("tia@example.com", admin_role: "treasurer")
    with_photo(@drafting)
    [ @waiting, treasurer ].each do |admin|
      sign_in(admin)
      get PATH, as: :json
      assert_response :forbidden
      get "#{PATH}/#{@drafting.id}/photo"
      assert_response :forbidden
    end

    delete "/api/v1/admin/auth/session", headers: browser_headers, as: :json
    get PATH, as: :json
    assert_includes [ 401, 403 ], response.status
    post "/api/v1/auth/session", params: { email: @drafting.email, password: PASSWORD }, headers: browser_headers, as: :json
    get PATH, as: :json
    assert_includes [ 401, 403 ], response.status
    get "#{PATH}/#{@drafting.id}/photo"
    assert_includes [ 401, 403 ], response.status
  end

  test "the Super Admin may not list members with a temporary password" do
    @root.update!(must_change_password: true)
    get PATH, as: :json
    assert_response :forbidden
  end

  private

  def with_photo(user)
    application = user.membership_application || user.create_membership_application!
    application.passport_photo_file = Rack::Test::UploadedFile.new(StringIO.new(PNG), "image/png", original_filename: "me.png")
    application.save!
  end

  def count_queries(&block)
    count = 0
    counter = ->(*, payload) { count += 1 unless payload[:name].in?(%w[SCHEMA TRANSACTION]) || payload[:cached] }
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record", &block)
    count
  end
end
