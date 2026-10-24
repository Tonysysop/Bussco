# A member or admin login (docs/auth/sessions.md, docs/auth/admin-access.md). Deleting the row
# revokes it immediately. Admin rows are flagged and only ever resolved by an admin lookup.
class Session < ApplicationRecord
  IDLE_TIMEOUT = 30.minutes
  ABSOLUTE_LIFETIME = 12.hours
  ADMIN_IDLE_TIMEOUT = 15.minutes
  ADMIN_ABSOLUTE_LIFETIME = 8.hours
  TOUCH_INTERVAL = 1.minute

  belongs_to :user

  scope :expired, -> {
    where(admin: false).where("last_seen_at < ? OR created_at < ?", IDLE_TIMEOUT.ago, ABSOLUTE_LIFETIME.ago)
      .or(where(admin: true).where("last_seen_at < ? OR created_at < ?", ADMIN_IDLE_TIMEOUT.ago, ADMIN_ABSOLUTE_LIFETIME.ago))
  }

  # Returns the plaintext token for the cookie; only its digest is stored.
  # shortcut: expired rows are swept only for the user logging in; add a scheduled job if the table grows.
  def self.start(user, request, admin: false)
    user.sessions.expired.delete_all
    token = SecureRandom.urlsafe_base64(32)
    create!(user:, admin:, token_digest: digest(token), last_seen_at: Time.current,
      ip_address: request.remote_ip, user_agent: request.user_agent&.first(255))
    token
  end

  # The live session of this kind for this token, or nil. A session that has expired, or whose
  # user may no longer hold it, is deleted.
  def self.resume(token, admin: false)
    session = find_by(token_digest: digest(token), admin:) or return

    if session.expired? || !session.usable?
      session.delete
      return
    end

    session.touch_last_seen
    session
  end

  def self.revoke(token, admin: false)
    where(token_digest: digest(token), admin:).delete_all
  end

  # SHA-256 without a key is enough: the token has 256 bits of entropy, so it can't be guessed.
  def self.digest(token)
    Digest::SHA256.hexdigest(token)
  end

  def idle_timeout = admin? ? ADMIN_IDLE_TIMEOUT : IDLE_TIMEOUT
  def absolute_lifetime = admin? ? ADMIN_ABSOLUTE_LIFETIME : ABSOLUTE_LIFETIME

  def expired?
    last_seen_at < idle_timeout.ago || created_at < absolute_lifetime.ago
  end

  # Re-checked on every request, so a change that skipped the User callbacks still blocks. Admin rows
  # need a current admin whose temporary password (if any) hasn't expired; member rows need a member
  # account, so the system identity can never act as a cooperative member.
  def usable?
    return false unless user.active?

    admin? ? user.admin_role? && user.email_verified_at? && !user.temporary_password_expired? : user.member?
  end

  # One conditional UPDATE, so concurrent requests can only move last_seen_at forward, at most
  # once a minute, and never revive a row that expired or was deleted in the meantime.
  # created_at is never written, so the absolute lifetime can't be extended.
  def touch_last_seen
    now = Time.current
    Session.where(id:, last_seen_at: (now - idle_timeout)...(now - TOUCH_INTERVAL)).update_all(last_seen_at: now)
  end
end
