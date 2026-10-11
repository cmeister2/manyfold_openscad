# frozen_string_literal: true

module ManyfoldOpenscad
  class BaseController < ::ApplicationController
    protect_from_forgery with: :exception
    before_action :private_response
    rescue_from ManyfoldOpenscad::Error, with: :customizer_error

    private

    def private_response
      response.headers["Cache-Control"] = "private, no-store"
      response.headers["X-Content-Type-Options"] = "nosniff"
    end

    def find_model
      ::Model.find_param(params[:model_id])
    end

    def find_source(model)
      model.model_files.find(params[:source_file_id])
    end

    def customizer_error(error)
      render json: {error: error.message, code: error.code}, status: error.http_status
    end

    def prepare_customizer(model, source_file, variant: nil)
      @model, @source_file, @variant = model, source_file, variant
      @sources = policy_scope(::ModelFile).where(model: model).to_a.select { |file| File.extname(file.filename).downcase == ".scad" }
      @variants = Variant.where(model: model).includes(:model_file, :source_file).select do |entry|
        entry.model_file && policy(entry.model_file).raw? && (!entry.source_file || policy(entry.source_file).raw?)
      end
      source = begin
        Source.read(source_file) if source_file
      rescue ManyfoldOpenscad::Error
        # Keep source failures inside the customizer UI. Its authorized source
        # request will report the size, encoding, or storage error to the form.
        nil
      end
      old_digest = variant&.manifest&.dig("source", "digest")
      @customizer_config = {
        sourceUrl: source_file ? manyfold_openscad.source_model_path(model_id: model.to_param, source_file_id: source_file.id) : nil,
        saveUrl: manyfold_openscad.model_variants_path(model_id: model.to_param),
        modelUrl: main_app.model_path(model),
        source: source_file ? {id: source_file.id, modelId: model.id, filename: source_file.filename, digest: source&.fetch("digest")} : nil,
        sourceDigest: old_digest || source&.fetch("digest"),
        initialParameters: variant&.manifest&.fetch("parameters", {}) || {},
        sourceMismatch: old_digest.present? && source.present? && old_digest != source.fetch("digest"),
        canSave: current_user.present? && policy(model).update?,
        engineBuild: ManyfoldOpenscad.configuration.renderer_build,
        assets: {rendererUrl: manyfold_openscad.asset_path(name: "renderer.js"), workerUrl: manyfold_openscad.asset_path(name: "worker.js"),
                 engineUrl: manyfold_openscad.asset_path(name: "openscad.js"), wasmUrl: manyfold_openscad.asset_path(name: "openscad.wasm"),
                 fontUrl: manyfold_openscad.asset_path(name: "DejaVuSans.ttf")},
        limits: {sourceBytes: ManyfoldOpenscad.configuration.max_source_bytes,
                 outputBytes: ManyfoldOpenscad.configuration.max_output_bytes,
                 timeoutMs: ManyfoldOpenscad.configuration.generation_timeout_ms},
        strings: {}
      }
    end

    def configure_content_security_policy
      super
      customizer_page = controller_path == "manyfold_openscad/customizer" && action_name == "show"
      content_security_policy.script_src "'wasm-unsafe-eval'" if (customizer_page || action_name == "reopen") && request.format.html?
    end
  end
end
