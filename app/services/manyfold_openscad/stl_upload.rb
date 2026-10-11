# frozen_string_literal: true

require "digest"

module ManyfoldOpenscad
  class StlUpload
    attr_reader :bytes, :digest

    NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
    FACET = /\s*facet\s+normal\s+(#{NUMBER})\s+(#{NUMBER})\s+(#{NUMBER})\s+outer\s+loop\s+vertex\s+(#{NUMBER})\s+(#{NUMBER})\s+(#{NUMBER})\s+vertex\s+(#{NUMBER})\s+(#{NUMBER})\s+(#{NUMBER})\s+vertex\s+(#{NUMBER})\s+(#{NUMBER})\s+(#{NUMBER})\s+endloop\s+endfacet/m

    def initialize(upload)
      raise Error.new(:output_required) unless upload.respond_to?(:read) && upload.respond_to?(:rewind)
      limit = ManyfoldOpenscad.configuration.max_output_bytes
      raise Error.new(:output_too_large) if upload.respond_to?(:size) && upload.size > limit

      upload.rewind
      @bytes = upload.read(limit + 1)
      upload.rewind
      raise Error.new(:output_too_large) if @bytes.bytesize > limit
      raise Error.new(:invalid_stl) unless valid_binary? || valid_ascii?

      @digest = Digest::SHA256.hexdigest(@bytes)
    end

    private

    def valid_binary?
      return false if @bytes.bytesize < 134
      count = @bytes.byteslice(80, 4).unpack1("V")
      return false if count.zero? || 84 + 50 * count != @bytes.bytesize
      count.times.all? do |index|
        @bytes.byteslice(84 + 50 * index, 48).unpack("e12").all?(&:finite?)
      end
    end

    def valid_ascii?
      source = @bytes.dup.force_encoding(Encoding::UTF_8)
      return false unless source.valid_encoding? && source.ascii_only?
      match = source.match(/\Asolid[^\r\n]*\r?\n(.*?)\s*endsolid[^\r\n]*\s*\z/m)
      return false unless match
      facets = match[1]
      count = 0
      remaining = facets.gsub(FACET) do
        return false unless Regexp.last_match.captures.all? { |number| Float(number).finite? }
        count += 1
        ""
      end
      count.positive? && remaining.strip.empty?
    rescue ArgumentError
      false
    end
  end
end
