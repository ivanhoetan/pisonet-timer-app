import jwt from 'jsonwebtoken';
import { config } from '../config';

export type TokenRole = 'user' | 'admin';

export interface JwtPayload {
  sub: string;
  role: TokenRole;
  username?: string;
  email?: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
