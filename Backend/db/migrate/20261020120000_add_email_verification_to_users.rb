# Email verification codes (docs/auth/email-verification.md). One code per user, so
# issuing a new one replaces the old. Only an HMAC of the code is stored.
class AddEmailVerificationToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users do |t|
      t.string :email_verification_code_digest
      t.datetime :email_verification_code_issued_at
      t.datetime :email_verification_requested_at
      t.integer :email_verification_generation, null: false, default: 0
      t.integer :email_verification_attempts, null: false, default: 0

      t.check_constraint "email_verification_attempts BETWEEN 0 AND 5", name: "users_email_verification_attempts_range"
    end
  end
end
