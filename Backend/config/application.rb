require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "active_storage/engine"
require "action_controller/railtie"
require "action_mailer/railtie"
# require "action_mailbox/engine"
# require "action_text/engine"
require "action_view/railtie"
# require "action_cable/engine"
require "rails/test_unit/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Bussco
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # BUSSCO operates in Nigeria: Date.current and "today"/"next month" rules follow Lagos (UTC+1, no DST).
    # Timestamps are still stored in UTC.
    config.time_zone = "Africa/Lagos"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true

    # Browser session holding only the CSRF secret (docs/auth/browser-foundations.md).
    # API-only mode skips these middlewares and Rails' force_ssl secure-cookie default.
    config.session_store :cookie_store, key: "_bussco_session",
      httponly: true, same_site: :lax, secure: Rails.env.production?
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use config.session_store, config.session_options

    # Mail goes through Resend's SMTP (docs/auth/email-verification.md); used only where
    # delivery_method is :smtp. Port 465 is implicit TLS, so nothing is ever sent in clear.
    config.action_mailer.smtp_settings = { address: "smtp.resend.com", port: 465, tls: true,
      user_name: "resend", password: ENV["RESEND_API_KEY"], authentication: :plain }
    config.action_mailer.default_options = { from: ENV.fetch("MAIL_FROM", "BUSSCO <no-reply@localhost>") }
    # Action Mailer logs whole messages, verification codes included, at debug level.
    config.action_mailer.logger = nil

    # Passport photos are private (docs/membership/application.md): Active Storage's own routes
    # (public signed blob URLs, anonymous direct uploads) are off; owners fetch them via the API.
    config.active_storage.draw_routes = false
  end
end
