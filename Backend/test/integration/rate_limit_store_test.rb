require "test_helper"
require "open3"

# The registration rate-limit store (Solid Cache in test and production). Counters are
# committed, so this runs outside a test transaction and cleans up after itself.
class RateLimitStoreTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  STORE = Api::V1::BaseController::RATE_LIMIT_STORE

  teardown { SolidCache::Entry.delete_all }

  test "is Solid Cache on the primary database connection" do
    assert_instance_of SolidCache::Store, STORE
    assert_equal "primary", SolidCache::Entry.connection_db_config.name
    assert_equal ActiveRecord::Base.connection_db_config.database, SolidCache::Entry.connection_db_config.database
  end

  test "separate store instances share one counter, so state lives in the database" do
    other_store = ActiveSupport::Cache.lookup_store(:solid_cache_store)
    key = "rate-limit-test:#{SecureRandom.hex(4)}"

    assert_equal 1, STORE.increment(key, 1, expires_in: 1.minute)
    assert_equal 2, other_store.increment(key, 1, expires_in: 1.minute)
    assert_equal 1, SolidCache::Entry.count
  end

  test "a separate OS process sees and adds to the same counter" do
    key = "rate-limit-test:#{SecureRandom.hex(4)}"
    STORE.increment(key, 1, expires_in: 1.minute)

    # Same database as this (possibly parallel) worker; the child process commits 3 increments.
    script = <<~RUBY
      ActiveRecord::Base.establish_connection(
        ActiveRecord::Base.connection_db_config.configuration_hash.merge(database: ENV.fetch("RATE_LIMIT_TEST_DB")))
      store = ActiveSupport::Cache.lookup_store(:solid_cache_store)
      3.times { store.increment(ENV.fetch("RATE_LIMIT_TEST_KEY"), 1, expires_in: 60) }
    RUBY
    env = { "RAILS_ENV" => "test", "RATE_LIMIT_TEST_DB" => ActiveRecord::Base.connection_db_config.database,
            "RATE_LIMIT_TEST_KEY" => key }
    _out, err, status = Open3.capture3(env, RbConfig.ruby, "bin/rails", "runner", script, chdir: Rails.root.to_s)
    assert status.success?, err

    assert_equal 5, STORE.increment(key, 1, expires_in: 1.minute)
  end
end
