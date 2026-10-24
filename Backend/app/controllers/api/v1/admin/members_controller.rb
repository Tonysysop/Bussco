module Api
  module V1
    module Admin
      # Read-only directory of registered accounts for the Super Admin (docs/auth/admin-access.md). The system
      # Super Admin is never listed. `stage` is derived from existing data: membership_status plus whether an
      # application exists. Account status (disabled) is separate and never a membership state.
      class MembersController < BaseController
        before_action -> { require_admin_role(:super_admin) }

        PER_PAGE = 25
        STAGES = %w[not_started in_progress awaiting_approval disabled].freeze
        ROLES = %w[member president treasurer].freeze
        STAGE_SQL = {
          "not_started" => "users.membership_status = 'not_started' AND membership_applications.id IS NULL",
          "in_progress" => "users.membership_status = 'not_started' AND membership_applications.id IS NOT NULL",
          "awaiting_approval" => "users.membership_status = 'awaiting_approval'",
          "disabled" => "users.account_status = 'disabled'"
        }.freeze

        # GET ?q=&stage=&role=&page= — counts follow the search and role filter, not the stage tab.
        def index
          q = string_param(params[:q]).to_s.strip
          stage = params[:stage].presence
          role = params[:role].presence
          page = params[:page].presence || "1"
          unless q.length <= 100 && (stage.nil? || stage.in?(STAGES)) && (role.nil? || role.in?(ROLES)) &&
              page.is_a?(String) && page.match?(/\A[1-9]\d{0,5}\z/)
            return render json: { error: "invalid_param" }, status: :unprocessable_content
          end

          scope = User.where(account_type: "member").left_joins(:membership_application)
          scope = scope.where(admin_role: role == "member" ? nil : role) if role
          if q.present?
            # shortcut: sequential ILIKE scan, fine at cooperative size; add a pg_trgm index past ~10k members.
            pattern = "%#{User.sanitize_sql_like(q.downcase)}%"
            scope = scope.where("lower(users.full_name) LIKE :pattern OR users.email LIKE :pattern " \
              "OR lower(membership_applications.sap_staff_id) LIKE :pattern", pattern:)
          end

          counts = %w[all].concat(STAGES).zip(scope.pick(Arel.sql("count(*)"),
            *STAGES.map { Arel.sql("count(*) FILTER (WHERE #{STAGE_SQL.fetch(it)})") })).to_h
          rows = stage ? scope.where(STAGE_SQL.fetch(stage)) : scope
          page = page.to_i
          members = rows.preload(membership_application: :passport_photo_attachment).order(created_at: :desc, id: :desc)
            .offset((page - 1) * PER_PAGE).limit(PER_PAGE)

          render json: { members: members.map { member_json(it) }, counts:, page:, per_page: PER_PAGE,
            total: counts.fetch(stage || "all") }
        end

        # GET /:id/photo — the application's passport photo, for the directory avatar. Never cached by the browser.
        def photo
          application = User.find_by(id: params[:id], account_type: "member")&.membership_application
          return render json: { error: "not_found" }, status: :not_found unless application&.passport_photo&.attached?

          response.set_header("Cache-Control", "private, no-store")
          blob = application.passport_photo.blob
          send_data blob.download, type: blob.content_type, disposition: "inline"
        end

        private

        def member_json(user)
          app = user.membership_application
          { id: user.id, full_name: user.full_name, email: user.email, email_verified: user.email_verified_at?,
            account_status: user.account_status, admin_role: user.admin_role, registered_at: user.created_at,
            photo: !!app&.passport_photo&.attached?,
            stage: if user.awaiting_approval? then "awaiting_approval" elsif app then "in_progress" else "not_started" end,
            # Self-reported by the applicant (a draft until submitted_at); never verified employment data.
            application: app && { sap_staff_id: app.sap_staff_id, business_unit: app.business_unit,
              department: app.department, office_location: app.office_location, started_at: app.created_at,
              submitted_at: app.submitted_at } }
        end
      end
    end
  end
end
