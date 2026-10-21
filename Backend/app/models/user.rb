class User < ApplicationRecord
  # Password reset tokens belong to the password recovery increment (docs/auth/password-recovery.md).
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
  validates :sap_id, uniqueness: true, allow_nil: true

  EMAIL_CODE_TTL = 10.minutes
  EMAIL_CODE_MAX_ATTEMPTS = 5
  EMAIL_RESEND_COOLDOWN = 60.seconds

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

  private

  # Keyed HMAC: a leaked digest can't be brute-forced over the 10^6 codes without secret_key_base.
  def email_code_digest(code)
    key = Rails.application.key_generator.generate_key("user email verification code")
    OpenSSL::HMAC.hexdigest("SHA256", key, "#{id}:#{code}")
  end
end
