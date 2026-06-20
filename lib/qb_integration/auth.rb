require 'oauth2'
require 'securerandom'

module QBIntegration
  class Auth
    attr_reader :accesstoken, :refreshtoken

    def initialize(credentials = {})
      @accesstoken = credentials[:access_token] || credentials['access_token']
      @refreshtoken = credentials[:refresh_token] || credentials['refresh_token']
    end

    def access_token
      OAuth2::AccessToken.new(
        oauth2_consumer,
        accesstoken,
        { refresh_token: refreshtoken }
      )
    end

    def self.client_id
      ENV['QB_CONSUMER_CLIENT_ID'] || ENV['QB_CONSUMER_KEY']
    end

    def self.client_secret
      ENV['QB_CONSUMER_CLIENT_SECRET'] || ENV['QB_CONSUMER_SECRET']
    end

    def self.redirect_uri
      ENV['QBO_REDIRECT_URI'] || 'http://localhost:3000/api/qbo/callback'
    end

    def self.oauth_client
      OAuth2::Client.new(
        client_id,
        client_secret,
        {
          site: 'https://appcenter.intuit.com/connect/oauth2',
          authorize_url: 'https://appcenter.intuit.com/connect/oauth2',
          token_url: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
          redirect_uri: redirect_uri
        }
      )
    end

    def self.authorization_url(state)
      client = oauth_client
      client.auth_code.authorize_url(
        scope: 'com.intuit.quickbooks.accounting',
        state: state,
        redirect_uri: redirect_uri
      )
    end

    def self.exchange_code_for_tokens(code)
      client = oauth_client
      token = client.auth_code.get_token(
        code,
        redirect_uri: redirect_uri,
        headers: { 'Accept' => 'application/json' }
      )
      {
        access_token: token.token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at
      }
    end

    private

    def oauth2_consumer
      self.class.oauth_client
    end
  end
end
