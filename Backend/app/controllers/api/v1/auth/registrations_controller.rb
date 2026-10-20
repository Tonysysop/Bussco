module Api
  module V1
    module Auth
      # Public registration (docs/auth/registration.md). Creates an unverified, non-member account
      # and sends its first verification code; no login, role or membership.
      class RegistrationsController < BaseController
        # Counts per request.remote_ip (Rails' default `by:`).
        rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE,
          with: -> { rate_limited }, only: :create

        def create
          user = User.new(registration_params)

          if user.save
            # Onboarding state, not authentication: lets this browser be signed in when it verifies.
            session[:registered_user_id] = user.id
            user.send_email_verification
            render json: { user: user_json(user) }, status: :created
          else
            render_errors(user)
          end
        rescue ActiveRecord::RecordNotUnique => e
          # A concurrent request inserted the same email between validation and insert.
          raise unless violated_constraint(e) == "index_users_on_email"

          user.errors.add(:email, :taken)
          render_errors(user)
        end

        private

        def registration_params
          params.expect(user: [ :full_name, :email, :password ]).to_h.transform_values { |value| string_param(value) }
        end

        def render_errors(user)
          render json: { errors: user.errors.to_hash }, status: :unprocessable_content
        end

        def violated_constraint(error)
          error.cause.result&.error_field(PG::Result::PG_DIAG_CONSTRAINT_NAME) if error.cause.is_a?(PG::Error)
        end
      end
    end
  end
end
