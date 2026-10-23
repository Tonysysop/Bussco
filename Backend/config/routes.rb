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
        resource :password_reset, path: "password_resets", only: [ :create, :update ] do
          post :verify
        end
        get "me", to: "sessions#show"
      end

      # Admin login only; roles are provisioned by operators (lib/tasks/admin.rake), never through the API.
      namespace :admin do
        namespace :auth do
          resource :session, only: [ :create, :destroy ]
          get "me", to: "sessions#show"
        end
      end

      namespace :membership do
        resource :application, only: [ :show, :create ] do
          patch "stages/:stage", action: :update_stage, as: :stage
          get :passport_photo, action: :passport_photo
          put :passport_photo, action: :update_passport_photo
          post :submission, action: :submit
        end
      end
    end
  end
end
