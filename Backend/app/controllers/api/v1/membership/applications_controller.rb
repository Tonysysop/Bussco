module Api
  module V1
    module Membership
      # The signed-in user's own membership application (docs/membership/application.md). The record
      # always comes from the session's user: no id is ever read from the request.
      class ApplicationsController < BaseController
        WRITES = %i[create update_stage update_passport_photo submit].freeze

        # Generous, and per user: autosave sends one request per stage change or idle pause, and many
        # staff may share one office IP.
        rate_limit to: 300, within: 15.minutes, store: RATE_LIMIT_STORE, with: -> { rate_limited }, only: WRITES,
          by: -> { authenticated_session&.user_id || request.remote_ip }

        before_action :require_authentication
        before_action :require_expected_applicant, only: WRITES
        before_action :set_application, except: :create
        before_action :require_draft, :require_current_version, only: WRITES - [ :create ]

        # Another request saved first (another tab, an out-of-order autosave or a submit).
        rescue_from(ActiveRecord::StaleObjectError) { render_conflict("stale") }

        def show
          render json: application_json
        end

        # Idempotent; the unique index on user_id settles parallel starts.
        def create
          @application = current_user.membership_application
          return render(json: application_json) if @application

          @application = MembershipApplication.create!(user: current_user)
          render json: application_json, status: :created
        rescue ActiveRecord::RecordNotUnique
          @application = current_user.reload_membership_application
          render json: application_json
        end

        def update_stage
          fields = MembershipApplication::STAGES[params[:stage]] or return render_not_found
          attributes = params.expect(application: fields).to_h
          invalid = attributes.reject { |field, value| acceptable_value?(field, value) }.keys
          return render_errors(invalid.index_with { [ "is invalid" ] }) if invalid.any?

          @application.assign_attributes(attributes)
          save_and_render
        end

        def passport_photo
          return render_not_found unless @application.passport_photo.attached?

          response.set_header("Cache-Control", "private, no-store")
          # Image bytes can't say whose they are: the client drops a photo answered for another sign-in.
          response.set_header("X-Applicant-Id", current_user.id.to_s)
          blob = @application.passport_photo.blob
          send_data blob.download, type: blob.content_type, disposition: "inline"
        end

        # The old photo is replaced (and purged) only after the new one passes validation.
        def update_passport_photo
          file = params[:photo]
          return render_errors(passport_photo: [ "is required" ]) unless file.is_a?(ActionDispatch::Http::UploadedFile)

          @application.passport_photo_file = file
          save_and_render
        end

        def submit
          declaration = MembershipApplication.current_declaration
          return render(json: { error: "declaration_unavailable" }, status: :service_unavailable) unless declaration
          unless params[:declaration_accepted] == true && params[:declaration_version] == declaration[:version]
            return render_errors(declaration: [ "must be accepted" ])
          end

          if @application.submit(declaration[:version])
            render json: application_json, status: :created
          else
            render json: { errors: @application.errors.to_hash, missing: @application.fields_with_errors }, status: :unprocessable_content
          end
        end

        private

        def current_user = authenticated_session.user

        def set_application
          @application = current_user.membership_application or render_not_found
        end

        # The client names the applicant it is writing for. After a sign-in changes in another tab, the
        # session cookie belongs to someone else: their application must not receive this write.
        def require_expected_applicant
          return if request.headers["X-Applicant-Id"] == current_user.id.to_s

          render json: { error: "identity_mismatch" }, status: :conflict
        end

        def require_draft
          render_conflict("already_submitted") if @application.submitted?
        end

        # The client echoes the lock_version it last read; an older one means it would overwrite newer data.
        def require_current_version
          version = params[:lock_version]
          version = version.to_i if version.is_a?(String) && version.match?(/\A\d{1,9}\z/) # multipart sends strings
          return render_errors(lock_version: [ "is required" ]) unless version.is_a?(Integer)

          render_conflict("stale") unless version == @application.lock_version
        end

        # params.expect already drops arrays and hashes; JSON numbers are only accepted as kobo.
        def acceptable_value?(field, value)
          value.nil? || string_param(value) || (field == "monthly_contribution_kobo" && value.is_a?(Integer))
        end

        def save_and_render
          if @application.save
            render json: application_json
          else
            render_errors(@application.errors.to_hash)
          end
        end

        def render_errors(errors)
          render json: { errors: }, status: :unprocessable_content
        end

        def render_not_found
          render json: { error: "not_found" }, status: :not_found
        end

        # Returns the saved state so the client can reload or merge.
        def render_conflict(error)
          render json: { error:, **application_json(@application.reload).slice(:application) }, status: :conflict
        end

        def application_json(application = @application)
          photo = application.passport_photo.blob if application.passport_photo.attached?
          declaration = MembershipApplication.current_declaration
          {
            application: application.slice(*MembershipApplication::STAGES.values.flatten,
              "declaration_version", "declaration_accepted_at", "submitted_at", "lock_version")
              .merge("passport_photo" => photo && { content_type: photo.content_type, byte_size: photo.byte_size, checksum: photo.checksum }),
            applicant: current_user.slice("full_name", "email", "membership_status"),
            progress: application.submitted? ? nil : application.progress,
            policy: {
              minimum_monthly_contribution_kobo: MembershipApplication::MINIMUM_MONTHLY_CONTRIBUTION_KOBO,
              registration_fee_kobo: MembershipApplication::REGISTRATION_FEE_KOBO,
              declaration: declaration && declaration.slice(:version, :text, :approved)
            }
          }
        end
      end
    end
  end
end
