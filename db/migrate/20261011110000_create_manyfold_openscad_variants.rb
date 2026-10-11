# frozen_string_literal: true

class CreateManyfoldOpenscadVariants < ActiveRecord::Migration[8.0]
  def change
    create_table :manyfold_openscad_variants do |table|
      table.references :model, null: false, foreign_key: {on_delete: :cascade}
      table.references :source_file, foreign_key: {to_table: :model_files, on_delete: :nullify}
      table.references :model_file, foreign_key: {on_delete: :nullify}
      table.references :saved_by_user, foreign_key: {to_table: :users, on_delete: :nullify}
      table.string :idempotency_key, limit: 100, null: false
      table.string :request_digest, limit: 64, null: false
      table.string :status, null: false, default: "pending"
      table.json :manifest, null: false
      table.text :error
      table.datetime :processing_started_at
      table.timestamps
    end
    add_index :manyfold_openscad_variants, [:model_id, :idempotency_key], unique: true,
      name: "index_openscad_variants_idempotency"
  end
end
