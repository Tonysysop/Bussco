module Api
  module V1
    module Admin
      module Auth
        # An admin changes their own password (docs/auth/admin-access.md); required before anything else
        # after signing in with a temporary password. Every session ends, then a fresh admin session starts
        # in this browser with a rotated CSRF token.
        class PasswordsController < BaseController
          skip_before_action :require_password_changed

          rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { rate_limited },
            by: -> { authenticated_session&.user_id || request.remote_ip }

          def update
            user = current_admin
            csrf_token = nil
            result = user.change_password(string_param(params[:current_password]), string_param(params[:password])) do
              csrf_token = start_session_for(user)
            end

            if result.nil?
              render json: { error: "invalid_current_password" }, status: :unprocessable_content
            elsif result.errors.any?
              render json: { errors: result.errors.to_hash }, status: :unprocessable_content
            else
              render json: { user: admin_json(user), csrf_token: }
            end
          end
        end
      end
    end
  end
end
