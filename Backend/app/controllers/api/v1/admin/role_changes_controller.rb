module Api
  module V1
    module Admin
      # Read-only role-change history for the Super Admin (docs/auth/admin-access.md).
      class RoleChangesController < BaseController
        before_action -> { require_admin_role(:super_admin) }

        # shortcut: no pagination, role changes are rare; add a cursor when history passes a few hundred rows.
        def index
          changes = AdminRoleChange.includes(:user, :changed_by_user).order(created_at: :desc, id: :desc)
          render json: { role_changes: changes.map { role_change_json(it) } }
        end

        private

        # The actor is the linked admin's current name for portal changes, else the operator's recorded text.
        def role_change_json(change)
          { id: change.id, previous_role: change.previous_role, new_role: change.new_role, action: change.action,
            actor: change.changed_by_user&.full_name || change.changed_by, created_at: change.created_at,
            user: { id: change.user.id, full_name: change.user.full_name, email: change.user.email } }
        end
      end
    end
  end
end
