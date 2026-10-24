# Append-only audit of admin role changes, written only by User#change_admin_role!; the database
# limits `action` and the roles to known values. Read-only through Active Record once saved;
# privileged SQL can still alter it (docs/auth/admin-access.md). Portal changes also link the acting
# admin (changed_by_user); operator rows have only the `changed_by` name.
class AdminRoleChange < ApplicationRecord
  belongs_to :user
  belongs_to :changed_by_user, class_name: "User", optional: true

  validates :changed_by, presence: true
  validates :note, presence: true, if: -> { action == "recover" }

  def readonly? = persisted?
end
