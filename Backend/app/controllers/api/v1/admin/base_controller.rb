module Api
  module V1
    module Admin
      # Base for every admin endpoint (docs/auth/admin-access.md). The inherited session helpers use
      # the bussco_admin cookie and admin rows here, and every action needs an admin session unless a
      # subclass skips that check by name.
      class BaseController < Api::V1::BaseController
        before_action :require_authentication
        # A temporary password opens nothing but /me, logout and the password change, which skip this by name.
        before_action :require_password_changed

        private

        def auth_cookie = :bussco_admin
        def admin_session? = true

        def current_admin = authenticated_session.user

        # The role comes from the database on every request, never from the client. Signing in
        # authorizes nothing privileged: privileged actions name the roles they allow.
        def require_admin_role(*roles)
          render json: { error: "forbidden" }, status: :forbidden unless current_admin.admin_role.in?(roles.map(&:to_s))
        end

        def require_password_changed
          render json: { error: "password_change_required" }, status: :forbidden if current_admin.must_change_password?
        end

        def admin_json(user)
          { id: user.id, full_name: user.full_name, email: user.email, admin_role: user.admin_role,
            must_change_password: user.must_change_password }
        end
      end
    end
  end
end
