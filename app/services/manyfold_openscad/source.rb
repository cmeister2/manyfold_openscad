# frozen_string_literal: true

require "digest"

module ManyfoldOpenscad
  class Source
    def self.read(file)
      raise Error.new(:not_scad) unless File.extname(file.filename).downcase == ".scad"
      raise Error.new(:source_missing, http_status: :not_found) unless file.attachment

      limit = ManyfoldOpenscad.configuration.max_source_bytes
      raise Error.new(:source_too_large) if file.attachment.size && file.attachment.size > limit

      # Shrine handles local and object storage here; never use a library path.
      content = file.attachment.open do |io|
        io.read(limit + 1)
      end
      raise Error.new(:source_too_large) if content.bytesize > limit
      content.force_encoding(Encoding::UTF_8)
      raise Error.new(:source_encoding) unless content.valid_encoding? && !content.include?("\0")

      {"id" => file.id, "model_id" => file.model_id, "filename" => file.filename,
       "content" => content, "digest" => Digest::SHA256.hexdigest(content)}
    rescue Shrine::FileNotFound, Errno::ENOENT
      raise Error.new(:source_missing, http_status: :not_found)
    end
  end
end
