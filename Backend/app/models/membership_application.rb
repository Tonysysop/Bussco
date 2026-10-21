# A user's five-stage membership application (docs/membership/application.md). Drafts may be
# partial: values are checked when present, and completeness only on submit (context :submit).
# Submitting never approves membership.
class MembershipApplication < ApplicationRecord
  MINIMUM_MONTHLY_CONTRIBUTION_KOBO = 3_000_000 # ₦30,000
  # Shown to applicants only; this increment never stores or collects it.
  REGISTRATION_FEE_KOBO = 1_000_000 # ₦10,000

  # Editable fields per stage; the controller permits exactly these (stage 5 is the submission).
  STAGES = {
    "employment" => %w[sap_staff_id business_unit department office_location],
    "personal" => %w[primary_phone secondary_phone date_of_birth sex marital_status nationality home_address],
    "next_of_kin" => %w[next_of_kin_name next_of_kin_relationship next_of_kin_phone next_of_kin_address],
    "savings" => %w[monthly_contribution_kobo contribution_start_date]
  }.freeze
  OPTIONAL = %w[secondary_phone next_of_kin_phone].freeze
  TEXT_LIMITS = {
    "business_unit" => 120, "department" => 120, "office_location" => 200, "nationality" => 60, "sex" => 30,
    "marital_status" => 30, "home_address" => 300, "next_of_kin_name" => 120, "next_of_kin_relationship" => 50,
    "next_of_kin_address" => 300
  }.freeze
  ADDRESSES = %w[home_address next_of_kin_address office_location].freeze
  PHONES = %w[primary_phone secondary_phone next_of_kin_phone].freeze
  DATES = %w[date_of_birth contribution_start_date].freeze

  PHOTO_MAX_BYTES = 2.megabytes
  PHOTO_SIGNATURES = { "\xFF\xD8\xFF".b => "image/jpeg", "\x89PNG\r\n\x1A\n".b => "image/png" }.freeze

  # Append-only: a version's text never changes once accepted by anyone (a test pins each digest).
  # A new wording gets a new version; production accepts only approved ones.
  DECLARATIONS = {
    "draft-v1" => {
      approved: false, # DRAFT — Pending Legal Approval
      text: "I confirm that the information provided in my membership application is accurate to the best of my " \
        "knowledge. I understand that submitting this application does not automatically make me an approved " \
        "member of BUSSCO and that my application is subject to review and approval. I acknowledge the proposed " \
        "monthly savings contribution entered in my application. I understand that any applicable registration " \
        "fee and payroll deduction arrangements will be governed by BUSSCO's approved policies."
    }.freeze
  }.freeze

  belongs_to :user
  has_one_attached :passport_photo

  # Unicode-aware trim (as User#full_name); blank becomes nil so a draft field can be cleared.
  normalizes(*TEXT_LIMITS.keys, :sap_staff_id, with: ->(value) { value.gsub(/\A[[:space:]]+|[[:space:]]+\z/, "").presence })
  normalizes(*PHONES, with: ->(value) { value.gsub(/[[:space:]().-]/, "").presence })

  TEXT_LIMITS.each { |field, limit| validates field, length: { maximum: limit }, allow_nil: true }
  validates :sap_staff_id, format: { with: %r{\A[A-Za-z0-9/-]{1,30}\z} }, allow_nil: true
  validates(*PHONES, format: { with: /\A\+?[0-9]{7,15}\z/ }, allow_nil: true)
  validates :monthly_contribution_kobo, numericality: { only_integer: true, greater_than_or_equal_to: MINIMUM_MONTHLY_CONTRIBUTION_KOBO },
    allow_nil: true
  validate :no_control_characters, :dates_well_formed, :passport_photo_acceptable

  validates(*(STAGES.values.flatten - OPTIONAL), presence: true, on: :submit)
  validate :passport_photo_attached, :contribution_starts_next_month_or_later, on: :submit

  # Once submitted, only a future authorised review process may change the record (deleting the user still works).
  before_update { raise ActiveRecord::ReadOnlyRecord, "submitted application" if submitted_at_in_database }

  # The version applicants accept now, or nil while none may be used (production needs an approved one).
  def self.current_declaration(version = Rails.configuration.x.membership_declaration_version, production: Rails.env.production?)
    declaration = DECLARATIONS[version]
    { version:, **declaration } if declaration && (declaration[:approved] || !production)
  end

  # Type comes from the file's own first bytes, never from the client's filename or Content-Type.
  def passport_photo_file=(file)
    head = file.read(8).to_s.b
    file.rewind
    type = PHOTO_SIGNATURES.find { |signature, _| head.start_with?(signature) }&.last
    # Saving the attachment touches this row in the same transaction: a versioned UPDATE, so a stale
    # upload raises StaleObjectError and rolls back like any other write.
    self.passport_photo = { io: file, filename: "passport-photo", content_type: type, identify: false }
  end

  # Atomic: the application and the user's membership_status change together or not at all.
  def submit(declaration_version)
    now = Time.current
    assign_attributes(declaration_version:, declaration_accepted_at: now, submitted_at: now)
    transaction do
      save(context: :submit) or raise ActiveRecord::Rollback
      user.update!(membership_status: :awaiting_approval)
      true
    end.tap { restore_attributes(%w[declaration_version declaration_accepted_at submitted_at]) unless it }
  end

  def submitted? = submitted_at.present?

  # Per stage, the fields that still block submission.
  def missing_fields
    valid?(:submit)
    fields_with_errors.tap { errors.clear }
  end

  def fields_with_errors = progress_fields.transform_values { |fields| fields & errors.attribute_names.map(&:to_s) }

  def progress
    missing = missing_fields
    {
      stages: missing.transform_values { it.empty? ? "complete" : "incomplete" },
      current_stage: missing.find { |_, fields| fields.any? }&.first || "review",
      ready_to_submit: missing.values.all?(&:empty?),
      missing:
    }
  end

  def progress_fields = STAGES.merge("personal" => STAGES["personal"] + %w[passport_photo])

  private

  def no_control_characters
    TEXT_LIMITS.each_key do |field|
      pattern = ADDRESSES.include?(field) ? /[[:cntrl:]&&[^\r\n]]/ : /[[:cntrl:]]/
      errors.add(field, :invalid) if self[field]&.match?(pattern)
    end
  end

  # Active Record silently casts an unparseable date to nil, so check the raw input: ISO dates only.
  def dates_well_formed
    DATES.each do |field|
      raw = read_attribute_before_type_cast(field)
      next if raw.nil? || raw.is_a?(Date)

      errors.add(field, :invalid) unless raw.is_a?(String) && raw.match?(/\A\d{4}-\d{2}-\d{2}\z/) && self[field]
    end
    errors.add(:date_of_birth, "must be in the past") if date_of_birth && !date_of_birth.before?(Date.current)
    errors.add(:date_of_birth, :invalid) if date_of_birth&.before?(Date.new(1900, 1, 1))
    errors.add(:contribution_start_date, "must be the first day of a month") if contribution_start_date && contribution_start_date.day != 1
  end

  def passport_photo_acceptable
    return unless attachment_changes["passport_photo"]

    blob = passport_photo.blob
    errors.add(:passport_photo, "must be a JPG or PNG image") unless PHOTO_SIGNATURES.value?(blob.content_type)
    errors.add(:passport_photo, "must be 2 MB or smaller") if blob.byte_size > PHOTO_MAX_BYTES
  end

  def passport_photo_attached
    errors.add(:passport_photo, :blank) unless passport_photo.attached?
  end

  def contribution_starts_next_month_or_later
    return unless contribution_start_date

    earliest = Date.current.next_month.beginning_of_month
    errors.add(:contribution_start_date, "must be #{earliest.iso8601} or later") if contribution_start_date.before?(earliest)
  end
end
