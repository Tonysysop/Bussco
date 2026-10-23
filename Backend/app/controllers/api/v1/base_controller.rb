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

      # Which login the helpers below serve. Admin::BaseController overrides both, so admin endpoints
      # read only bussco_admin and admin rows, and member endpoints only bussco_auth and member rows.
      def auth_cookie = :bussco_auth
      def admin_session? = false

      # Login (docs/auth/sessions.md). The cookie holds a random token; only its digest is stored.
      # Strict: only the app's own same-origin requests ever need it.
      def start_session_for(user)
        terminate_session # this browser's previous login of this kind only; other devices keep theirs
        csrf_token = rotate_browser_session
        cookies[auth_cookie] = { value: Session.start(user, request, admin: admin_session?), httponly: true,
          same_site: :strict, secure: Rails.env.production? }
        csrf_token
      end

      def authenticated_session
        return @authenticated_session if defined?(@authenticated_session)

        token = cookies[auth_cookie]
        @authenticated_session = token && Session.resume(token, admin: admin_session?)
        cookies.delete(auth_cookie) if token && !@authenticated_session
        @authenticated_session
      end

      def require_authentication
        render json: { error: "unauthenticated" }, status: :unauthorized unless authenticated_session
      end

      # Deletes the row, so a copy of the cookie stops working too.
      def terminate_session
        Session.revoke(cookies[auth_cookie], admin: admin_session?) if cookies[auth_cookie]
        cookies.delete(auth_cookie)
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

      def rate_limited(retry_after = 15.minutes)
        response.set_header("Retry-After", retry_after.to_i.to_s)
        render json: { error: "rate_limited" }, status: :too_many_requests
      end
    end
  end
end
