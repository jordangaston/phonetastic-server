import { OAuth2Client } from 'google-auth-library';

/**
 * OAuth token set returned after exchanging an authorization code.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Interface for Google OAuth operations.
 * Implementations handle authorization URL generation and code exchange.
 */
export interface GoogleOAuthService {
  /**
   * Generates the Google OAuth consent URL.
   *
   * @param state - An opaque state string for CSRF protection.
   * @returns The authorization URL to redirect the user to.
   */
  getAuthorizationUrl(state: string): string;

  /**
   * Exchanges an authorization code for access and refresh tokens.
   *
   * @param code - The authorization code from the callback.
   * @returns The OAuth token set.
   */
  exchangeCode(code: string): Promise<OAuthTokens>;
}

/**
 * Stub Google OAuth service for development and testing.
 */
export class StubGoogleOAuthService implements GoogleOAuthService {
  public readonly authUrls: string[] = [];
  public readonly exchangedCodes: string[] = [];

  getAuthorizationUrl(state: string): string {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&stub=true`;
    this.authUrls.push(url);
    return url;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    this.exchangedCodes.push(code);
    return {
      accessToken: `stub-access-${code}`,
      refreshToken: `stub-refresh-${code}`,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }
}

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.events.freebusy'];

/**
 * Google OAuth service backed by the google-auth-library SDK.
 *
 * @precondition Valid Google OAuth client credentials and redirect URI.
 * @postcondition Authorization URLs point to Google consent screen; code exchange returns real tokens.
 */
export class RealGoogleOAuthService implements GoogleOAuthService {
  private readonly client: OAuth2Client;

  /**
   * @param clientId - Google OAuth client ID.
   * @param clientSecret - Google OAuth client secret.
   * @param redirectUri - Registered OAuth redirect URI.
   */
  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  /** {@inheritDoc GoogleOAuthService.getAuthorizationUrl} */
  getAuthorizationUrl(state: string): string {
    return this.client.generateAuthUrl({
      scope: CALENDAR_SCOPES,
      access_type: 'offline',
      state,
    });
  }

  /** {@inheritDoc GoogleOAuthService.exchangeCode} */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    const { tokens } = await this.client.getToken(code);
    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: new Date(tokens.expiry_date!),
    };
  }
}
