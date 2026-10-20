module Api
  module V1
    class CsrfController < BaseController
      def show
        no_store
        render json: { csrf_token: form_authenticity_token }
      end
    end
  end
end
