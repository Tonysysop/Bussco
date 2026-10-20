class ApplicationMailer < ActionMailer::Base
  layout "mailer"

  # Embedded, not linked: shows without a public host and isn't blocked as a remote image.
  before_action { attachments.inline["bussco.png"] = Rails.root.join("public/bussco.png").binread }
end
