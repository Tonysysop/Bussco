module Api
  module V1
    module Admin
      # Super Admin management of President and Treasurer (docs/auth/admin-access.md). The role and the
      # actor come from the database and the session; the browser only names a target and an office.
      class AdministratorsController < BaseController
        before_action -> { require_admin_role(:super_admin) }

        OFFICES = %w[president treasurer].freeze

        def index
          admins = User.where.not(admin_role: nil).order(:full_name, :id)
          render json: { administrators: admins.map { administrator_json(it) } }
        end

        # Accounts that may be given an office: active, verified members with no admin role.
        def eligible
          q = string_param(params[:q]).to_s.strip
          return render json: { accounts: [] } if q.length < 2

          pattern = "%#{User.sanitize_sql_like(q.downcase)}%"
          accounts = User.where(account_type: "member", account_status: "active", admin_role: nil)
            .where.not(email_verified_at: nil)
            .where("lower(full_name) LIKE :pattern OR email LIKE :pattern", pattern:)
            .order(:full_name, :id).limit(10)
          render json: { accounts: accounts.map { administrator_json(it) } }
        end

        # { role: "president" | "treasurer" } assigns or switches office (demoting its holder);
        # { role: null } revokes. The Super Admin never manages itself or the system account.
        def update
          # A missing key is rejected rather than read as null, so an empty body can't revoke.
          role = params[:role]
          unless params.key?(:role) && (role.nil? || role.in?(OFFICES))
            return render json: { error: "invalid_role" }, status: :unprocessable_content
          end

          user = User.find_by(id: params[:id])
          return render json: { error: "not_found" }, status: :not_found unless user
          return render json: { error: "not_allowed" }, status: :unprocessable_content if user == current_admin || !user.member?
          return render json: { error: "not_eligible" }, status: :unprocessable_content if role && !(user.active? && user.email_verified_at?)

          changed = role ? user.assign_admin_office!(role, by: current_admin) : user.change_admin_role!(nil, by: current_admin, action: :revoke)
          render json: { administrator: administrator_json(user.reload), changed: }
        rescue ActiveRecord::RecordNotUnique, ActiveRecord::Deadlocked, ActiveRecord::RecordInvalid, User::ProvisioningError
          render json: { error: "conflict" }, status: :conflict
        end

        private

        def administrator_json(user)
          { id: user.id, full_name: user.full_name, email: user.email, admin_role: user.admin_role,
            account_status: user.account_status }
        end
      end
    end
  end
end
