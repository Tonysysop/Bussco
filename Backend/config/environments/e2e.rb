# Browser checks against real Rails (README "Browser checks"): development behaviour on its own database
# (bussco_e2e, see database.yml), its own uploaded files and no outbound email, so a check never writes to
# bussco_development. Reset only with `bin/rails e2e:reset`, which refuses any other database.
require_relative "development"

Rails.application.configure do
  config.active_storage.service = :e2e
  # Always files, never SMTP, even when RESEND_API_KEY is set in the shell; checks read codes from here.
  config.action_mailer.delivery_method = :file
  config.action_mailer.file_settings = { location: Rails.root.join("tmp/mails-e2e") }
  config.action_mailer.default_url_options = { host: "localhost", port: 3100 }
end
