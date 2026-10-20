module Api
  module V1
    module Auth
      # Email ownership by six-digit code (docs/auth/email-verification.md). Verifying sets
      # email_verified_at only: no session, cookie, role or membership.
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

        def update
          if User.find_by(email:)&.verify_email_code(string_param(params[:code]).to_s)
            render json: { email_verified: true }
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
