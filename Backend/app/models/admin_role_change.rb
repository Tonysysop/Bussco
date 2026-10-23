# Append-only audit of admin role changes, written only by User#change_admin_role!; the database
# limits `action` and the roles to known values. Read-only through Active Record once saved;
# privileged SQL can still alter it (docs/auth/admin-access.md).
class AdminRoleChange < ApplicationRecord
  belongs_to :user

  validates :changed_by, presence: true

  def readonly? = persisted?
end
