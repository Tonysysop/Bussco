class User < ApplicationRecord
  # Rails' built-in 15-minute reset token is replaced by :password_reset below (docs/auth/password-recovery.md).
  has_secure_password reset_token: false

  # dependent: :delete_all also makes sessions.delete_all delete rows rather than null user_id.
  has_many :sessions, dependent: :delete_all
  # destroy (not the FK cascade) so Active Storage also purges the passport photo.
  has_one :membership_application, dependent: :destroy
  # Audit rows block deletion (FK without cascade), so privilege history can't vanish with the user.
  has_many :admin_role_changes
  # Disabling revokes every login in the same transaction; each request also re-checks status.
  before_update { sessions.delete_all if will_save_change_to_account_status?(to: "disabled") }
  # Any role change (grant, switch, revoke) ends admin sessions; the next admin login reads the new role.
  before_update { sessions.where(admin: true).delete_all if will_save_change_to_admin_role? }

  # Unicode-aware trim: String#strip is ASCII-only, but the DB check's \s also matches e.g. EM SPACE.
  normalizes :full_name, with: ->(full_name) { full_name.gsub(/\A[[:space:]]+|[[:space:]]+\z/, "") }
  normalizes :email, with: ->(email) { email.strip.downcase }

  enum :account_status, { active: "active", disabled: "disabled" }
  # Set only by server code: awaiting_approval on application submission; approval is a later increment.
  enum :membership_status, { not_started: "not_started", awaiting_approval: "awaiting_approval" }
  # Set only by change_admin_role! (docs/auth/admin-access.md); no request param ever reaches it.
  enum :admin_role, { super_admin: "super_admin", president: "president", treasurer: "treasurer" },
    validate: { allow_nil: true }
  # The one `system` user is the Super Admin: never a member, created only by provision_super_admin!
  # (docs/auth/admin-access.md). Fixed at creation; scopes off because User.system would shadow Kernel#system.
  enum :account_type, { member: "member", system: "system" }, scopes: false
  attr_readonly :account_type

  validates :full_name, presence: true, length: { maximum: 120 }
  validates :email, presence: true, length: { maximum: 254 },
    format: { with: URI::MailTo::EMAIL_REGEXP }, uniqueness: true
  # Presence and the 72-byte limit come from has_secure_password; passwords are never trimmed.
  validates :password, length: { minimum: 12 }, allow_nil: true
  # has_secure_password ignores "", which would otherwise pass as a reset that changes nothing.
  validates :password, length: { minimum: 12 }, on: %i[password_reset password_change]
  validates :sap_id, uniqueness: true, allow_nil: true
  validates :email_verified_at, presence: true, if: :admin_role?
  validate :admin_role_changed_through_change_admin_role, on: :update, if: :will_save_change_to_admin_role?
  validate :admin_role_needs_active_account, if: -> { admin_role? && will_save_change_to_admin_role? }
  validate :super_admin_is_the_system_account

  EMAIL_CODE_TTL = 10.minutes
  EMAIL_CODE_MAX_ATTEMPTS = 5
  EMAIL_RESEND_COOLDOWN = 60.seconds
  ProvisioningError = Class.new(StandardError)
  # A temporary password (provisioning, recovery) works only this long, and only to set a new one.
  TEMPORARY_PASSWORD_TTL = 72.hours

  # Password reset codes follow the same TTL, attempt and cooldown rules, on their own columns.
  PASSWORD_RESET_AUTHORIZATION_TTL = 10.minutes

  # Issued once a reset code verifies. Changing the password (salt) or requesting another code
  # (generation) invalidates it, so it is single-use and superseded by a new request.
  generates_token_for :password_reset, expires_in: PASSWORD_RESET_AUTHORIZATION_TTL do
    [ password_salt.last(10), password_reset_generation ]
  end

  # Starts a new code generation and drops the current code, unless verified or inside the
  # cooldown. Returns the generation for the delivery job, or nil. Locked so parallel
  # requests can't both pass the cooldown.
  def request_email_verification
    with_lock do
      next if email_verified_at? || email_verification_requested_at&.after?(EMAIL_RESEND_COOLDOWN.ago)

      update!(email_verification_requested_at: Time.current, email_verification_generation: email_verification_generation + 1,
        email_verification_code_digest: nil, email_verification_code_issued_at: nil, email_verification_attempts: 0)
      email_verification_generation
    end
  end

  def send_email_verification
    generation = request_email_verification
    UserMailer.with(user: self, generation:).email_verification.deliver_later if generation
  end

  # Called inside the delivery job, so the plaintext never reaches the queue. Writes the code
  # only while this generation is current and has no code yet: a stale or repeated job
  # changes nothing and gets nil.
  def issue_email_verification_code(generation)
    code = format("%06d", SecureRandom.random_number(1_000_000))
    issued = User.where(id:, email_verified_at: nil, email_verification_generation: generation, email_verification_code_digest: nil)
      .update_all(email_verification_code_digest: email_code_digest(code), email_verification_code_issued_at: Time.current)
    code if issued == 1
  end

  # Row lock serialises parallel attempts, so a code verifies once and attempts can't overshoot.
  def verify_email_code(code)
    with_lock do
      next false unless email_verification_code_digest && email_verification_code_issued_at.after?(EMAIL_CODE_TTL.ago) &&
        email_verification_attempts < EMAIL_CODE_MAX_ATTEMPTS

      if ActiveSupport::SecurityUtils.secure_compare(email_verification_code_digest, email_code_digest(code))
        update!(email_verified_at: Time.current, email_verification_code_digest: nil)
      else
        increment!(:email_verification_attempts)
        false
      end
    end
  end

  # Same shape as request_email_verification: starts a new reset generation, which drops the
  # current code and any reset authorization. Disabled accounts get nothing.
  def request_password_reset
    with_lock do
      # The system account recovers only through the audited operator task (recover_super_admin!).
      next if !active? || system? || password_reset_requested_at&.after?(EMAIL_RESEND_COOLDOWN.ago)

      update!(password_reset_requested_at: Time.current, password_reset_generation: password_reset_generation + 1,
        password_reset_code_digest: nil, password_reset_code_issued_at: nil, password_reset_attempts: 0)
      password_reset_generation
    end
  end

  def send_password_reset
    generation = request_password_reset
    UserMailer.with(user: self, generation:).password_reset.deliver_later if generation
  end

  # Called inside the delivery job, like issue_email_verification_code.
  def issue_password_reset_code(generation)
    code = format("%06d", SecureRandom.random_number(1_000_000))
    issued = User.where(id:, account_status: "active", account_type: "member", password_reset_generation: generation,
      password_reset_code_digest: nil)
      .update_all(password_reset_code_digest: password_reset_code_digest_for(code), password_reset_code_issued_at: Time.current)
    code if issued == 1
  end

  # Returns a reset authorization token, or nil. The code is single-use; nobody is signed in.
  def verify_password_reset_code(code)
    with_lock do
      next unless active? && member? && password_reset_code_digest && password_reset_code_issued_at.after?(EMAIL_CODE_TTL.ago) &&
        password_reset_attempts < EMAIL_CODE_MAX_ATTEMPTS

      if ActiveSupport::SecurityUtils.secure_compare(password_reset_code_digest, password_reset_code_digest_for(code))
        update!(password_reset_code_digest: nil)
        generate_token_for(:password_reset)
      else
        increment!(:password_reset_attempts)
        nil
      end
    end
  end

  # Returns nil for a missing, expired, used or superseded authorization (or a disabled account),
  # otherwise the user, with errors if the password was rejected. The row lock makes a token
  # usable once: a parallel request reloads the new salt and no longer matches. The password,
  # the end of every login and of any outstanding reset code commit together.
  def self.reset_password(token, password)
    return unless token.is_a?(String)

    transaction do
      user = lock.find_by_token_for(:password_reset, token)
      next unless user&.active? && user.member?

      user.assign_attributes(password:, password_reset_generation: user.password_reset_generation + 1,
        password_reset_code_digest: nil, password_reset_code_issued_at: nil, password_reset_attempts: 0)
      user.sessions.delete_all if user.save(context: :password_reset)
      user
    end
  end

  # Yields under the row lock that reset_password holds, unless the password changed since this
  # record was loaded. A login whose bcrypt check overlapped a reset can't add a session after it.
  def with_password_unchanged
    digest = password_digest
    with_lock { yield if password_digest == digest }
  end

  # The only supported way to change a persisted admin role (President, Treasurer): sets it (nil revokes)
  # and records it, under the row lock admin login also takes, so a login can't add a session after a
  # revoke commits. Returns false when nothing changes; raises, leaving nothing changed, when rejected.
  # super_admin is never granted or removed here: it belongs to the system account alone.
  def change_admin_role!(role, by:, action:)
    with_lock do
      raise ProvisioningError, "super_admin belongs only to the system account" if role.to_s == "super_admin" || super_admin?

      previous_role = admin_role
      next false if previous_role == role&.to_s

      @audited_role_change = true
      update!(admin_role: role)
      admin_role_changes.create!(previous_role:, new_role: admin_role, action:, changed_by: by)
      true
    end
  ensure
    @audited_role_change = false
  end

  def temporary_password_expired?
    temporary_password_expires_at&.past? || false
  end

  # Changes this user's own password. The current password is checked again under the row lock, so of
  # parallel changes made with the same old password only the first succeeds. Success ends every
  # session (the old password's too) in the same transaction, then yields so the caller can start the
  # replacement session there. Returns nil for a wrong current password, else self (errors if rejected).
  def change_password(current_password, new_password)
    with_lock do
      next unless current_password && authenticate(current_password)

      if new_password && authenticate(new_password)
        errors.add(:password, "must be different from the current password")
        next self
      end
      assign_attributes(password: new_password, must_change_password: false, temporary_password_expires_at: nil)
      next self unless save(context: :password_change)

      sessions.delete_all
      yield if block_given?
      self
    end
  end

  def self.system_account = find_by(account_type: "system")

  # Creates the one system identity with a generated temporary password; returns [user, password]. The
  # password is never stored (only its digest) or logged; the operator hands it over. Refused once a
  # system account exists in any state (the unique index settles parallel runs): recovery reissues it.
  def self.provision_super_admin!(email:, full_name:, by:)
    password = temporary_password
    user = transaction do
      raise ProvisioningError, "the Super Admin is already provisioned; use admin:recover_super_admin" if system_account

      user = create!(email:, full_name:, password:, account_type: "system", admin_role: "super_admin",
        email_verified_at: Time.current, must_change_password: true, temporary_password_expires_at: TEMPORARY_PASSWORD_TTL.from_now)
      user.admin_role_changes.create!(new_role: "super_admin", action: "provision", changed_by: by)
      user
    end
    [ user, password ]
  rescue ActiveRecord::RecordNotUnique
    raise ProvisioningError, "the Super Admin is already provisioned, or the email belongs to another account"
  end

  # Emergency recovery of the same system identity (never a new one): a new temporary password, a forced
  # change, re-enabled, every session ended, optionally re-pointed at a newly designated person. Audited
  # with the reason and any email change. Returns [user, password].
  def self.recover_super_admin!(by:, reason:, email: nil, full_name: nil)
    password = temporary_password
    user = transaction do
      user = system_account&.lock! or raise ProvisioningError, "no Super Admin is provisioned yet; use admin:provision_super_admin"

      user.assign_attributes(password:, must_change_password: true, account_status: "active",
        temporary_password_expires_at: TEMPORARY_PASSWORD_TTL.from_now)
      user.assign_attributes(email:, email_verified_at: Time.current) if email.present?
      user.full_name = full_name if full_name.present?
      note = [ reason, ("email #{user.email_in_database} → #{user.email}" if user.will_save_change_to_email?) ].compact.join("; ")
      user.save!
      user.sessions.delete_all
      user.admin_role_changes.create!(previous_role: "super_admin", new_role: "super_admin", action: "recover", changed_by: by, note:)
      user
    end
    [ user, password ]
  end

  # 24 alphanumerics: about 143 bits, well inside bcrypt's 72 bytes.
  def self.temporary_password = SecureRandom.alphanumeric(24)

  private

  # Enum shortcuts (treasurer!) and plain updates would skip the audit row, so they're rejected.
  # update_columns and raw SQL skip validations; those are privileged database access, not app paths.
  def admin_role_changed_through_change_admin_role
    errors.add(:admin_role, "can only be changed with change_admin_role!") unless @audited_role_change
  end

  def admin_role_needs_active_account
    errors.add(:account_status, "must be active to hold an admin role") unless active?
  end

  # Mirrors users_super_admin_is_system and users_system_not_member with readable errors.
  def super_admin_is_the_system_account
    errors.add(:admin_role, "super_admin belongs only to the system account") if super_admin? != system?
    errors.add(:base, "the system account can't be a member") if system? && (!not_started? || sap_id)
  end

  def password_reset_code_digest_for(code)
    key = Rails.application.key_generator.generate_key("user password reset code")
    OpenSSL::HMAC.hexdigest("SHA256", key, "#{id}:#{code}")
  end

  # Keyed HMAC: a leaked digest can't be brute-forced over the 10^6 codes without secret_key_base.
  def email_code_digest(code)
    key = Rails.application.key_generator.generate_key("user email verification code")
    OpenSSL::HMAC.hexdigest("SHA256", key, "#{id}:#{code}")
  end
end
