# frozen_string_literal: true

module ManyfoldOpenscad
  class FinalizeVariantJob < ::ApplicationJob
    queue_as :critical
    PROMOTION_TIMEOUT = 10.minutes

    def perform(variant_id)
      variant = Variant.find(variant_id)
      retry_later = false
      variant.with_lock do
        return if variant.complete? || variant.status == "failed"
        file = variant.model_file&.reload
        unless file&.attachment
          variant.update!(status: "failed", error: "output_missing")
          return
        end
        if file.attachment_attacher.cached?
          if variant.updated_at < PROMOTION_TIMEOUT.ago
            variant.update!(status: "failed", error: "promotion_failed")
          else
            retry_later = true
          end
        elsif file.attachment.exists?
          file.parse_metadata_later
          variant.model.check_for_problems_later
          variant.update!(status: "complete", error: nil, processing_started_at: Time.current)
        else
          variant.update!(status: "failed", error: "promotion_failed")
        end
      end
      self.class.set(wait: 2.seconds).perform_later(variant.id) if retry_later
    rescue Shrine::FileNotFound, IOError, SystemCallError => error
      Rails.logger.warn("OpenSCAD variant promotion check failed: #{error.class}")
      variant&.update!(status: "failed", error: "promotion_failed")
    end
  end
end
