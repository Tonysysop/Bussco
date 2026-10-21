require "test_helper"

# Genuine concurrency, like email_verification_race_test.rb: threads on independent connections
# hit one user's row at once, so this runs outside a test transaction.
class PasswordResetRaceTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery")
    @code = @user.issue_password_reset_code(@user.request_password_reset)
  end

  teardown { User.delete_all }

  test "a code submitted concurrently verifies exactly once" do
    tokens = concurrently(4) { |user| user.verify_password_reset_code(@code) }

    assert_equal 1, tokens.compact.size, tokens.inspect
    assert_nil @user.reload.password_reset_code_digest
  end

  test "concurrent wrong guesses can't exceed five attempts" do
    wrong = format("%06d", (@code.to_i + 1) % 1_000_000)
    concurrently(10) { |user| user.verify_password_reset_code(wrong) }

    assert_equal 5, @user.reload.password_reset_attempts
    assert_nil @user.verify_password_reset_code(@code)
  end

  test "one reset authorization used concurrently changes the password exactly once" do
    token = @user.verify_password_reset_code(@code)
    @user.sessions.create!(token_digest: "x", last_seen_at: Time.current)
    passwords = Array.new(4) { "new passphrase number #{it}" }
    results = concurrently(4) { |_user, i| User.reset_password(token, passwords[i]) }

    winners = results.each_index.select { results[it]&.errors&.none? }
    assert_equal 1, winners.size, results.inspect
    assert @user.reload.authenticate(passwords[winners.first])
    assert_equal 0, @user.sessions.count
  end

  test "concurrent reset requests start exactly one new generation" do
    travel 61.seconds
    generations = concurrently(4) { |user| user.request_password_reset }

    assert_equal 1, generations.compact.size, generations.inspect
  end

  private

  def concurrently(threads)
    start = Queue.new
    results = Array.new(threads) do |i|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          user = User.find(@user.id)
          start.pop
          yield user, i
        end
      end
    end
    threads.times { start << :go }
    results.map(&:value)
  end
end
