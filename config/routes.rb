# frozen_string_literal: true

ManyfoldOpenscad::Engine.routes.draw do
  get "assets/:name", to: "manyfold_openscad/assets#show", as: :asset, constraints: {name: /[^\/]+/}, format: false
  get "models/:model_id/customize", to: "manyfold_openscad/customizer#show", as: :customize_model
  get "models/:model_id/sources/:source_file_id", to: "manyfold_openscad/customizer#source", as: :source_model
  post "models/:model_id/variants", to: "manyfold_openscad/variants#create", as: :model_variants
  get "variants/:id", to: "manyfold_openscad/variants#show", as: :variant
  get "variants/:id/manifest", to: "manyfold_openscad/variants#manifest", as: :manifest
  get "variants/:id/reopen", to: "manyfold_openscad/variants#reopen", as: :reopen_variant
end
