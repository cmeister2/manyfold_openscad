# frozen_string_literal: true

require "fileutils"

# Run after local-setup.rb inside the development container. Existing examples
# and their source files are left untouched, including changes made in the UI.
library = Library.default
raise "Run docker/local-setup.rb first to create the development library" unless library
raise "The development examples require a filesystem library" unless library.storage_service == "filesystem"

examples = [
  {public_id: "openscadbox", name: "OpenSCAD simple box", filename: "simple_box.scad"},
  {public_id: "openscadcontrols", name: "OpenSCAD customizer box", filename: "customizer_box.scad"}
]
fixture_directory = File.expand_path("../test/fixtures", __dir__)

# Check all inputs before creating anything in the development library.
examples.each do |example|
  raise "Missing example fixture: #{example[:filename]}" unless File.file?(File.join(fixture_directory, example[:filename]))
end

examples.each do |example|
  model = Model.find_by(public_id: example[:public_id])
  unless model
    model_path = example[:public_id]
    if library.models.exists?(path: model_path)
      raise "A model already uses #{model_path}; leaving it unchanged"
    end

    directory = File.join(library.path, model_path)
    FileUtils.mkdir_p(directory)
    destination = File.join(directory, example[:filename])
    begin
      File.open(destination, File::WRONLY | File::CREAT | File::EXCL) do |file|
        file.binmode
        file.write(File.binread(File.join(fixture_directory, example[:filename])))
      end
    rescue Errno::EEXIST
      # Preserve source edits if a previous import stopped before model creation.
    end

    model = library.models.create!(public_id: example[:public_id], name: example[:name], path: model_path)
    source = model.model_files.create!(filename: example[:filename])
    source.parse_metadata_later
    model.parse_metadata_later
  end

  puts "#{model.name}: /manyfold_openscad/models/#{model.to_param}/customize"
end

# Keep the development demo unobstructed while preserving unrelated preferences.
admin = User.with_role(:administrator).find_by(username: "developer")
if admin
  state = (admin.tour_state || User::DEFAULT_TOUR_STATE).deep_dup
  navbar_tours = %w[main-navbar nav-link-models nav-link-creators nav-link-collections nav-link-upload nav-link-preferences]
  completed = Array(state["completed"]) | navbar_tours
  if state["completed"] != completed
    state["completed"] = completed
    admin.update!(tour_state: state)
  end
end
