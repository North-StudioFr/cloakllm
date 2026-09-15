/**
 * CloakLLM Cryptographic Canary Engine (Honeytokens)
 * Generates and monitors HMAC-SHA256 signed canary tokens (e.g. CL-CANARY-SYS-a1b2c3d4).
 * Detects prompt exfiltration, unauthorized context replication, and indirect injection leaks.
 * Zero external dependencies. Execution latency < 0.2ms.
 */

import crypto from 'node:crypto';
import type { CanaryConfig, CanaryDetectionResult } from './types.ts';

const CANARY_REGEX = /\bCL-CANARY-[A-Za-z0-9_-]{1,24}-[a-f0-9]{8,16}\b/g;

export class CanaryEngine {
  private secretKey: Buffer;
  private activeCanaries: Set<string> = new Set();
  private maxActiveCanaries: number = 5000;

  constructor(config?: CanaryConfig) {
    if (config?.secretKey) {
      this.secretKey = crypto.createHash('sha256').update(config.secretKey).digest();
    } else {
      this.secretKey = crypto.randomBytes(32);
    }
  }

  /**
   * Generates a new cryptographically signed canary token.
   * Format: CL-CANARY-<label>-<hmac8>
   */
  public generateCanary(label: string = 'HONEY'): string {
    const cleanLabel = label.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16) || 'TOKEN';
    const nonce = crypto.randomBytes(8).toString('hex');
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${cleanLabel}:${nonce}`)
      .digest('hex')
      .slice(0, 8);

    const token = `CL-CANARY-${cleanLabel}-${nonce.slice(0, 4)}${signature}`;
    this.activeCanaries.add(token);

    if (this.activeCanaries.size > this.maxActiveCanaries) {
      // Evict first element
      const first = this.activeCanaries.values().next().value;
      if (first) this.activeCanaries.delete(first);
    }

    return token;
  }

  /**
   * Injects a canary token into a prompt or system context message.
   */
  public injectCanary(content: string, label: string = 'PROMPT'): { content: string; canary: string } {
    const canary = this.generateCanary(label);
    // Embedded as a subtle boundary marker
    const canaryInstruction = `\n<!-- SECURITY_SENTINEL: ${canary} -->`;
    return {
      content: content + canaryInstruction,
      canary,
    };
  }

  /**
   * Scans text for any canary tokens and verifies if they belong to this instance.
   */
  public scanForCanaries(text: string): CanaryDetectionResult {
    const matches: string[] = [];
    if (!text) {
      return { leakDetected: false, matchedTokens: [] };
    }

    for (const match of text.matchAll(CANARY_REGEX)) {
      const token = match[0];
      if (this.activeCanaries.has(token)) {
        matches.push(token);
      }
    }

    return {
      leakDetected: matches.length > 0,
      matchedTokens: matches,
    };
  }

  /**
   * Clears in-memory canary registry.
   */
  public clear(): void {
    this.activeCanaries.clear();
  }
}
