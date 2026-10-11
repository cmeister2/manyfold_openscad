# frozen_string_literal: true

require "stringio"
require "digest"

module ManyfoldOpenscad
  class SaveVariant
    def self.call(model:, source_file:, user:, attributes:)
      new(model: model, source_file: source_file, user: user, attributes: attributes).call
    end

    def initialize(model:, source_file:, user:, attributes:)
      @model, @source_file, @user, @attributes = model, source_file, user, attributes
    end

    def call
      # Keep the service safe for callers outside the controller too.
      raise Pundit::NotAuthorizedError unless ModelFilePolicy.new(@user, @source_file).raw? && ModelPolicy.new(@user, @model).update?
      raise Error.new(:source_missing, http_status: :not_found) unless @source_file.model_id == @model.id

      filename = safe_filename(@attributes[:filename])
      key = @attributes[:idempotency_key].to_s
      raise Error.new(:invalid_idempotency_key) unless key.match?(/\A[A-Za-z0-9_-]{16,100}\z/)
      source_digest = @attributes[:source_digest].to_s
      raise Error.new(:invalid_source_digest) unless source_digest.match?(/\A[0-9a-f]{64}\z/)
      parameters = Manifest.parameters(@attributes[:parameters])
      options = Manifest.options(@attributes[:render_options])
      build = @attributes[:engine_build].to_s
      raise Error.new(:invalid_engine_build) unless build == ManyfoldOpenscad.configuration.renderer_build
      generated_at = Manifest.generation_time(@attributes[:generated_at])
      stl = StlUpload.new(@attributes[:stl] || @attributes[:output])
      request = {"source_id" => @source_file.id, "source_digest" => source_digest,
                 "parameters" => parameters, "options" => options, "build" => build,
                 "filename" => filename, "output_digest" => stl.digest,
                 "generated_at" => generated_at, "saved_by_user_id" => @user.id}
      request_digest = Digest::SHA256.hexdigest(JSON.generate(Manifest.canonical(request)))

      result = @model.with_lock do
        @source_file.reload
        raise Pundit::NotAuthorizedError unless ModelFilePolicy.new(@user, @source_file).raw? && ModelPolicy.new(@user, @model).update?
        raise Error.new(:source_missing, http_status: :not_found) unless @source_file.model_id == @model.id
        existing = Variant.find_by(model: @model, idempotency_key: key)
        if existing
          raise Error.new(:idempotency_conflict, http_status: :conflict) unless existing.request_digest == request_digest
          retry_promotion(existing, stl) if existing.status == "failed"
          next existing
        end

        source = Source.read(@source_file)
        raise Error.new(:source_changed, http_status: :conflict) unless source.fetch("digest") == source_digest
        if @model.model_files.where("LOWER(filename) = ?", filename.downcase).exists? || @model.library.has_file?(File.join(@model.path, filename))
          raise Error.new(:filename_collision, http_status: :conflict)
        end

        file = @model.model_files.build(filename: filename)
        file.attachment_attacher.assign(StringIO.new(stl.bytes), metadata: {"filename" => filename, "mime_type" => "model/stl"})
        file.save!
        manifest = Manifest.build(source: source, parameters: parameters, engine_build: build,
          options: options, output_digest: stl.digest, filename: filename, file: file,
          user: @user, generated_at: generated_at)
        Variant.create!(model: @model, source_file: @source_file, model_file: file,
          saved_by_user: @user, idempotency_key: key, request_digest: request_digest, manifest: manifest)
      end
      FinalizeVariantJob.perform_later(result.id) unless result.complete?
      result
    rescue ActiveRecord::RecordInvalid
      raise Error.new(:save_failed)
    end

    private

    def safe_filename(value)
      raw = value.to_s.strip
      if raw.empty? || raw.include?("/") || raw.include?("\\") || raw.match?(/[\x00-\x1f\x7f]/)
        raise Error.new(:invalid_filename)
      end
      filename = Zaru.sanitize!(raw)
      unless filename.bytesize.between?(5, 255) && File.extname(filename).downcase == ".stl" && File.basename(filename, ".*").match?(/[^.\s]/)
        raise Error.new(:invalid_filename)
      end
      filename.sub(/\.stl\z/i, ".stl")
    rescue Zaru::Error
      raise Error.new(:invalid_filename)
    end

    def retry_promotion(variant, stl)
      file = variant.model_file
      raise Error.new(:output_missing, http_status: :not_found) unless file&.attachment
      if file.attachment_attacher.cached? || !file.attachment.exists?
        # A failed move may have consumed the old cache entry. This request's
        # fingerprint guarantees the retried bytes belong to the same variant.
        file.attachment_attacher.assign(StringIO.new(stl.bytes), metadata: {"filename" => variant.filename, "mime_type" => "model/stl"})
        file.save!
      end
      variant.update!(status: "pending", error: nil)
    end
  end
end
