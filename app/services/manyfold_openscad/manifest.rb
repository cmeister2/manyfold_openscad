# frozen_string_literal: true

require "json"
require "digest"
require "time"

module ManyfoldOpenscad
  class Manifest
    SCHEMA_VERSION = 1
    MAX_PARAMETERS = 128
    MAX_METADATA_BYTES = 64 * 1024

    def self.parameters(value)
      parsed = object(value)
      raise Error.new(:invalid_parameters) if parsed.length > MAX_PARAMETERS
      parsed.each do |name, entry|
        unless name.is_a?(String) && name.match?(/\A[A-Za-z_$][A-Za-z0-9_$]{0,127}\z/) && parameter_value?(entry)
          raise Error.new(:invalid_parameters)
        end
      end
      parsed
    end

    def self.options(value)
      parsed = object(value || "{}")
      allowed = {"backend" => %w[Manifold CGAL], "format" => %w[binstl asciistl stl]}
      raise Error.new(:invalid_render_options) unless parsed.all? { |key, entry| allowed[key]&.include?(entry) }
      parsed
    end

    def self.generation_time(value)
      time = Time.iso8601(value.to_s)
      raise Error.new(:invalid_generation_time) if time > Time.current + 5.minutes || time < Time.utc(2000)
      time.utc.iso8601
    rescue ArgumentError
      raise Error.new(:invalid_generation_time)
    end

    def self.build(source:, parameters:, engine_build:, options:, output_digest:, filename:, file:, user:, generated_at:)
      {
        "schema_version" => SCHEMA_VERSION,
        "source" => {"model_id" => source.fetch("model_id"), "file_id" => source.fetch("id"),
                     "filename" => source.fetch("filename"), "digest_algorithm" => "sha256",
                     "digest" => source.fetch("digest")},
        "parameters" => parameters,
        # OpenSCAD presets represent parameter values as text. Keep the typed
        # values above as the canonical provenance used by this plugin.
        "fileFormatVersion" => "1",
        "parameterSets" => {"variant" => parameters.transform_values { |value| value.is_a?(String) ? value : JSON.generate(value) }},
        "renderer" => {"build" => engine_build, "options" => options},
        "output" => {"file_id" => file.id, "filename" => filename, "digest_algorithm" => "sha256", "digest" => output_digest},
        "generated_at" => generated_at,
        "saved_at" => Time.current.utc.iso8601,
        "saved_by_user_id" => user.id,
        "provenance" => "client_submitted"
      }
    end

    def self.canonical(value)
      case value
      when Hash
        value.keys.sort.to_h { |key| [key, canonical(value.fetch(key))] }
      when Array
        value.map { |entry| canonical(entry) }
      else
        value
      end
    end

    def self.object(value)
      raise Error.new(:invalid_parameters) unless value.is_a?(String) && value.bytesize <= MAX_METADATA_BYTES
      parsed = JSON.parse(value, max_nesting: 4)
      raise Error.new(:invalid_parameters) unless parsed.is_a?(Hash)
      parsed
    rescue JSON::ParserError, JSON::NestingError
      raise Error.new(:invalid_parameters)
    end

    def self.parameter_value?(value)
      case value
      when TrueClass, FalseClass
        true
      when Numeric
        value.finite?
      when String
        value.bytesize <= 10_240 && value.valid_encoding? && !value.include?("\0")
      when Array
        value.length.between?(1, 16) && value.all? { |entry| entry.is_a?(Numeric) && entry.finite? }
      else
        false
      end
    end
    private_class_method :object, :parameter_value?
  end
end
