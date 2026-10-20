Rails.application.routes.draw do
  # Liveness: 200 if the app boots, regardless of the database.
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      # Readiness: 503 when the database is unreachable.
      get "health/ready", to: "health#ready"

      # CSRF token for the browser app; creates the _bussco_session cookie.
      get "csrf", to: "csrf#show"

      namespace :auth do
        resources :registrations, only: :create
        resource :email_verification, only: [ :create, :update ]
        resource :session, only: [ :create, :destroy ]
        get "me", to: "sessions#show"
      end
    end
  end
end
