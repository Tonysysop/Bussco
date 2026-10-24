module Api
  module V1
    module Admin
      module Auth
        # Admin login, current admin and logout (docs/auth/admin-access.md). Same rules as member login,
        # on its own cookie and session rows; there is no admin signup or role assignment here.
        class SessionsController < BaseController
          skip_before_action :require_authentication, only: [ :create, :destroy ]
          skip_before_action :require_password_changed

          rate_limit to: 20, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { rate_limited }, only: :create
          # Keyed on the submitted email whether or not an account exists, so a 429 reveals nothing.
          rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE, by: -> { email.to_s.strip.downcase },
            with: -> { rate_limited }, only: :create, name: "per-email"

          # One 401 for an unknown email, wrong password, disabled account, non-admin or an expired
          # temporary password. The role and status are re-read under the row lock change_admin_role!
          # takes, so a revoke that commits first wins, and one that commits after deletes this session.
          # A temporary password signs in to a restricted session (must_change_password).
          def create
            user = User.authenticate_by(email:, password: string_param(params[:password]))
            csrf_token = user&.with_password_unchanged { start_session_for(user) if user.active? && user.admin_role? && !user.temporary_password_expired? }

            if csrf_token
              render json: { user: admin_json(user), csrf_token: }, status: :created
            else
              render json: { error: "invalid_credentials" }, status: :unauthorized
            end
          end

          def show
            render json: { user: admin_json(current_admin) }
          end

          # Always 200, logged in or not.
          def destroy
            terminate_session
            render json: { csrf_token: rotate_browser_session }
          end

          private

          def email
            string_param(params[:email])
          end
        end
      end
    end
  end
end
