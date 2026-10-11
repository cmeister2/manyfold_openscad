# frozen_string_literal: true

abort "Run with test/run-container in its disposable Manyfold installation." unless ENV["MANYFOLD_OPENSCAD_TEST"] == "1" && defined?(Rails.application)

require "minitest/autorun"
require "action_dispatch/testing/integration"
require "active_job/queue_adapters/test_adapter"
require "warden/test/helpers"
require "nokogiri"
require "tmpdir"
require "fileutils"
require "shrine/storage/memory"

ActiveJob::Base.queue_adapter = :test
Warden.test_mode!

class OpenscadBackendTest < Minitest::Test
  include Warden::Test::Helpers

  SOURCE = "/* [Dimensions] */\n// Box width\nwidth = 100; // [10:1:200]\ncube([width, 20, 10]);\n"

  def setup
    @path = Dir.mktmpdir("openscad-backend-")
    @library = Library.create!(name: "OpenSCAD test", path: @path, storage_service: "filesystem", path_template: "{modelName}")
    @users = [:member, :member, :administrator].map do |role|
      identifier = SecureRandom.hex(8)
      User.create!(username: "openscad-#{identifier}", email: "#{identifier}@example.invalid",
        password: "Local-test-#{SecureRandom.hex(16)}", approved: true).tap { |user| user.add_role(role) }
    end
    @model = Model.create!(name: "Customizable box", library: @library, path: SecureRandom.uuid,
      owner: @users.first, permission_preset: :private)
    @model.grant_permission_to("view", @users[1])
    FileUtils.mkdir_p(File.join(@path, @model.path))
    File.binwrite(File.join(@path, @model.path, "box.scad"), SOURCE)
    @source = @model.model_files.create!(filename: "box.scad")
    @original_csrf = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    @configuration = ManyfoldOpenscad.configuration
    @original_limits = [@configuration.max_source_bytes, @configuration.max_output_bytes]
    ActiveJob::Base.queue_adapter.enqueued_jobs.clear
  end

  def teardown
    Warden.test_reset!
    ManyfoldOpenscad::Variant.where(model: @model).delete_all if @model
    @model&.destroy!
    @library&.destroy!
    @users&.each(&:destroy!)
    ActionController::Base.allow_forgery_protection = @original_csrf
    @configuration.max_source_bytes, @configuration.max_output_bytes = @original_limits
    FileUtils.remove_entry(@path) if @path && File.exist?(@path)
    ActiveJob::Base.queue_adapter.enqueued_jobs.clear
  end

  def test_engine_installs_migration_and_menu_in_real_host
    assert_kind_of Rails::Engine, ManyfoldOpenscad::Engine.instance
    assert ManyfoldOpenscad::Variant.table_exists?
    assert_includes PluginManager.components_for(:model_menu), Components::ManyfoldOpenscad::ModelMenu
    session = browser(@users.first)
    session.get("/models/#{@model.to_param}")
    assert_equal 200, session.response.status
    hrefs = Nokogiri::HTML(session.response.body).css("a[href]").map { |link| link["href"] }
    assert_includes hrefs, page_url
  end

  def test_authorized_page_csp_local_assets_and_prefix
    session = browser(@users.first)
    session.get(page_url)
    assert_equal 200, session.response.status
    config = page_config(session)
    assert_equal true, config.fetch("canSave")
    assert_equal @source.id, config.fetch("source").fetch("id")
    assert_equal Digest::SHA256.hexdigest(SOURCE), config.fetch("source").fetch("digest")
    assert_includes session.response.headers.fetch("Content-Security-Policy"), "'wasm-unsafe-eval'"
    assert_includes session.response.headers.fetch("Cache-Control"), "no-store"
    module_script = Nokogiri::HTML(session.response.body).at_css('script[type="module"][src*="/assets/customizer"]')
    refute_nil module_script
    assert_equal "/manyfold_openscad/assets/customizer.mjs", module_script["src"]
    ["rendererUrl", "workerUrl", "engineUrl", "wasmUrl", "fontUrl"].each do |key|
      assert_match %r{\A/manyfold_openscad/assets/}, config.fetch("assets").fetch(key)
    end
    session.get(page_url, env: {"SCRIPT_NAME" => "/manyfold"})
    assert_equal 200, session.response.status
    assert_match %r{\A/manyfold/manyfold_openscad/}, page_config(session).fetch("sourceUrl")
    session.get("/models/#{@model.to_param}")
    refute_includes session.response.headers.fetch("Content-Security-Policy"), "wasm-unsafe-eval"
  end

  def test_public_asset_mimes_and_allowlist
    session = ActionDispatch::Integration::Session.new(Rails.application)
    {"worker.js" => "text/javascript", "openscad.wasm" => "application/wasm", "DejaVuSans.ttf" => "font/ttf"}.each do |name, type|
      session.get("/manyfold_openscad/assets/#{name}")
      assert_equal 200, session.response.status
      assert_includes session.response.headers.fetch("Content-Type"), type
      assert_equal "nosniff", session.response.headers.fetch("X-Content-Type-Options")
      assert_includes session.response.headers.fetch("Content-Security-Policy"), "connect-src 'self'" if name == "worker.js"
    end
    session.get("/manyfold_openscad/assets/Gemfile")
    assert_equal 404, session.response.status
  end

  def test_source_reads_use_attachment_abstraction_including_object_storage
    session = browser(@users[1])
    session.get(source_url)
    assert_equal 200, session.response.status
    assert_equal SOURCE, json(session).fetch("content")
    assert_includes session.response.headers.fetch("Cache-Control"), "no-store"
    memory = Shrine::Storage::Memory.new
    ModelFileUploader.storages[:openscad_test_object] = memory
    uploaded = ModelFileUploader.upload(StringIO.new(SOURCE), :openscad_test_object,
      metadata: {"filename" => "box.scad"})
    @source.attachment_attacher.set(uploaded)
    @source.save!
    File.unlink(File.join(@path, @model.path, "box.scad"))
    assert_equal SOURCE, ManyfoldOpenscad::Source.read(@source).fetch("content")
  ensure
    ModelFileUploader.storages.delete(:openscad_test_object)
  end

  def test_read_permission_is_checked_on_every_source_request
    session = browser(@users[1])
    session.get(source_url)
    assert_equal 200, session.response.status
    @model.revoke_all_permissions(@users[1])
    session.get(source_url)
    assert_equal 404, session.response.status
    session.get(page_url)
    assert_equal 404, session.response.status
  end

  def test_read_only_user_can_customize_but_cannot_save
    session = browser(@users[1])
    session.get(page_url)
    assert_equal 200, session.response.status
    assert_equal false, page_config(session).fetch("canSave")
    refute Nokogiri::HTML(session.response.body).at_css("[data-save]")
    post_variant(session)
    assert_equal 404, session.response.status
    assert_empty ManyfoldOpenscad::Variant.where(model: @model)
  end

  def test_save_requires_csrf_and_edit_access_after_page_load
    session = browser(@users.first)
    session.get(page_url)
    post_variant(session, csrf: false)
    assert_equal 422, session.response.status
    assert_empty ManyfoldOpenscad::Variant.where(model: @model)
    @model.revoke_all_permissions(@users.first)
    post_variant(session)
    assert_equal 404, session.response.status
    assert_empty ManyfoldOpenscad::Variant.where(model: @model)
  end

  def test_save_records_typed_manifest_and_waits_for_promotion_then_normal_processing
    session = browser(@users.first)
    session.get(page_url)
    source_before = File.binread(File.join(@path, @model.path, "box.scad"))
    post_variant(session)
    assert_equal 202, session.response.status, session.response.body
    payload = json(session)
    assert_equal "pending", payload.fetch("status")
    assert_nil payload.fetch("file_url")
    variant = ManyfoldOpenscad::Variant.find(payload.fetch("id"))
    assert variant.model_file.attachment_attacher.cached?
    manifest = variant.manifest
    assert_equal 1, manifest.fetch("schema_version")
    assert_equal typed_parameters, manifest.fetch("parameters")
    assert_equal @source.id, manifest.dig("source", "file_id")
    assert_equal @model.id, manifest.dig("source", "model_id")
    assert_equal @users.first.id, manifest.fetch("saved_by_user_id")
    assert_equal Digest::SHA256.hexdigest(binary_stl), manifest.dig("output", "digest")
    assert_equal "client_submitted", manifest.fetch("provenance")
    ManyfoldOpenscad::FinalizeVariantJob.perform_now(variant.id)
    assert_equal "pending", variant.reload.status
    refute ActiveJob::Base.queue_adapter.enqueued_jobs.any? { |job| job[:job] == Scan::ModelFile::ParseMetadataJob }

    promote(variant)
    problem_checks = []
    with_problem_check_counter(problem_checks) { ManyfoldOpenscad::FinalizeVariantJob.perform_now(variant.id) }
    assert_equal "complete", variant.reload.status
    assert variant.model_file.reload.attachment.exists?
    assert_equal binary_stl, File.binread(File.join(@path, @model.path, "box-wide.stl"))
    jobs = ActiveJob::Base.queue_adapter.enqueued_jobs.map { |job| job[:job] }
    assert_includes jobs, Scan::ModelFile::ParseMetadataJob
    assert_includes problem_checks, @model.id
    assert variant.processing_started_at
    assert_equal source_before, File.binread(File.join(@path, @model.path, "box.scad"))
    session.get(payload.fetch("status_url"))
    assert_equal 200, session.response.status
    assert_equal "complete", json(session).fetch("status")
    assert_match %r{/models/.+/model_files/.+}, json(session).fetch("file_url")
    session.get(payload.fetch("manifest_url"))
    assert_equal 200, session.response.status
    assert_equal manifest, json(session)
    assert_includes session.response.headers.fetch("Content-Disposition"), "box-wide.openscad.json"
    session.get(payload.fetch("reopen_url"))
    assert_equal 200, session.response.status
    assert_equal typed_parameters, page_config(session).fetch("initialParameters")
    assert_equal false, page_config(session).fetch("sourceMismatch")
  end

  def test_repeated_save_is_idempotent_and_reusing_key_with_other_contents_conflicts
    session = browser(@users.first)
    session.get(page_url)
    key = SecureRandom.uuid
    post_variant(session, overrides: {idempotency_key: key})
    id = json(session).fetch("id")
    post_variant(session, overrides: {idempotency_key: key})
    assert_equal 202, session.response.status
    assert_equal id, json(session).fetch("id")
    assert_equal 1, ManyfoldOpenscad::Variant.where(model: @model).count
    assert_equal 2, @model.model_files.count
    post_variant(session, overrides: {idempotency_key: key, filename: "another.stl"})
    assert_equal 409, session.response.status
    assert_equal "idempotency_conflict", json(session).fetch("code")
  end

  def test_filename_collision_and_unsafe_paths_never_overwrite_existing_file
    session = browser(@users.first)
    session.get(page_url)
    path = File.join(@path, @model.path, "box-wide.stl")
    File.binwrite(path, "Existing file")
    @model.model_files.create!(filename: "box-wide.stl")
    post_variant(session)
    assert_equal 409, session.response.status
    assert_equal "filename_collision", json(session).fetch("code")
    assert_equal "Existing file", File.binread(path)
    %w[../outside.stl outside/box.stl C:\\box.stl box.scad].each do |filename|
      post_variant(session, overrides: {filename: filename})
      assert_equal 422, session.response.status, filename
      assert_equal "invalid_filename", json(session).fetch("code")
    end
    assert_empty ManyfoldOpenscad::Variant.where(model: @model)
  end

  def test_changed_source_blocks_save_and_reopen_flags_old_revision
    session = browser(@users.first)
    session.get(page_url)
    post_variant(session)
    assert_equal 202, session.response.status
    payload = json(session)
    File.binwrite(File.join(@path, @model.path, "box.scad"), SOURCE.sub("100", "120"))
    post_variant(session, overrides: {filename: "second.stl"})
    assert_equal 409, session.response.status
    assert_equal "source_changed", json(session).fetch("code")
    session.get(payload.fetch("reopen_url"))
    assert_equal 200, session.response.status
    assert_equal true, page_config(session).fetch("sourceMismatch")
    assert_equal typed_parameters, page_config(session).fetch("initialParameters")
    @model.revoke_all_permissions(@users.first)
    session.get(payload.fetch("manifest_url"))
    assert_equal 404, session.response.status
    session.get(payload.fetch("status_url"))
    assert_equal 404, session.response.status
  end

  def test_failed_promotion_can_retry_the_same_geometry_and_variant
    session = browser(@users.first)
    session.get(page_url)
    key = SecureRandom.uuid
    post_variant(session, overrides: {idempotency_key: key})
    variant = ManyfoldOpenscad::Variant.find(json(session).fetch("id"))
    variant.update_columns(updated_at: 11.minutes.ago)
    ManyfoldOpenscad::FinalizeVariantJob.perform_now(variant.id)
    assert_equal "failed", variant.reload.status
    variant.model_file.attachment.delete
    post_variant(session, overrides: {idempotency_key: key})
    assert_equal 202, session.response.status
    assert_equal variant.id, json(session).fetch("id")
    assert_equal "pending", variant.reload.status
    promote(variant)
    ManyfoldOpenscad::FinalizeVariantJob.perform_now(variant.id)
    assert_equal "complete", variant.reload.status
    assert_equal 1, ManyfoldOpenscad::Variant.where(model: @model).count
  end

  def test_manifest_restrictions_follow_generated_file_and_original_source
    session = browser(@users.first)
    session.get(page_url)
    post_variant(session)
    payload = json(session)
    @model.revoke_all_permissions(@users.first)
    @model.grant_permission_to("preview", @users.first)
    variant = ManyfoldOpenscad::Variant.find(payload.fetch("id"))
    variant.model_file.update!(previewable: true)
    # Output remains previewable; inaccessible source still blocks provenance.
    session.get(payload.fetch("manifest_url"))
    assert_equal 404, session.response.status
    session.get(payload.fetch("reopen_url"))
    assert_equal 404, session.response.status
  end

  def test_size_limits_and_parameter_types_reject_invalid_payloads
    session = browser(@users.first)
    session.get(page_url)
    @configuration.max_source_bytes = 10
    session.get(source_url)
    assert_equal 422, session.response.status
    assert_equal "source_too_large", json(session).fetch("code")
    @configuration.max_source_bytes = @original_limits.first
    session.get(page_url)
    @configuration.max_output_bytes = 100
    post_variant(session)
    assert_equal 422, session.response.status
    assert_equal "output_too_large", json(session).fetch("code")
    @configuration.max_output_bytes = @original_limits.last
    ['{"width":{"expression":"1+2"}}', '{"width":null}', '{"width":[1,"2"]}', '{"invalid name":10}'].each do |parameters|
      post_variant(session, overrides: {parameters: parameters})
      assert_equal 422, session.response.status
      assert_equal "invalid_parameters", json(session).fetch("code")
    end
    ["not an STL", "solid empty\nendsolid empty\n", binary_stl.sub([1].pack("V"), [2].pack("V"))].each do |bytes|
      post_variant(session, bytes: bytes)
      assert_equal 422, session.response.status
      assert_equal "invalid_stl", json(session).fetch("code")
    end
    assert_empty ManyfoldOpenscad::Variant.where(model: @model)
  end

  def test_ascii_stl_and_nonfinite_binary_validation
    ascii = "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n"
    assert ManyfoldOpenscad::StlUpload.new(StringIO.new(ascii)).digest
    bytes = binary_stl.dup
    bytes[84, 4] = [Float::INFINITY].pack("e")
    assert_raises(ManyfoldOpenscad::Error) { ManyfoldOpenscad::StlUpload.new(StringIO.new(bytes)) }
  end

  private

  def binary_stl
    "OpenSCAD test".ljust(80, "\0") + [1].pack("V") + [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0].pack("e12") + [0].pack("v")
  end

  def typed_parameters
    {"width" => 150, "enabled" => true, "label" => 'a "quoted" label; cube(99);', "offset" => [1, 2.5, -3]}
  end

  def browser(user)
    Warden.test_reset!
    login_as(user, scope: :user)
    ActionDispatch::Integration::Session.new(Rails.application).tap do |session|
      session.host!(PublicUrl.hostname)
      session.https! if Rails.application.config.assume_ssl
    end
  end

  def page_url
    "/manyfold_openscad/models/#{@model.to_param}/customize"
  end

  def source_url
    "/manyfold_openscad/models/#{@model.to_param}/sources/#{@source.id}"
  end

  def page_config(session)
    JSON.parse(Nokogiri::HTML(session.response.body).at_css("[data-openscad-config]").text)
  end

  def json(session)
    JSON.parse(session.response.body)
  end

  def post_variant(session, overrides: {}, bytes: binary_stl, csrf: true)
    @generated_at ||= Time.current.utc.iso8601
    token = Nokogiri::HTML(session.response.body).at_css('meta[name="csrf-token"]')&.[]("content")
    @csrf_token = token if token
    upload = Tempfile.new(["openscad-output", ".stl"])
    upload.binmode
    upload.write(bytes)
    upload.rewind
    params = {source_file_id: @source.id, source_digest: Digest::SHA256.hexdigest(SOURCE),
      filename: "box-wide.stl", parameters: JSON.generate(typed_parameters),
      engine_build: @configuration.renderer_build, render_options: JSON.generate({backend: "Manifold", format: "binstl"}),
      generated_at: @generated_at, idempotency_key: SecureRandom.uuid,
      stl: Rack::Test::UploadedFile.new(upload.path, "model/stl", true)}.merge(overrides)
    headers = {"HTTP_ORIGIN" => session.request.base_url}
    headers["HTTP_X_CSRF_TOKEN"] = @csrf_token if csrf
    session.post("/manyfold_openscad/models/#{@model.to_param}/variants", params: params, headers: headers)
  ensure
    upload&.close!
  end

  def promote(variant)
    file = variant.model_file.reload
    attacher = file.attachment_attacher
    FilePromoteJob.perform_now(attacher.class.name, file.class.name, file.id, "attachment", attacher.file_data)
  end

  def with_problem_check_counter(calls)
    original = Model.instance_method(:check_for_problems_later)
    Model.send(:define_method, :check_for_problems_later) do |**options|
      calls << id
      original.bind_call(self, **options)
    end
    yield
  ensure
    Model.send(:define_method, :check_for_problems_later, original)
  end
end
