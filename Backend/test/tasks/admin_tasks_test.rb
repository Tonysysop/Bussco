require "test_helper"
require "rake"

# lib/tasks/admin.rake: operator provisioning wrappers around User's admin methods.
class AdminTasksTest < ActiveSupport::TestCase
  setup { Rails.application.load_tasks unless Rake::Task.task_defined?("admin:grant") }

  def user(email, **attrs)
    User.create!(full_name: "Some One", email:, password: "correct horse battery", email_verified_at: Time.current, **attrs)
  end

  # Runs a task with these ENV values and stdin; returns [stdout + stderr, aborted?]. `tty:` makes the
  # captured stdout claim to be a terminal, as an operator's shell is.
  def run_task(name, env, input: "", tty: true)
    saved = env.keys.index_with { ENV[it] }
    env.each { |key, value| ENV[key] = value }
    $stdin = StringIO.new(input)
    aborted = false
    out, err = capture_io do
      $stdout.define_singleton_method(:tty?) { tty }
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

  PROVISION = { "EMAIL" => "Root@Example.com", "NAME" => "System Admin", "OPERATOR" => "Jane Ops" }.freeze

  test "provision_super_admin creates the system identity after confirmation and shows the password once" do
    output, aborted = run_task("admin:provision_super_admin", PROVISION, input: "someone@else.com\n")
    assert aborted
    assert_match(/did not match; nothing changed/, output)
    assert_nil User.system_account

    log = capture_log { output, aborted = run_task("admin:provision_super_admin", PROVISION, input: "root@example.com\n") }
    assert_not aborted, output
    root = User.system_account
    password = output[/^\s{4}(\S{24})$/, 1]
    assert root.authenticate(password)
    assert root.must_change_password?
    assert_equal 1, output.scan(password).size
    assert_not_includes log, password
    assert_equal [ [ "provision", "Jane Ops" ] ], AdminRoleChange.pluck(:action, :changed_by)

    output, aborted = run_task("admin:provision_super_admin", PROVISION.merge("EMAIL" => "two@example.com"), input: "two@example.com\n")
    assert aborted
    assert_match(/already provisioned; use admin:recover_super_admin/, output)
  end

  test "provision_super_admin refuses without a terminal, OPERATOR, EMAIL/NAME or with a taken email" do
    assert_match(/interactive terminal/, run_task("admin:provision_super_admin", PROVISION, tty: false).first)
    assert run_task("admin:provision_super_admin", PROVISION.merge("OPERATOR" => " ")).last
    assert run_task("admin:provision_super_admin", PROVISION.merge("NAME" => "")).last

    member = user("taken@example.com")
    output, aborted = run_task("admin:provision_super_admin", PROVISION.merge("EMAIL" => member.email), input: "taken@example.com\n")
    assert aborted
    assert_match(/Email has already been taken/, output)
    assert_nil User.system_account
    assert member.reload.member?
  end

  test "recover_super_admin reissues the same identity's password, optionally re-pointed, audited" do
    root, = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    env = { "OPERATOR" => "Jane Ops", "REASON" => "Lost device" }

    assert_match(/Set REASON/, run_task("admin:recover_super_admin", env.except("REASON").merge("REASON" => "")).first)
    assert_match(/interactive terminal/, run_task("admin:recover_super_admin", env, tty: false).first)

    output, aborted = run_task("admin:recover_super_admin", env.merge("NEW_EMAIL" => "next@example.com", "NEW_NAME" => "Next Admin"),
      input: "next@example.com\n")
    assert_not aborted, output
    recovered = User.system_account
    assert_equal [ root.id, "next@example.com" ], [ recovered.id, recovered.email ]
    assert recovered.authenticate(output[/^\s{4}(\S{24})$/, 1])
    assert_equal "Lost device; email root@example.com → next@example.com", AdminRoleChange.order(:id).last.note
    assert_equal 1, User.where(account_type: "system").count
  end

  test "recover_super_admin needs a provisioned identity" do
    output, aborted = run_task("admin:recover_super_admin", { "OPERATOR" => "Ops", "REASON" => "x" })
    assert aborted
    assert_match(/No Super Admin is provisioned yet/, output)
  end

  test "grant and revoke manage president and treasurer on member accounts only, idempotently and audited" do
    target = user("tia@example.com")
    env = { "EMAIL" => target.email, "OPERATOR" => "Ops" }

    assert_not run_task("admin:grant", env.merge("ROLE" => "treasurer")).last
    assert target.reload.treasurer?
    assert_match(/already treasurer; nothing changed/, run_task("admin:grant", env.merge("ROLE" => "treasurer")).first)
    assert run_task("admin:grant", env.merge("ROLE" => "super_admin")).last
    assert run_task("admin:grant", env.merge("ROLE" => "owner")).last
    assert target.reload.treasurer?

    assert_not run_task("admin:revoke", env).last
    assert_nil target.reload.admin_role
    assert_equal [ %w[grant treasurer], [ "revoke", nil ] ], AdminRoleChange.order(:id).pluck(:action, :new_role)
  end

  test "grant and revoke can't touch the Super Admin" do
    root, = User.provision_super_admin!(email: "root@example.com", full_name: "System Admin", by: "Ops")
    assert_match(/belongs only to the system account/, run_task("admin:revoke", { "EMAIL" => root.email, "OPERATOR" => "Ops" }).first)
    assert run_task("admin:grant", { "EMAIL" => root.email, "ROLE" => "president", "OPERATOR" => "Ops" }).last
    assert root.reload.super_admin?
  end
end
