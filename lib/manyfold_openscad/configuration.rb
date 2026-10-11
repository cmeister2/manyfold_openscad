# frozen_string_literal: true

module ManyfoldOpenscad
  class Configuration
    attr_accessor :max_source_bytes, :max_output_bytes, :generation_timeout_ms, :renderer_build

    def initialize
      @max_source_bytes = positive_env("OPENSCAD_MAX_SOURCE_BYTES", 1024 * 1024)
      @max_output_bytes = positive_env("OPENSCAD_MAX_OUTPUT_BYTES", 32 * 1024 * 1024)
      @generation_timeout_ms = positive_env("OPENSCAD_GENERATION_TIMEOUT_MS", 120_000)
      @renderer_build = "OpenSCAD-2025.03.25.wasm24456"
    end

    private

    def positive_env(name, default)
      value = Integer(ENV.fetch(name, default.to_s), 10)
      raise ArgumentError, "#{name} must be positive" unless value.positive?
      value
    end
  end

  def self.configuration
    @configuration ||= Configuration.new
  end

  def self.configure
    yield configuration
  end
end
