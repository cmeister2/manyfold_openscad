# frozen_string_literal: true

require "fileutils"
abort "Disposable browser fixture only" unless ENV["MANYFOLD_OPENSCAD_BROWSER_TEST"] == "1"

expected_host = ENV["OPENSCAD_TEST_HOST_VERSION"].presence
abort "Unexpected Manyfold host version" if expected_host && Rails.application.config.app_version != expected_host

# Only this disposable fixture publishes host capabilities for browser tests.
File.write(Rails.root.join("public", "openscad-browser-host.json"), JSON.generate({
  version: Rails.application.config.app_version,
  slicing: ModelFilePolicy.method_defined?(:slice?) && FileHandlers.handlers_for(environment: :slice, mime_type: "model/stl").any?
}))

admin = User.create!(username: "browser", email: "browser@example.invalid",
  password: SecureRandom.hex(24), approved: true)
admin.add_role(:administrator)
admin.update!(reset_password_token: nil, tour_state: {"completed" => %w[
  main-navbar nav-link-models nav-link-creators nav-link-collections nav-link-upload nav-link-preferences
]})
FileUtils.mkdir_p("/config/models")
library = Library.create!(name: "Browser fixtures", path: "/config/models",
  storage_service: "filesystem", path_template: "{modelName}")
library.make_default

{"customizerbox" => "simple_box.scad", "customizercontrols" => "customizer_box.scad", "customizerempty" => "customizer_empty.scad",
 "customizerdependency" => "customizer_missing_dependency.scad"}.each do |identifier, filename|
  model = Model.create!(name: identifier, public_id: identifier, path: identifier, library: library)
  directory = File.join(library.path, identifier)
  FileUtils.mkdir_p(directory)
  FileUtils.cp(File.join("/plugins/manyfold_openscad/test/fixtures", filename), File.join(directory, filename))
  model.model_files.create!(filename: filename)
end
