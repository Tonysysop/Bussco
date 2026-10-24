module Api
  module V1
    module Auth
      # Member login, current user and logout (docs/auth/sessions.md). Signing in proves identity
      # only; it grants no membership or admin access.
      class SessionsController < BaseController
        rate_limit to: 20, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { rate_limited }, only: :create
        # Keyed on the submitted email whether or not an account exists, so a 429 reveals nothing.
        rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE, by: -> { email.to_s.strip.downcase },
          with: -> { rate_limited }, only: :create, name: "per-email"

        before_action :require_authentication, only: :show

        # authenticate_by does the bcrypt work for unknown emails too, so timing reveals nothing.
        # Unknown, wrong password and disabled share one answer; email_not_verified needs the password.
        def create
          user = User.authenticate_by(email:, password: string_param(params[:password]))

          # The system account (the Super Admin) is not a member and never signs in here.
          if !user&.active? || user.system?
            render json: { error: "invalid_credentials" }, status: :unauthorized
          elsif !user.email_verified_at?
            render json: { error: "email_not_verified" }, status: :forbidden
          elsif (csrf_token = user.with_password_unchanged { start_session_for(user) })
            render json: { user: user_json(user), csrf_token: }, status: :created
          else
            render json: { error: "invalid_credentials" }, status: :unauthorized
          end
        end

        def show
          render json: { user: user_json(authenticated_session.user) }
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
