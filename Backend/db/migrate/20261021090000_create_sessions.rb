# Revocable member sessions (docs/auth/sessions.md). The bussco_auth cookie holds a random
# token; only its SHA-256 digest is stored, so database rows can't be replayed as cookies.
class CreateSessions < ActiveRecord::Migration[8.1]
  def change
    create_table :sessions do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }
      t.string :token_digest, null: false, index: { unique: true }
      t.string :ip_address
      t.string :user_agent
      t.datetime :last_seen_at, null: false
      t.timestamps
    end
  end
end
