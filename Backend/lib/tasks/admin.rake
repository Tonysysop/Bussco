# Operator-only admin provisioning (docs/auth/admin-access.md). No password passes through here:
# each admin registers and verifies their own account first, and these tasks only attach a role.
# Every change is audited in admin_role_changes with OPERATOR as changed_by.
namespace :admin do
  operator = -> { ENV["OPERATOR"].to_s.strip.presence || abort("Set OPERATOR to your name; it is recorded in the audit.") }
  find = ->(var) { User.find_by(email: ENV[var].to_s.strip.downcase) || abort("No account with #{var}=#{ENV[var]}.") }

  # Retyped on stdin, so the confirmation never lands in shell history.
  confirm = lambda do |user|
    puts "#{user.full_name} <#{user.email}>: #{user.account_status}, email #{user.email_verified_at? ? "verified" : "not verified"}"
    print "Retype this email address to confirm: "
    abort "Confirmation did not match; nothing changed." unless $stdin.gets.to_s.strip.downcase == user.email
  end

  apply = lambda do |&change|
    change.call
  rescue User::ProvisioningError, ActiveRecord::RecordInvalid, ActiveRecord::RecordNotSaved => e
    reason = e.respond_to?(:record) && e.record&.errors&.full_messages&.to_sentence.presence
    abort "Nothing changed: #{reason || e.message}."
  end

  desc "First-time only: make EMAIL the initial Super Admin (EMAIL=… OPERATOR=…)"
  task bootstrap: :environment do
    user, by = find.("EMAIL"), operator.()
    confirm.(user)
    apply.() { User.bootstrap_super_admin!(user, by:) }
    puts "#{user.email} is now the Super Admin."
  end

  desc "Interim, until the Super Admin portal: grant president or treasurer (EMAIL=… ROLE=… OPERATOR=…)"
  task grant: :environment do
    role = ENV["ROLE"].to_s
    abort "ROLE must be president or treasurer; Super Admins use admin:bootstrap or admin:replace_super_admin." unless role.in?(%w[president treasurer])
    user, by = find.("EMAIL"), operator.()
    abort "#{user.email} is a Super Admin; use admin:replace_super_admin." if user.super_admin?
    changed = apply.() { user.change_admin_role!(role, by:, action: :grant) }
    puts changed ? "#{user.email} is now #{role}." : "#{user.email} is already #{role}; nothing changed."
  end

  desc "Interim, until the Super Admin portal: revoke a president or treasurer role (EMAIL=… OPERATOR=…)"
  task revoke: :environment do
    user, by = find.("EMAIL"), operator.()
    abort "#{user.email} is a Super Admin; use admin:replace_super_admin." if user.super_admin?
    changed = apply.() { user.change_admin_role!(nil, by:, action: :revoke) }
    puts changed ? "#{user.email} no longer has an admin role." : "#{user.email} has no admin role; nothing changed."
  end

  desc "Emergency: replace Super Admin FROM (even disabled or unreachable) with TO, atomically (FROM=… TO=… OPERATOR=…)"
  task replace_super_admin: :environment do
    from, to, by = find.("FROM"), find.("TO"), operator.()
    confirm.(to)
    apply.() { User.replace_super_admin!(from, to, by:) }
    puts "#{to.email} is now a Super Admin; #{from.email} no longer is, and their admin sessions have ended."
  end
end
