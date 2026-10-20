module Api
  module V1
    class HealthController < BaseController
      def ready
        ActiveRecord::Base.connection.select_value("SELECT 1")
        render json: { status: "ok" }
      rescue StandardError => e
        # Class name only: messages can carry hosts, usernames or SQL.
        Rails.logger.error("Readiness check failed: #{e.class}")
        render json: { status: "unavailable" }, status: :service_unavailable
      end
    end
  end
end
