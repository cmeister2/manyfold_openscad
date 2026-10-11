# frozen_string_literal: true

module ManyfoldOpenscad
  class Variant < ::ApplicationRecord
    self.table_name = "manyfold_openscad_variants"

    belongs_to :model, class_name: "::Model"
    belongs_to :source_file, class_name: "::ModelFile", optional: true
    belongs_to :model_file, class_name: "::ModelFile", optional: true
    belongs_to :saved_by_user, class_name: "::User", optional: true
    serialize :manifest, coder: CrossDbJsonSerializer

    validates :idempotency_key, presence: true, length: {maximum: 100}, uniqueness: {scope: :model_id}
    validates :request_digest, presence: true
    validates :status, inclusion: {in: %w[pending complete failed]}

    def filename
      manifest.dig("output", "filename")
    end

    def complete?
      status == "complete"
    end
  end
end
