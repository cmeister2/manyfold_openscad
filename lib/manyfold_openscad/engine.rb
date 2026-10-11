# frozen_string_literal: true

module ManyfoldOpenscad
  class Engine < ::Rails::Engine
    engine_name "manyfold_openscad"

    initializer "manyfold_openscad.append_migrations", before: "active_record.initialize_database" do |app|
      next if app.root == root
      paths["db/migrate"].expanded.each { |path| app.config.paths["db/migrate"] << path }
      ActiveSupport.on_load(:active_record) do
        ActiveRecord::Migrator.migrations_paths = app.config.paths["db/migrate"].to_a
      end
    end
  end
end
