# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name = "manyfold_openscad"
  spec.version = "0.0.0"
  spec.authors = ["Max Dymond"]
  spec.license = "AGPL-3.0-only"
  spec.summary = "Browser OpenSCAD Customizer for Manyfold"
  spec.description = "Customize authorized OpenSCAD sources locally and save STL variants with provenance."
  spec.homepage = "https://github.com/cmeister2/manyfold_openscad"
  spec.metadata["manyfold_version"] = ">= 0.150.0"
  spec.files = ["README.md", "LICENSE"] + Dir["app/**/*", "config/**/*", "db/**/*", "lib/**/*", "vendor/**/*", "docs/**/*", "test/fixtures/**/*"]
  spec.require_paths = ["lib"]
end
