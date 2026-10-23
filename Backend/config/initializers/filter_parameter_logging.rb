# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc, :code, :cookie, :session, :bussco_auth, :bussco_admin,
  # Membership application: the nested params hash, the photo, and every column by name (SQL binds, inspect).
  :application, :photo, :declaration, :sap_staff, :business_unit, :department, :office_location, :phone, :birth, :sex,
  :marital, :nationality, :address, :kin, :contribution
]
