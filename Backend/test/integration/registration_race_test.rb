require "test_helper"

# Duplicate-email races. Both tests commit real rows (no test transaction), because a
# conflicting row has to be committed by another connection to collide with the insert.
class RegistrationRaceTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  PASSWORD = "correct horse battery".freeze

  teardown do
    User.delete_all
    SolidCache::Entry.delete_all # rate-limit counters committed by the request
  end

  # SIMULATED race (deterministic): another connection commits the same email after this
  # request's uniqueness validation passed and before its INSERT. Exercises the controller's
  # RecordNotUnique handling every time.
  test "simulated: a row committed between validation and insert gives the same 422" do
    competing_insert = ->(_user) do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          connection.execute(<<~SQL)
            INSERT INTO users (full_name, email, password_digest, created_at, updated_at)
            VALUES ('Racer', 'ada@example.com', 'racer-digest', now(), now())
          SQL
        end
      end.join
    end
    User.set_callback(:validation, :after, competing_insert)

    post "/api/v1/auth/registrations", headers: browser_headers, as: :json,
      params: { user: { full_name: "Ada Obi", email: "ada@example.com", password: PASSWORD } }

    assert_response :unprocessable_content
    assert_equal({ "email" => [ "has already been taken" ] }, response.parsed_body["errors"])
    assert_equal [ "racer-digest" ], User.where(email: "ada@example.com").pluck(:password_digest)
  ensure
    User.skip_callback(:validation, :after, competing_insert)
  end

  # GENUINE concurrency (non-deterministic interleaving): threads on independent connections
  # create the same email at once. Whatever the interleaving, the database must keep exactly
  # one row, and every loser must fail cleanly (validation error or unique violation).
  test "genuine: concurrent creates of one email leave exactly one row" do
    threads = 4
    start = Queue.new
    results = Array.new(threads) do |i|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          start.pop
          user = User.new(full_name: "Racer #{i}", email: "ada@example.com", password: PASSWORD)
          user.save ? :created : user.errors.of_kind?(:email, :taken) && :taken
        rescue ActiveRecord::RecordNotUnique
          :not_unique
        end
      end
    end
    threads.times { start << :go }
    outcomes = results.map(&:value)

    assert_equal 1, User.where(email: "ada@example.com").count
    assert_equal 1, outcomes.count(:created), outcomes.inspect
    assert_empty outcomes - [ :created, :taken, :not_unique ], outcomes.inspect
  end
end
