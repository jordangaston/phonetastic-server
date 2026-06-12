import { injectable } from 'tsyringe';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL = 15 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 3600;

/**
 * Handles JWT token generation and verification using per-user ECDSA key pairs.
 */
@injectable()
export class AuthService {
  /**
   * Generates an ECDSA P-256 key pair for a new user.
   *
   * @returns An object with PEM-encoded privateKey and publicKey strings.
   */
  generateKeyPair(): { privateKey: string; publicKey: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { privateKey, publicKey };
  }

  /**
   * Creates signed access and refresh tokens for a user.
   *
   * @param userId - The user's id.
   * @param privateKey - The user's PEM-encoded ECDSA private key.
   * @param nonces - Current token nonce values to embed.
   * @returns Access and refresh token objects with JWT string and expiration.
   */
  generateTokens(userId: number, privateKey: string, nonces: { access: number; refresh: number }) {
    return {
      access_token: this.signToken({ sub: userId, nonce: nonces.access, type: 'access' }, privateKey, ACCESS_TOKEN_TTL),
      refresh_token: this.signToken({ sub: userId, nonce: nonces.refresh, type: 'refresh' }, privateKey, REFRESH_TOKEN_TTL),
    };
  }

  private signToken(payload: object, privateKey: string, ttlSeconds: number) {
    const token = jwt.sign(payload, privateKey, { algorithm: 'ES256', expiresIn: ttlSeconds });
    return { jwt: token, expires_at: Math.floor(Date.now() / 1000) + ttlSeconds };
  }

  /**
   * Verifies a JWT against a user's public key.
   *
   * @param token - The JWT string.
   * @param publicKey - The user's PEM-encoded ECDSA public key.
   * @returns The decoded payload.
   * @throws If the token is invalid or expired.
   */
  verifyToken(token: string, publicKey: string): jwt.JwtPayload {
    return jwt.verify(token, publicKey, { algorithms: ['ES256'] }) as jwt.JwtPayload;
  }

  /**
   * Decodes a JWT without verification to extract the subject.
   *
   * @param token - The JWT string.
   * @returns The decoded payload, or null.
   */
  decodeToken(token: string): jwt.JwtPayload | null {
    return jwt.decode(token) as jwt.JwtPayload | null;
  }
}
