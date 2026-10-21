# Password reset codes (docs/auth/password-recovery.md). Separate from email verification codes:
# one reset code per user, so issuing a new one replaces the old. Only an HMAC of the code is stored.
class AddPasswordResetToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users do |t|
      t.string :password_reset_code_digest
      t.datetime :password_reset_code_issued_at
      t.datetime :password_reset_requested_at
      t.integer :password_reset_generation, null: false, default: 0
      t.integer :password_reset_attempts, null: false, default: 0

      t.check_constraint "password_reset_attempts BETWEEN 0 AND 5", name: "users_password_reset_attempts_range"
    end
  end
end
