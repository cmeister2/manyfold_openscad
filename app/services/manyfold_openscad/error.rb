# frozen_string_literal: true

module ManyfoldOpenscad
  class Error < StandardError
    attr_reader :code, :http_status

    def initialize(code, http_status: :unprocessable_content)
      @code = code
      @http_status = http_status
      super(I18n.t("manyfold_openscad.errors.#{code}"))
    end
  end
end
