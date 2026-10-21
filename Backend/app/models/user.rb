class User < ApplicationRecord
  # Rails' built-in 15-minute reset token is replaced by :password_reset below (docs/auth/password-recovery.md).
  has_secure_password reset_token: false

  # dependent: :delete_all also makes sessions.delete_all delete rows rather than null user_id.
  has_many :sessions, dependent: :delete_all
  # destroy (not the FK cascade) so Active Storage also purges the passport photo.
  has_one :membership_application, dependent: :destroy
  # Disabling revokes every login in the same transaction; each request also re-checks status.
  before_update { sessions.delete_all if will_save_change_to_account_status?(to: "disabled") }

  # Unicode-aware trim: String#strip is ASCII-only, but the DB check's \s also matches e.g. EM SPACE.
  normalizes :full_name, with: ->(full_name) { full_name.gsub(/\A[[:space:]]+|[[:space:]]+\z/, "") }
  normalizes :email, with: ->(email) { email.strip.downcase }

  enum :account_status, { active: "active", disabled: "disabled" }
  # Set only by server code: awaiting_approval on application submission; approval is a later increment.
  enum :membership_status, { not_started: "not_started", awaiting_approval: "awaiting_approval" }

  validates :full_name, presence: true, length: { maximum: 120 }
  validates :email, presence: true, length: { maximum: 254 },
    format: { with: URI::MailTo::EMAIL_REGEXP }, uniqueness: true
  # Presence and the 72-byte limit come from has_secure_password; passwords are never trimmed.
  validates :password, length: { minimum: 12 }, allow_nil: true
  # has_secure_password ignores "", which would otherwise pass as a reset that changes nothing.
  validates :password, length: { minimum: 12 }, on: :password_reset
  validates :sap_id, uniqueness: true, allow_nil: true

  EMAIL_CODE_TTL = 10.minutes
  EMAIL_CODE_MAX_ATTEMPTS = 5
  EMAIL_RESEND_COOLDOWN = 60.seconds
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
      next if !active? || password_reset_requested_at&.after?(EMAIL_RESEND_COOLDOWN.ago)

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
    issued = User.where(id:, account_status: "active", password_reset_generation: generation, password_reset_code_digest: nil)
      .update_all(password_reset_code_digest: password_reset_code_digest_for(code), password_reset_code_issued_at: Time.current)
    code if issued == 1
  end

  # Returns a reset authorization token, or nil. The code is single-use; nobody is signed in.
  def verify_password_reset_code(code)
    with_lock do
      next unless active? && password_reset_code_digest && password_reset_code_issued_at.after?(EMAIL_CODE_TTL.ago) &&
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
      next unless user&.active?

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

  private

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
