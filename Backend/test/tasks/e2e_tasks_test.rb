require "test_helper"
require "rake"

class E2eTasksTest < ActiveSupport::TestCase
  setup { Rails.application.load_tasks unless Rake::Task.task_defined?("e2e:reset") }

  test "e2e:reset refuses any environment or database other than e2e and bussco_e2e, deleting nothing" do
    user = User.create!(full_name: "Kept", email: "kept@example.com", password: "correct horse battery")
    aborted = false
    _, err = capture_io do
      Rake::Task["e2e:reset"].reenable
      Rake::Task["e2e:reset"].invoke
    rescue SystemExit => e
      aborted = true
      warn e.message
    end

    assert aborted
    assert_match(/refused.*got test, bussco_test/, err)
    assert User.exists?(user.id)
  end
end
