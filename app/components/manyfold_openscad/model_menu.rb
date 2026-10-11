# frozen_string_literal: true

module Components::ManyfoldOpenscad
  class ModelMenu < Components::Base
    def initialize(model:)
      @model = model
    end

    def view_template
      return unless @model.model_files.any? { |file| file.extension.to_s.downcase == "scad" && policy(file).show? }

      a(href: view_context.manyfold_openscad.customize_model_path(model_id: @model.to_param),
        class: "dropdown-item", role: "menuitem", rel: "nofollow") do
        Icon(icon: "sliders", label: t("manyfold_openscad.customize"))
        whitespace
        span { t("manyfold_openscad.customize") }
      end
    end
  end
end
