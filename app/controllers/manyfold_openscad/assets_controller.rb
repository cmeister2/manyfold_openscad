# frozen_string_literal: true

module ManyfoldOpenscad
  # These immutable public assets contain no model or account data.
  class AssetsController < ActionController::Base
    skip_forgery_protection
    ASSETS = {
      "customizer.css" => ["app/assets/manyfold_openscad", "text/css"],
      "customizer.mjs" => ["app/assets/manyfold_openscad", "text/javascript"],
      "preview.mjs" => ["app/assets/manyfold_openscad", "text/javascript"],
      "renderer.js" => ["app/assets/manyfold_openscad", "text/javascript"],
      "worker.js" => ["app/assets/manyfold_openscad", "text/javascript"],
      "parameters.js" => ["app/assets/manyfold_openscad", "text/javascript"],
      "openscad.js" => ["vendor/openscad", "text/javascript"],
      "openscad.wasm" => ["vendor/openscad", "application/wasm"],
      "DejaVuSans.ttf" => ["vendor/openscad", "font/ttf"]
    }.freeze

    def show
      entry = ASSETS[params[:name]]
      return head :not_found unless entry
      path = Engine.root.join(entry.first, params[:name])
      return head :not_found unless path.file?
      response.headers["X-Content-Type-Options"] = "nosniff"
      response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
      # Worker CSP allows compilation only; fetching remains restricted to this installation.
      if params[:name] == "worker.js"
        response.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"
      end
      send_file path, type: entry.last, disposition: :inline
    end
  end
end
