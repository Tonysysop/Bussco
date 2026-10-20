module Api
  module V1
    class BaseController < ApplicationController
      include ActionController::Cookies
      include ActionController::RequestForgeryProtection

      # error_handler is Solid Cache's hook for transient DB errors, after which the limiter fails open.
      # Its default logs via Cache::Store.logger, which is nil here, so log explicitly (class only).
      RATE_LIMIT_STORE = ActiveSupport::Cache.lookup_store(Rails.configuration.x.rate_limit_store,
        error_handler: ->(method:, exception:, **) {
          Rails.logger.error("Rate limit store #{method} failed (#{exception.class}); request allowed")
        })

      # API controllers don't inherit config.action_controller defaults, so set the origin check here.
      self.forgery_protection_origin_check = true
      protect_from_forgery with: :exception

      rescue_from ActionController::InvalidAuthenticityToken do
        render json: { error: "invalid_csrf_token" }, status: :forbidden
      end

      # Unparseable JSON and a missing/non-object root key (params.expect) get one JSON 400 with no
      # details, whatever the Accept header. Invalid UTF-8 fails earlier, in Rails' instrumentation,
      # so it gets Rails' own 400 (JSON when the client sends Accept: application/json).
      rescue_from ActionDispatch::Http::Parameters::ParseError, ActionController::ParameterMissing do
        render json: { error: "bad_request" }, status: :bad_request
      end

      private

      # Rails accepts a missing Origin; browsers send one on every unsafe fetch, so require it.
      def valid_request_origin?
        request.origin.present? && super
      end

      # Call on login, logout, password reset and password change; return the new token to the client.
      def rotate_browser_session
        reset_session
        form_authenticity_token
      end

      # Non-strings and strings with NUL (which bcrypt and PostgreSQL reject with an exception)
      # become nil, so they fail validation or lookup instead of erroring.
      def string_param(value)
        value if value.is_a?(String) && !value.include?("\0")
      end

      def rate_limited(retry_after = 15.minutes)
        response.set_header("Retry-After", retry_after.to_i.to_s)
        render json: { error: "rate_limited" }, status: :too_many_requests
      end
    end
  end
end
