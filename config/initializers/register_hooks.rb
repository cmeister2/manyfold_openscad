# frozen_string_literal: true

Rails.application.config.after_initialize do
  PluginManager.register(:model_menu, Components::ManyfoldOpenscad::ModelMenu)
end
