ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end

module ActionDispatch
  class IntegrationTest
    # Increment 0: unsafe requests need a same-origin Origin and a token from /api/v1/csrf.
    def browser_headers
      get "/api/v1/csrf"
      { "Origin" => "http://www.example.com", "X-CSRF-Token" => response.parsed_body.fetch("csrf_token") }
    end
  end
end
