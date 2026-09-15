/**
 * CloakLLM Shannon Entropy Detector
 * Detects unknown high-entropy cryptographic secrets, random API keys, base64 blobs,
 * and hexadecimal tokens using native sliding-window Shannon entropy calculation.
 * Zero external dependencies. Execution latency < 0.5ms.
 */

import type { DetectedEntity, DetectorPlugin } from '../types.ts';

/**
 * Computes the Shannon entropy of a string:
 * H = - SUM( p(x) * log2( p(x) ) )
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  const frequencies = new Map<string, number>();
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }

  const length = str.length;
  let entropy = 0;

  for (const count of frequencies.values()) {
    const p = count / length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Computes the maximum Shannon entropy across a sliding window of a string.
 * Allows detecting high-entropy secrets embedded within longer strings or structured tokens.
 */
export function calculateSlidingWindowEntropy(
  str: string,
  windowSize: number = 32,
  step: number = 2
): { maxEntropy: number; bestWindow: string } {
  if (!str || str.length === 0) {
    return { maxEntropy: 0, bestWindow: '' };
  }

  if (str.length <= windowSize) {
    const ent = calculateShannonEntropy(str);
    return { maxEntropy: ent, bestWindow: str };
  }

  let maxEntropy = 0;
  let bestWindow = str.slice(0, windowSize);

  for (let i = 0; i <= str.length - windowSize; i += step) {
    const window = str.slice(i, i + windowSize);
    const ent = calculateShannonEntropy(window);
    if (ent > maxEntropy) {
      maxEntropy = ent;
      bestWindow = window;
    }
  }

  return { maxEntropy, bestWindow };
}

// Pure hexadecimal tokens of at least 32 chars (e.g. SHA256, MD5, private keys)
const CANDIDATE_HEX_REGEX = /(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])/g;

// Candidate token pattern: alphanumeric/base64/hex tokens of at least 20 chars, safely handling +, /, =, -, _
const CANDIDATE_TOKEN_REGEX = /(?<![A-Za-z0-9+/=_\-])[A-Za-z0-9+/_\-]{20,}={0,2}(?![A-Za-z0-9+/=_\-])/g;

export class EntropyDetector implements DetectorPlugin {
  public name = 'EntropyDetector';
  public supportedTypes = ['SECRET' as const];

  private base64EntropyThreshold: number;
  private hexEntropyThreshold: number;
  private slidingWindowSize: number;

  constructor(options?: { base64Threshold?: number; hexThreshold?: number; windowSize?: number }) {
    // Alphanumeric/base64 threshold (max theoretical for 64 chars is 6.0; random secrets typically > 4.2)
    this.base64EntropyThreshold = options?.base64Threshold ?? 4.2;
    // Hexadecimal threshold (max theoretical for 16 chars is 4.0; random hex secrets typically > 3.4)
    this.hexEntropyThreshold = options?.hexThreshold ?? 3.4;
    this.slidingWindowSize = options?.windowSize ?? 32;
  }

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];
    if (!text || text.length < 20) return results;

    const matchedSpans = new Set<string>();

    // 1. Scan Hex candidates
    for (const match of text.matchAll(CANDIDATE_HEX_REGEX)) {
      if (match.index === undefined) continue;
      const token = match[0];

      // Exclude data URIs
      const preceding = text.substring(Math.max(0, match.index - 50), match.index);
      if (/data:[a-zA-Z0-9+/.-]+;base64,$/i.test(preceding)) continue;

      const tokenEntropy = calculateShannonEntropy(token);
      const sliding = calculateSlidingWindowEntropy(token, this.slidingWindowSize, 4);
      const effectiveEntropy = Math.max(tokenEntropy, sliding.maxEntropy);

      if (effectiveEntropy >= this.hexEntropyThreshold) {
        const spanKey = `${match.index}:${match.index + token.length}`;
        matchedSpans.add(spanKey);

        results.push({
          type: 'SECRET',
          value: token,
          start: match.index,
          end: match.index + token.length,
          confidence: Math.min(0.98, 0.75 + (effectiveEntropy / 4.0) * 0.23),
          metadata: {
            detector: 'ShannonEntropy',
            encoding: 'hex',
            entropy: Math.round(effectiveEntropy * 100) / 100,
            slidingWindowMax: Math.round(sliding.maxEntropy * 100) / 100,
          },
        });
      }
    }

    // 2. Scan General base64/alphanumeric candidates
    for (const match of text.matchAll(CANDIDATE_TOKEN_REGEX)) {
      if (match.index === undefined) continue;
      const token = match[0];
      const spanKey = `${match.index}:${match.index + token.length}`;
      if (matchedSpans.has(spanKey)) continue;

      // Filter out media data URIs (e.g. data:image/png;base64,...)
      const preceding = text.substring(Math.max(0, match.index - 50), match.index);
      if (/data:[a-zA-Z0-9+/.-]+;base64,$/i.test(preceding)) continue;

      // Filter out obvious natural language sequences (e.g. plain URLs)
      if (token.startsWith('http://') || token.startsWith('https://')) continue;

      // Check character variety (upper, lower, digits or special)
      const hasUpper = /[A-Z]/.test(token);
      const hasLower = /[a-z]/.test(token);
      const hasDigit = /[0-9]/.test(token);
      const hasSymbol = /[+/=_\-]/.test(token);

      const diversityScore = (hasUpper ? 1 : 0) + (hasLower ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSymbol ? 1 : 0);
      if (diversityScore < 2) continue; // Skip single-case pure alphabetical words

      const tokenEntropy = calculateShannonEntropy(token);
      const sliding = calculateSlidingWindowEntropy(token, this.slidingWindowSize, 4);
      const effectiveEntropy = Math.max(tokenEntropy, sliding.maxEntropy);

      if (effectiveEntropy >= this.base64EntropyThreshold) {
        results.push({
          type: 'SECRET',
          value: token,
          start: match.index,
          end: match.index + token.length,
          confidence: Math.min(0.98, 0.70 + (effectiveEntropy / 6.0) * 0.28),
          metadata: {
            detector: 'ShannonEntropy',
            encoding: 'base64_or_alphanumeric',
            entropy: Math.round(effectiveEntropy * 100) / 100,
            slidingWindowMax: Math.round(sliding.maxEntropy * 100) / 100,
          },
        });
      }
    }

    return results;
  }
}
