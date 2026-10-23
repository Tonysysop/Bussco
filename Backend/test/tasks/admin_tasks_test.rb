require "test_helper"
require "rake"

# lib/tasks/admin.rake: operator provisioning wrappers around User's role methods.
class AdminTasksTest < ActiveSupport::TestCase
  setup { Rails.application.load_tasks unless Rake::Task.task_defined?("admin:grant") }

  def user(email, **attrs)
    User.create!(full_name: "Some One", email:, password: "correct horse battery", email_verified_at: Time.current, **attrs)
  end

  # Runs a task with these ENV values and stdin; returns [stdout + stderr, aborted?].
  def run_task(name, env, input: "")
    saved = env.keys.index_with { ENV[it] }
    env.each { |key, value| ENV[key] = value }
    $stdin = StringIO.new(input)
    aborted = false
    out, err = capture_io do
      Rake::Task[name].reenable
      Rake::Task[name].invoke
    rescue SystemExit => e
      aborted = true
      warn e.message
    end
    [ out + err, aborted ]
  ensure
    $stdin = STDIN
    saved.each { |key, value| ENV[key] = value }
  end

  test "bootstrap needs the operator to retype the email, then provisions and audits the first Super Admin" do
    target = user("sam@example.com")
    env = { "EMAIL" => "Sam@Example.com", "OPERATOR" => "Jane Ops" }

    output, aborted = run_task("admin:bootstrap", env, input: "someone@else.com\n")
    assert aborted
    assert_match(/did not match; nothing changed/, output)
    assert_nil target.reload.admin_role

    output, aborted = run_task("admin:bootstrap", env, input: "sam@example.com\n")
    assert_not aborted, output
    assert target.reload.super_admin?
    assert_equal [ [ "bootstrap", "Jane Ops" ] ], AdminRoleChange.pluck(:action, :changed_by)

    output, aborted = run_task("admin:bootstrap", env.merge("EMAIL" => user("x@example.com").email), input: "x@example.com\n")
    assert aborted
    assert_match(/already provisioned/, output)
  end

  test "bootstrap aborts without OPERATOR, for unknown, unverified or disabled accounts, and after a disabled Super Admin" do
    assert run_task("admin:bootstrap", { "EMAIL" => user("a@example.com").email, "OPERATOR" => " " }).last
    assert run_task("admin:bootstrap", { "EMAIL" => "nobody@example.com", "OPERATOR" => "Ops" }).last

    output, aborted = run_task("admin:bootstrap", { "EMAIL" => user("u@example.com", email_verified_at: nil).email, "OPERATOR" => "Ops" },
      input: "u@example.com\n")
    assert aborted
    assert_match(/Email verified at can't be blank/, output)

    disabled = user("d@example.com")
    disabled.update_columns(account_status: "disabled")
    assert run_task("admin:bootstrap", { "EMAIL" => disabled.email, "OPERATOR" => "Ops" }, input: "d@example.com\n").last

    user("old@example.com", admin_role: "super_admin").update_columns(account_status: "disabled")
    output, aborted = run_task("admin:bootstrap", { "EMAIL" => "a@example.com", "OPERATOR" => "Ops" }, input: "a@example.com\n")
    assert aborted
    assert_match(/already provisioned; use admin:replace_super_admin/, output)
    assert_equal 0, AdminRoleChange.count
  end

  test "grant and revoke manage president and treasurer only, idempotently and audited" do
    target = user("tia@example.com")
    env = { "EMAIL" => target.email, "OPERATOR" => "Ops" }

    assert_not run_task("admin:grant", env.merge("ROLE" => "treasurer")).last
    assert target.reload.treasurer?
    output, = run_task("admin:grant", env.merge("ROLE" => "treasurer"))
    assert_match(/already treasurer; nothing changed/, output)
    assert run_task("admin:grant", env.merge("ROLE" => "super_admin")).last
    assert run_task("admin:grant", env.merge("ROLE" => "owner")).last
    assert target.reload.treasurer?

    assert_not run_task("admin:revoke", env).last
    assert_nil target.reload.admin_role
    assert_equal [ %w[grant treasurer], [ "revoke", nil ] ], AdminRoleChange.order(:id).pluck(:action, :new_role)
  end

  test "grant and revoke refuse to touch a Super Admin" do
    sam = user("sam@example.com", admin_role: "super_admin")
    user("sue@example.com", admin_role: "super_admin") # not the last one, so only the task's own rule refuses

    assert_match(/use admin:replace_super_admin/, run_task("admin:revoke", { "EMAIL" => sam.email, "OPERATOR" => "Ops" }).first)
    assert run_task("admin:grant", { "EMAIL" => sam.email, "ROLE" => "president", "OPERATOR" => "Ops" }).last
    assert sam.reload.super_admin?
  end

  test "replace_super_admin recovers from a disabled Super Admin after confirmation" do
    lost = user("lost@example.com", admin_role: "super_admin")
    lost.update_columns(account_status: "disabled")
    target = user("new@example.com")
    env = { "FROM" => lost.email, "TO" => target.email, "OPERATOR" => "Ops" }

    assert run_task("admin:replace_super_admin", env, input: "lost@example.com\n").last # confirms TO, not FROM
    assert_nil target.reload.admin_role

    output, aborted = run_task("admin:replace_super_admin", env, input: "new@example.com\n")
    assert_not aborted, output
    assert target.reload.super_admin?
    assert_nil lost.reload.admin_role
    assert_equal %w[emergency_replace emergency_replace], AdminRoleChange.pluck(:action)
  end
end
