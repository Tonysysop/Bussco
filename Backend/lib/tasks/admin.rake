# Operator-only admin provisioning (docs/auth/admin-access.md). Every change is audited in
# admin_role_changes with OPERATOR as changed_by.
# - The Super Admin is the single system identity: created once by provision_super_admin, recovered (never
#   replaced or duplicated) by recover_super_admin. Its temporary password is generated here and shown once,
#   only on an interactive terminal; it is never typed, logged, emailed or stored in plain text.
# - President and Treasurer are member accounts that registered themselves; grant/revoke only attach a role.
namespace :admin do
  operator = -> { ENV["OPERATOR"].to_s.strip.presence || abort("Set OPERATOR to your name; it is recorded in the audit.") }
  find = ->(var) { User.find_by(email: ENV[var].to_s.strip.downcase) || abort("No account with #{var}=#{ENV[var]}.") }

  # Retyped on stdin, so the confirmation never lands in shell history.
  confirm = lambda do |email, summary|
    puts summary
    print "Retype this email address to confirm: "
    abort "Confirmation did not match; nothing changed." unless $stdin.gets.to_s.strip.downcase == email.to_s.strip.downcase
  end

  # The temporary password goes to this terminal only: refuse when output is captured (CI, a file, a pipe).
  terminal = lambda do
    abort "Run this in an interactive terminal: the temporary password is shown only there." unless $stdout.tty?
  end

  show_password = lambda do |user, password|
    puts <<~TEXT

      Temporary password for #{user.email} (shown once; valid until #{user.temporary_password_expires_at.utc.iso8601}):

          #{password}

      Hand it over in person or by phone, never by email or chat. Sign-in at /admin/login then requires
      a new password before anything else.
    TEXT
  end

  apply = lambda do |&change|
    change.call
  rescue User::ProvisioningError, ActiveRecord::RecordInvalid, ActiveRecord::RecordNotSaved => e
    reason = e.respond_to?(:record) && e.record&.errors&.full_messages&.to_sentence.presence
    abort "Nothing changed: #{reason || e.message}."
  end

  desc "Once: create the Super Admin system identity (EMAIL=… NAME=… OPERATOR=…)"
  task provision_super_admin: :environment do
    terminal.()
    email, name, by = ENV["EMAIL"].to_s.strip, ENV["NAME"].to_s.strip, operator.()
    abort "Set EMAIL and NAME for the designated Super Admin." if email.empty? || name.empty?
    abort "The Super Admin is already provisioned; use admin:recover_super_admin." if User.system_account
    confirm.(email, "Create the Super Admin system identity for #{name} <#{email}>.")
    user, password = apply.() { User.provision_super_admin!(email:, full_name: name, by:) }
    show_password.(user, password)
  end

  desc "Emergency: new temporary password for the Super Admin, optionally re-pointed (OPERATOR=… REASON=… [NEW_EMAIL=… NEW_NAME=…])"
  task recover_super_admin: :environment do
    terminal.()
    by, reason = operator.(), ENV["REASON"].to_s.strip.presence || abort("Set REASON; it is recorded in the audit.")
    user = User.system_account || abort("No Super Admin is provisioned yet; use admin:provision_super_admin.")
    email = ENV["NEW_EMAIL"].to_s.strip.presence
    confirm.(email || user.email, "Recover the Super Admin #{user.full_name} <#{user.email}> (#{user.account_status})" \
      "#{" and re-point it to #{email}" if email}. Every session ends.")
    user, password = apply.() do
      User.recover_super_admin!(by:, reason:, email:, full_name: ENV["NEW_NAME"].to_s.strip.presence)
    end
    show_password.(user, password)
  end

  desc "Grant president or treasurer to a member account (EMAIL=… ROLE=… OPERATOR=…)"
  task grant: :environment do
    role = ENV["ROLE"].to_s
    abort "ROLE must be president or treasurer; the Super Admin is the system account (admin:provision_super_admin)." unless role.in?(%w[president treasurer])
    user, by = find.("EMAIL"), operator.()
    changed = apply.() { user.change_admin_role!(role, by:, action: :grant) }
    puts changed ? "#{user.email} is now #{role}." : "#{user.email} is already #{role}; nothing changed."
  end

  desc "Revoke a president or treasurer role (EMAIL=… OPERATOR=…)"
  task revoke: :environment do
    user, by = find.("EMAIL"), operator.()
    changed = apply.() { user.change_admin_role!(nil, by:, action: :revoke) }
    puts changed ? "#{user.email} no longer has an admin role." : "#{user.email} has no admin role; nothing changed."
  end
end
