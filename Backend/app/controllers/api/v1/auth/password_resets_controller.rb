module Api
  module V1
    module Auth
      # Password recovery by six-digit code (docs/auth/password-recovery.md): request a code, verify
      # it for a short-lived reset authorization held in this browser's session, then set a new
      # password. Nothing here signs anyone in.
      class PasswordResetsController < BaseController
        # A flood ceiling sized for a whole office behind one NAT address. Guessing is capped per
        # email below and per code in the database, not by IP.
        rate_limit to: 60, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { rate_limited }
        # Keyed on the submitted email whether or not an account exists, so a 429 reveals nothing.
        rate_limit to: 5, within: 1.hour, store: RATE_LIMIT_STORE, by: -> { email.to_s.strip.downcase },
          with: -> { rate_limited(1.hour) }, only: :create, name: "per-email"
        rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE, by: -> { email.to_s.strip.downcase },
          with: -> { rate_limited }, only: :verify, name: "per-email-verify"

        # Always 202, so the answer never says whether the account exists, is disabled or cooling down.
        def create
          User.find_by(email:)&.send_password_reset
          head :accepted
        end

        # The authorization lives only in the encrypted, HttpOnly Rails session cookie.
        def verify
          token = User.find_by(email:)&.verify_password_reset_code(string_param(params[:code]).to_s)

          if token
            session[:password_reset_token] = token
            render json: {}
          else
            render json: { error: "invalid_code" }, status: :unprocessable_content
          end
        end

        # A rejected password keeps the authorization so the user can try again. Success revokes
        # every login (this browser's too) and requires a fresh login.
        def update
          user = User.reset_password(session[:password_reset_token], string_param(params[:password]))

          if user.nil?
            render json: { error: "invalid_reset_token" }, status: :unprocessable_content
          elsif user.errors.any?
            render json: { errors: user.errors.to_hash }, status: :unprocessable_content
          else
            terminate_session
            UserMailer.with(user:).password_changed.deliver_later
            render json: { csrf_token: rotate_browser_session }
          end
        end

        private

        def email
          string_param(params[:email])
        end
      end
    end
  end
end
