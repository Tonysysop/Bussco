require "test_helper"

# Genuine concurrency (non-deterministic interleaving) on independent connections, so rows are
# committed (no test transaction).
class SessionRaceTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  PASSWORD = "correct horse battery".freeze

  teardown do
    User.delete_all # sessions go with it (ON DELETE CASCADE)
    SolidCache::Entry.delete_all # rate-limit counters committed by the requests
  end

  test "the registering browser submitting its code concurrently gets exactly one session" do
    headers = browser_headers
    post "/api/v1/auth/registrations", headers:, as: :json,
      params: { user: { full_name: "Ada Obi", email: "ada@example.com", password: PASSWORD } }
    user = User.find_by!(email: "ada@example.com")
    code = user.issue_email_verification_code(user.email_verification_generation)
    browser_cookie = cookies["_bussco_session"]

    # Four tabs of the same browser: same cookie, same CSRF token, parallel requests.
    tabs = Array.new(4) { open_session.tap { it.cookies["_bussco_session"] = browser_cookie } }
    statuses = concurrently(tabs) do |tab|
      tab.patch "/api/v1/auth/email_verification", params: { email: user.email, code: }, headers:, as: :json
      [ tab.response.status, tab.response.parsed_body.key?("csrf_token") ]
    end

    assert_equal [ [ 200, true ], [ 422, false ], [ 422, false ], [ 422, false ] ], statuses.sort
    assert_equal 1, Session.where(user:).count
  end

  test "concurrent requests move last_seen_at forward once and never revive an expired session" do
    user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: PASSWORD, email_verified_at: Time.current)
    session = Session.create!(user:, token_digest: Session.digest("t"), last_seen_at: 2.minutes.ago)

    assert_equal 1, concurrently(Array.new(4) { session }) { it.touch_last_seen }.sum
    assert_in_delta Time.current, session.reload.last_seen_at, 5

    session.update_columns(last_seen_at: (Session::IDLE_TIMEOUT + 1.second).ago)
    assert_equal [ nil ] * 4, concurrently(Array.new(4) { "t" }) { Session.resume(it) }
    assert_not Session.exists?(session.id)
  end

  private

  def concurrently(items)
    start = Queue.new
    threads = items.map do |item|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          start.pop
          yield item
        end
      end
    end
    items.size.times { start << :go }
    threads.map(&:value)
  end
end
