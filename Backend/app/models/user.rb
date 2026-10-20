class User < ApplicationRecord
  # Password reset tokens belong to increment 4.
  has_secure_password reset_token: false

  # Unicode-aware trim: String#strip is ASCII-only, but the DB check's \s also matches e.g. EM SPACE.
  normalizes :full_name, with: ->(full_name) { full_name.gsub(/\A[[:space:]]+|[[:space:]]+\z/, "") }
  normalizes :email, with: ->(email) { email.strip.downcase }

  enum :account_status, { active: "active", disabled: "disabled" }
  enum :membership_status, { not_started: "not_started" }

  validates :full_name, presence: true, length: { maximum: 120 }
  validates :email, presence: true, length: { maximum: 254 },
    format: { with: URI::MailTo::EMAIL_REGEXP }, uniqueness: true
  # Presence and the 72-byte limit come from has_secure_password; passwords are never trimmed.
  validates :password, length: { minimum: 12 }, allow_nil: true
  validates :sap_id, uniqueness: true, allow_nil: true
end
