require "test_helper"

# Genuine concurrency (non-deterministic interleaving): threads on independent connections hit
# one user's verification row at once. Rows must be committed to be seen across connections,
# so this runs outside a test transaction.
class EmailVerificationRaceTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @user = User.create!(full_name: "Ada Obi", email: "ada@example.com", password: "correct horse battery")
    @code = @user.issue_email_verification_code(@user.request_email_verification)
  end

  teardown { User.delete_all }

  test "a code submitted concurrently verifies exactly once" do
    outcomes = concurrently(4) { |user| user.verify_email_code(@code) }

    assert_equal [ true, false, false, false ], outcomes.sort_by { it ? 0 : 1 }
    assert @user.reload.email_verified_at?
  end

  test "concurrent wrong guesses can't exceed five attempts" do
    wrong = format("%06d", (@code.to_i + 1) % 1_000_000)
    concurrently(10) { |user| user.verify_email_code(wrong) }

    assert_equal 5, @user.reload.email_verification_attempts
    assert_not @user.verify_email_code(@code)
  end

  test "concurrent resend requests start exactly one new generation" do
    travel 61.seconds
    generations = concurrently(4) { |user| user.request_email_verification }

    assert_equal 1, generations.compact.size, generations.inspect
    assert_equal generations.compact.first, @user.reload.email_verification_generation
    assert_nil @user.email_verification_code_digest, "the previous code is invalidated"
  end

  private

  def concurrently(threads)
    start = Queue.new
    results = Array.new(threads) do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          user = User.find(@user.id)
          start.pop
          yield user
        end
      end
    end
    threads.times { start << :go }
    results.map(&:value)
  end
end
