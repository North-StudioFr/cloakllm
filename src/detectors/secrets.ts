/**
 * Detects confidential credentials, API keys, tokens, and cryptographic secrets:
 * - OpenAI API keys (sk-..., sk-proj-...)
 * - GitHub Personal Access Tokens (ghp_..., github_pat_...)
 * - AWS Access Keys (AKIA...)
 * - Slack tokens (xoxb-..., xoxp-...)
 * - JSON Web Tokens (JWT)
 * - Private RSA/EC/SSH Keys
 * - Database connection URIs with embedded passwords
 * - Bearer authorization tokens
 */

import type { DetectedEntity, DetectorPlugin } from '../types.ts';

const OPENAI_KEY_REGEX = /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g;
const GITHUB_TOKEN_REGEX = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g;
const AWS_ACCESS_KEY_REGEX = /\bAKIA[0-9A-Z]{16}\b/g;
const SLACK_TOKEN_REGEX = /\bxox[baprs]-[0-9a-zA-Z]{10,}-[0-9a-zA-Z]{10,}(?:-[0-9a-zA-Z]{10,})?\b/g;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const PRIVATE_KEY_REGEX = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g;
const DB_CONNECTION_REGEX = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:]+:[^\s@]+@[^\s]+\b/gi;
const BEARER_AUTH_REGEX = /\bBearer\s+[A-Za-z0-9_.\-~+/=]{20,}\b/gi;
const GOOGLE_API_KEY_REGEX = /\bAIza[0-9A-Za-z-_]{35}\b/g;
const STRIPE_SECRET_REGEX = /\bsk_(?:live|test)_[0-9a-zA-Z]{24,}\b/g;
const HUGGINGFACE_TOKEN_REGEX = /\bhf_[A-Za-z0-9]{34,}\b/g;

export class SecretsDetector implements DetectorPlugin {
  public name = 'SecretsDetector';
  public supportedTypes = ['SECRET' as const];

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    const patterns = [
      { regex: OPENAI_KEY_REGEX, name: 'OPENAI_KEY' },
      { regex: GITHUB_TOKEN_REGEX, name: 'GITHUB_TOKEN' },
      { regex: AWS_ACCESS_KEY_REGEX, name: 'AWS_ACCESS_KEY' },
      { regex: SLACK_TOKEN_REGEX, name: 'SLACK_TOKEN' },
      { regex: JWT_REGEX, name: 'JWT' },
      { regex: PRIVATE_KEY_REGEX, name: 'PRIVATE_KEY' },
      { regex: DB_CONNECTION_REGEX, name: 'DB_CONNECTION' },
      { regex: BEARER_AUTH_REGEX, name: 'BEARER_TOKEN' },
      { regex: GOOGLE_API_KEY_REGEX, name: 'GOOGLE_API_KEY' },
      { regex: STRIPE_SECRET_REGEX, name: 'STRIPE_SECRET_KEY' },
      { regex: HUGGINGFACE_TOKEN_REGEX, name: 'HUGGINGFACE_TOKEN' },
    ];

    for (const { regex, name } of patterns) {
      for (const match of text.matchAll(regex)) {
        if (match.index !== undefined) {
          results.push({
            type: 'SECRET',
            value: match[0],
            start: match.index,
            end: match.index + match[0].length,
            confidence: 0.99,
            metadata: { secretType: name },
          });
        }
      }
    }

    return results;
  }
}
