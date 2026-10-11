# frozen_string_literal: true

module ManyfoldOpenscad
  class VariantsController < BaseController
    def create
      model = find_model
      source_file = find_source(model)
      authorize source_file, :raw?
      authorize model, :update?
      attributes = params.permit(:filename, :source_digest, :parameters, :engine_build,
        :render_options, :generated_at, :stl, :output, :idempotency_key).to_h.symbolize_keys
      variant = SaveVariant.call(model: model, source_file: source_file, user: current_user, attributes: attributes)
      render json: variant_json(variant), status: variant.complete? ? :ok : :accepted
    end

    def show
      variant = authorized_variant
      render json: variant_json(variant), status: variant.complete? ? :ok : :accepted
    end

    def manifest
      variant = authorized_variant
      send_data JSON.pretty_generate(variant.manifest), type: "application/json",
        filename: "#{File.basename(variant.filename, '.*')}.openscad.json", disposition: :attachment
    end

    def reopen
      variant = authorized_variant
      raise Error.new(:source_missing, http_status: :not_found) unless variant.source_file
      prepare_customizer(variant.model, variant.source_file, variant: variant)
      render "manyfold_openscad/customizer/show"
    end

    private

    def authorized_variant
      variant = Variant.find(params[:id])
      raise Error.new(:output_missing, http_status: :not_found) unless variant.model_file
      authorize variant.model_file, :raw?
      if variant.source_file
        authorize variant.source_file, :raw?
      else
        authorize variant.model, :download?
      end
      variant
    end

    def variant_json(variant)
      {
        id: variant.id, status: variant.status, filename: variant.filename,
        model_file_id: variant.model_file_id,
        status_url: manyfold_openscad.variant_path(id: variant.id),
        file_url: variant.complete? && variant.model_file ? main_app.model_model_file_path(variant.model, variant.model_file) : nil,
        manifest_url: manyfold_openscad.manifest_path(id: variant.id),
        reopen_url: manyfold_openscad.reopen_variant_path(id: variant.id),
        error: variant.error ? I18n.t("manyfold_openscad.errors.#{variant.error}") : nil
      }
    end
  end
end
