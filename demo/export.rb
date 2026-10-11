# frozen_string_literal: true

abort "Run bin/build-demo in its disposable container." unless ENV["MANYFOLD_OPENSCAD_DEMO_BUILD"] == "1"

require "action_dispatch/testing/integration"
require "active_job/queue_adapters/test_adapter"
require "fileutils"
require "nokogiri"
require "pathname"
require "uri"
require "warden/test/helpers"

# Render through the real controller and application layout, with a throwaway
# filesystem library and database. Jobs must never process or rewrite fixtures.
ActiveJob::Base.queue_adapter = :test
Warden.test_mode!

class StaticDemoExport
  include Warden::Test::Helpers
  ROOT = Pathname.new("/plugins/manyfold_openscad")
  OUTPUT = Pathname.new("/demo-output")
  PUBLIC = Rails.root.join("public")
  REPOSITORY = "https://github.com/cmeister2/manyfold_openscad"
  EXAMPLES = {
    "index.html" => ["simplebox", "Simple box", "simple_box.scad"],
    "controls.html" => ["customizercontrols", "Customizer controls", "customizer_box.scad"]
  }.freeze

  def run
    seed
    copy_plugin_assets
    EXAMPLES.each { |page, example| export_page(page, example) }
    export_notices
    File.write(OUTPUT.join(".nojekyll"), "")
    FileUtils.chmod(0o755, OUTPUT)
    FileUtils.chown_R(Integer(ENV.fetch("DEMO_OWNER_UID")), Integer(ENV.fetch("DEMO_OWNER_GID")), OUTPUT)
    puts "Exported #{EXAMPLES.keys.join(' and ')} with the real Manyfold layout and local OpenSCAD assets."
  end

  private

  def seed
    admin = User.create!(username: "demo", email: "demo@example.invalid", password: SecureRandom.hex(24), approved: true)
    admin.add_role(:administrator)
    admin.update!(reset_password_token: nil, tour_state: {"completed" => %w[
      main-navbar nav-link-models nav-link-creators nav-link-collections nav-link-upload nav-link-preferences
    ]})
    FileUtils.mkdir_p("/config/models")
    @library = Library.create!(name: "Demo examples", path: "/config/models", storage_service: "filesystem", path_template: "{modelName}")
    @library.make_default
    @models = EXAMPLES.to_h do |page, (identifier, name, filename)|
      model = Model.create!(name: name, public_id: identifier, path: identifier, library: @library)
      directory = Pathname.new(@library.path).join(identifier)
      FileUtils.mkdir_p(directory)
      FileUtils.cp(ROOT.join("test/fixtures", filename), directory.join(filename))
      model.model_files.create!(filename: filename)
      [page, model]
    end
    @session = ActionDispatch::Integration::Session.new(Rails.application)
    @session.host!(PublicUrl.hostname)
    @session.https! if Rails.application.config.assume_ssl
    login_as(admin, scope: :user)
  end

  def request(path)
    @session.get(path)
    abort "Demo export request #{path} returned #{@session.response.status} (#{@session.response.headers['Location']}): #{@session.response.body[0,500]}" unless @session.response.status == 200
    @session.response.body
  end

  def copy_plugin_assets
    assets = OUTPUT.join("assets")
    FileUtils.mkdir_p(assets)
    ManyfoldOpenscad::AssetsController::ASSETS.each do |name, (directory, _type)|
      FileUtils.cp(ROOT.join(directory, name), assets.join(name))
    end
    FileUtils.cp(ROOT.join("demo/bootstrap.mjs"), OUTPUT.join("bootstrap.mjs"))
  end

  def export_page(page, example)
    _identifier, title, filename = example
    model = @models.fetch(page)
    document = Nokogiri::HTML(request("/manyfold_openscad/models/#{model.to_param}/customize"))
    abort "Missing real Manyfold page layout" unless document.at_css("#main-navbar") && document.at_css("#footer")
    config_node = document.at_css("[data-openscad-config]") or abort "Missing customizer configuration"
    config = JSON.parse(config_node.content)
    abort "Demo must render the real Save variant button" unless config.fetch("canSave") && document.at_css("[data-save]")
    source = JSON.parse(request(config.fetch("sourceUrl")))
    source_path = "sources/#{filename}.json"
    source_download = "sources/#{filename}"
    FileUtils.mkdir_p(OUTPUT.join("sources"))
    File.write(OUTPUT.join(source_path), JSON.generate(source))
    File.binwrite(OUTPUT.join(source_download), source.fetch("content"))

    config["sourceUrl"] = source_path
    config.delete("saveUrl")
    config["modelUrl"] = source_download
    config["assets"].transform_values! { |value| "assets/#{File.basename(value)}" }
    config_node.content = JSON.generate(config)
    config_node.remove_attribute("nonce")

    # Preserve all host HTML and styling while removing its application runtime,
    # which assumes a live Rails backend. The customizer itself is unchanged.
    document.css("script").each { |script| script.remove unless script == config_node }
    document.css('link[rel="modulepreload"], link[rel="preload"][as="script"], meta[name="csrf-token"], meta[name="csrf-param"], meta[name="csp-nonce"]').remove
    document.css("[nonce]").each { |node| node.remove_attribute("nonce") }
    # Host stylesheet URL rebasing changes its bytes, so its original Vite SRI
    # hash cannot be retained on this generated copy.
    document.css('link[rel="stylesheet"][integrity]').each { |node| node.remove_attribute("integrity") }
    document.css("a[href]").each do |link|
      next unless backend_url?(link["href"])
      link["href"] = "#"
      link["data-demo-inert"] = "true"
    end
    document.css("form[action]").each do |form|
      form.remove_attribute("action")
      form.remove_attribute("method")
      form["data-demo-inert"] = "true"
    end
    document.css("link[href], img[src]").each do |node|
      attribute = node.name == "img" ? "src" : "href"
      value = node[attribute]
      if value&.start_with?("/manyfold_openscad/assets/")
        node[attribute] = "assets/#{File.basename(value)}"
      elsif value&.start_with?("/")
        node[attribute] = copy_asset(value)
      end
    end
    document.at_css("title").content = "#{title} · OpenSCAD Customizer demo"
    document.at_css("#content").children.first.add_previous_sibling(Nokogiri::HTML.fragment(<<~HTML))
      <aside class="alert alert-info mt-3" aria-label="Demo examples">
        <strong>OpenSCAD Customizer demo.</strong> Generate, rotate and download an STL in your browser.
        Save variant and the Manyfold navigation are inactive in this static demo.
        <div class="d-flex flex-wrap gap-3 mt-2">
          <a href="index.html">Simple box</a>
          <a href="controls.html">Customizer controls</a>
          <a href="#{source_download}" download>Download SCAD source</a>
          <a href="#{REPOSITORY}">Plugin repository</a>
          <a href="notices.html">Licenses and source</a>
        </div>
      </aside>
    HTML
    bootstrap = Nokogiri::XML::Node.new("script", document)
    bootstrap["type"] = "module"
    bootstrap["src"] = "bootstrap.mjs"
    document.at_css("head").add_child(bootstrap)
    File.write(OUTPUT.join(page), document.to_html)
  end

  def backend_url?(url)
    return false if url.start_with?("#", "mailto:")
    uri = URI.parse(url)
    uri.relative? || uri.host == PublicUrl.hostname
  end

  # Copy the exact pinned host stylesheet, images and fonts. Only root-relative
  # CSS URLs change, so the same assets work beneath any GitHub Pages repo path.
  def copy_asset(url)
    uri = URI.parse(url)
    source = PUBLIC.join(uri.path.delete_prefix("/")).cleanpath
    unless source.file?
      # The host layout's apple-touch-icon uses asset_path rather than
      # vite_asset_path; resolve that unfingerprinted name from the same build.
      manifest = JSON.parse(PUBLIC.join("vite/.vite/manifest-assets.json").read)
      entries = manifest.values.select { |entry| File.basename(entry.fetch("src")) == File.basename(uri.path) }
      if entries.one?
        uri.path = "/vite/#{entries.first.fetch('file')}"
        source = PUBLIC.join(uri.path.delete_prefix("/")).cleanpath
      end
    end
    abort "Unsafe host asset path #{url}" unless source.to_s.start_with?("#{PUBLIC}/") && source.file?
    relative = Pathname.new("host").join(source.relative_path_from(PUBLIC))
    destination = OUTPUT.join(relative)
    return relative.to_s if destination.file?
    FileUtils.mkdir_p(destination.dirname)
    if source.extname == ".css"
      css = source.read
      css = css.gsub(/url\(\s*(['"]?)(?!data:)([^'"\s\)]+)\1\s*\)/) do |match|
        dependency = Regexp.last_match(2)
        abort "External runtime CSS asset #{dependency}" if dependency.start_with?("http:", "https:", "//")
        path = dependency.start_with?("/") ? dependency : URI.join("http://localhost#{uri.path}", dependency).request_uri
        copied = Pathname.new(copy_asset(path))
        "url(#{copied.relative_path_from(relative.dirname)})"
      end
      abort "External runtime CSS import" if css.match?(/@import\s+(?:url\()?['"]?(?:https?:|\/\/)/)
      destination.write(css)
    else
      FileUtils.cp(source, destination)
    end
    relative.to_s
  end

  def export_notices
    licenses = OUTPUT.join("licenses")
    FileUtils.mkdir_p(licenses)
    FileUtils.cp_r(ROOT.join("demo/licenses/.").to_s, licenses) if ROOT.join("demo/licenses").directory?
    FileUtils.cp(ROOT.join("LICENSE"), licenses.join("PLUGIN-AGPL-3.0.txt"))
    FileUtils.cp(Rails.root.join("LICENSE.md"), licenses.join("MANYFOLD-AGPL-3.0.txt"))
    FileUtils.cp(ROOT.join("vendor/openscad/COPYING"), licenses.join("OPENSCAD-COPYING.txt"))
    FileUtils.cp(ROOT.join("vendor/openscad/FONT-LICENSE"), licenses.join("DEJAVU-FONT-LICENSE.txt"))
    FileUtils.cp(ROOT.join("vendor/openscad/build.lock.json"), licenses.join("openscad-build.lock.json"))
    host_revision = Rails.application.config.git_sha
    engine = JSON.parse(ROOT.join("vendor/openscad/build.lock.json").read)
    File.write(OUTPUT.join("notices.html"), <<~HTML)
      <!DOCTYPE html>
      <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo licenses and source</title></head>
      <body><main>
        <h1>Demo licenses and source</h1>
        <p><a href="index.html">Return to the demo</a></p>
        <p>The demo exports the real Manyfold application layout and plugin customizer template. Model rendering uses the unchanged plugin assets and local OpenSCAD WebAssembly build.</p>
        <ul>
          <li><a href="#{REPOSITORY}">Plugin source</a> · <a href="licenses/PLUGIN-AGPL-3.0.txt">AGPL-3.0-only license</a></li>
          <li><a href="https://github.com/manyfold3d/manyfold/tree/#{host_revision}">Manyfold 0.150.0 source</a> · <a href="licenses/MANYFOLD-AGPL-3.0.txt">Manyfold license</a></li>
          <li><a href="#{engine.fetch('source_url')}">#{engine.fetch('build')} source</a> · <a href="licenses/OPENSCAD-COPYING.txt">OpenSCAD license notices</a> · <a href="licenses/openscad-build.lock.json">Pinned build and checksums</a></li>
          <li><a href="https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37">DejaVu font source</a> · <a href="licenses/DEJAVU-FONT-LICENSE.txt">Font license</a></li>
          <li><a href="licenses/README.md">Host stylesheet and icon font notices</a> · <a href="licenses/manifest.json">Dependency source and license manifest</a></li>
        </ul>
        <p>Save variant and backend navigation are inactive in this static demo. The bundled SCAD examples can be downloaded from each demo page.</p>
      </main></body></html>
    HTML
  end
end

StaticDemoExport.new.run
