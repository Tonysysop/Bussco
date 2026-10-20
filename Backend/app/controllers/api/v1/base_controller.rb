module Api
  module V1
    class BaseController < ApplicationController
      include ActionController::Cookies
      include ActionController::RequestForgeryProtection

      # API controllers don't inherit config.action_controller defaults, so set the origin check here.
      self.forgery_protection_origin_check = true
      protect_from_forgery with: :exception

      rescue_from ActionController::InvalidAuthenticityToken do
        render json: { error: "invalid_csrf_token" }, status: :forbidden
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
    end
  end
end
