module Api
  module V1
    module Auth
      # Public registration (docs/auth/registration.md). Creates an unverified, non-member account
      # and nothing else: no session, cookie, role or membership.
      class RegistrationsController < BaseController
        # error_handler is Solid Cache's hook for transient DB errors, after which the limiter fails open.
        # Its default logs via Cache::Store.logger, which is nil here, so log explicitly (class only).
        RATE_LIMIT_STORE = ActiveSupport::Cache.lookup_store(Rails.configuration.x.rate_limit_store,
          error_handler: ->(method:, exception:, **) {
            Rails.logger.error("Rate limit store #{method} failed (#{exception.class}); request allowed")
          })

        # Counts per request.remote_ip (Rails' default `by:`).
        rate_limit to: 10, within: 15.minutes, store: RATE_LIMIT_STORE,
          with: -> { rate_limited }, only: :create

        def create
          user = User.new(registration_params)

          if user.save
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

        # Non-strings and strings with NUL (which bcrypt and PostgreSQL reject with an exception)
        # become nil, so they fail validation instead of erroring.
        def registration_params
          params.expect(user: [ :full_name, :email, :password ]).to_h
            .transform_values { |value| value if value.is_a?(String) && !value.include?("\0") }
        end

        def user_json(user)
          {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            email_verified: user.email_verified_at.present?,
            account_status: user.account_status,
            membership_status: user.membership_status
          }
        end

        def render_errors(user)
          render json: { errors: user.errors.to_hash }, status: :unprocessable_content
        end

        def violated_constraint(error)
          error.cause.result&.error_field(PG::Result::PG_DIAG_CONSTRAINT_NAME) if error.cause.is_a?(PG::Error)
        end

        def rate_limited
          response.set_header("Retry-After", 15.minutes.to_i.to_s)
          render json: { error: "rate_limited" }, status: :too_many_requests
        end
      end
    end
  end
end
