# frozen_string_literal: true

module ManyfoldOpenscad
  class CustomizerController < BaseController
    def show
      model = find_model
      authorize model, :show?
      source_file = if params[:source_file_id].present?
        find_source(model).tap { |file| authorize file, :raw? }
      else
        policy_scope(::ModelFile).where(model: model).to_a.select { |file| File.extname(file.filename).downcase == ".scad" }.then { |files| files.first if files.one? }
      end
      authorize source_file, :raw? if source_file
      prepare_customizer(model, source_file)
    end

    def source
      model = find_model
      source_file = find_source(model)
      authorize source_file, :raw?
      render json: Source.read(source_file)
    end
  end
end
