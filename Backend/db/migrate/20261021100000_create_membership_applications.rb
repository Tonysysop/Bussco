# Five-stage membership application (docs/membership/application.md). Every stage column is
# nullable so drafts can be partial; the completeness check only binds once submitted_at is set.
class CreateMembershipApplications < ActiveRecord::Migration[8.1]
  TEXT_LIMITS = {
    business_unit: 120, department: 120, office_location: 200, nationality: 60, sex: 30,
    marital_status: 30, home_address: 300, next_of_kin_name: 120, next_of_kin_relationship: 50,
    next_of_kin_address: 300
  }.freeze
  PHONES = %i[primary_phone secondary_phone next_of_kin_phone].freeze
  REQUIRED = %i[
    sap_staff_id business_unit department office_location primary_phone date_of_birth sex
    marital_status nationality home_address next_of_kin_name next_of_kin_relationship
    next_of_kin_address monthly_contribution_kobo contribution_start_date declaration_version
    declaration_accepted_at
  ].freeze

  def change
    create_table :membership_applications do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }, index: { unique: true }

      t.string :sap_staff_id
      t.string :business_unit
      t.string :department
      t.string :office_location

      t.string :primary_phone
      t.string :secondary_phone
      t.date :date_of_birth
      t.string :sex
      t.string :marital_status
      t.string :nationality
      t.text :home_address

      t.string :next_of_kin_name
      t.string :next_of_kin_relationship
      t.string :next_of_kin_phone
      t.text :next_of_kin_address

      t.bigint :monthly_contribution_kobo
      t.date :contribution_start_date

      t.string :declaration_version
      t.datetime :declaration_accepted_at
      t.datetime :submitted_at

      t.integer :lock_version, null: false, default: 0
      t.timestamps

      TEXT_LIMITS.each do |column, limit|
        t.check_constraint "#{column} IS NULL OR (char_length(#{column}) BETWEEN 1 AND #{limit} AND #{column} !~ '^\\s|\\s$')",
          name: "membership_applications_#{column}_format"
      end
      PHONES.each do |column|
        t.check_constraint "#{column} IS NULL OR #{column} ~ '^\\+?[0-9]{7,15}$'", name: "membership_applications_#{column}_format"
      end
      t.check_constraint "sap_staff_id IS NULL OR sap_staff_id ~ '^[A-Za-z0-9/-]{1,30}$'",
        name: "membership_applications_sap_staff_id_format"
      t.check_constraint "monthly_contribution_kobo IS NULL OR monthly_contribution_kobo > 0",
        name: "membership_applications_monthly_contribution_positive"
      t.check_constraint "contribution_start_date IS NULL OR EXTRACT(DAY FROM contribution_start_date) = 1",
        name: "membership_applications_contribution_start_first_of_month"
      t.check_constraint "submitted_at IS NULL OR (#{REQUIRED.map { "#{it} IS NOT NULL" }.join(' AND ')})",
        name: "membership_applications_submitted_complete"
    end

    reversible do |dir|
      dir.up do
        remove_check_constraint :users, name: "users_membership_status_allowed"
        add_check_constraint :users, "membership_status IN ('not_started', 'awaiting_approval')",
          name: "users_membership_status_allowed"
      end
      dir.down do
        remove_check_constraint :users, name: "users_membership_status_allowed"
        add_check_constraint :users, "membership_status = 'not_started'", name: "users_membership_status_allowed"
      end
    end
  end
end
