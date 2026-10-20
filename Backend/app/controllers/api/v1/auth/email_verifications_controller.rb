module Api
  module V1
    module Auth
      # Email ownership by six-digit code (docs/auth/email-verification.md). Verifying sets
      # email_verified_at, and signs in the registering browser (docs/auth/sessions.md); no role or membership.
      class EmailVerificationsController < BaseController
        # One per-IP budget for sending and verifying. Guessing is capped per code in the DB anyway.
        rate_limit to: 20, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { rate_limited }
        # Keyed on the submitted email whether or not an account exists, so a 429 reveals nothing.
        rate_limit to: 5, within: 1.hour, store: RATE_LIMIT_STORE, by: -> { email.to_s.strip.downcase },
          with: -> { rate_limited(1.hour) }, only: :create, name: "per-email"

        # Always 202, so the answer never says whether the account exists, is verified or cooling down.
        def create
          User.find_by(email:)&.send_email_verification
          head :accepted
        end

        # The row lock in verify_email_code lets one request per code succeed, so at most one session
        # starts. Only the browser that registered (and so knew the password) is signed in.
        def update
          user = User.find_by(email:)

          if user&.verify_email_code(string_param(params[:code]).to_s)
            body = { email_verified: true }
            if user.active? && session[:registered_user_id] == user.id
              body.merge!(user: user_json(user), csrf_token: start_session_for(user))
            end
            render json: body
          else
            render json: { error: "invalid_code" }, status: :unprocessable_content
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
