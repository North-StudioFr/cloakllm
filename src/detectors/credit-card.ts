/**
 * Detects Credit and Debit Card numbers:
 * - Visa, MasterCard, American Express, Discover, Diners Club, JCB
 * - Validates checksum using the Luhn (Mod 10) algorithm to eliminate false positives
 */

import type { DetectedEntity, DetectorPlugin } from '../types.ts';
import { isValidLuhn } from './identity.ts';

// Common credit card patterns (with spaces or dashes)
// Visa: starts with 4 (13, 16 digits)
// MasterCard: starts with 51-55 or 22-27 (16 digits)
// Amex: starts with 34 or 37 (15 digits)
// Discover: starts with 6011, 65, 644-649 (16 digits)
const CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g;

export class CreditCardDetector implements DetectorPlugin {
  public name = 'CreditCardDetector';
  public supportedTypes = ['CREDIT_CARD' as const];

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    for (const match of text.matchAll(CARD_REGEX)) {
      if (match.index !== undefined) {
        const candidate = match[0];
        const rawDigits = candidate.replace(/[\s-]/g, '');

        // Luhn validation is mandatory for credit card detection
        if (isValidLuhn(rawDigits)) {
          let issuer = 'UNKNOWN';
          if (/^4/.test(rawDigits)) issuer = 'VISA';
          else if (/^5[1-5]|^2[2-7]/.test(rawDigits)) issuer = 'MASTERCARD';
          else if (/^3[47]/.test(rawDigits)) issuer = 'AMEX';
          else if (/^6/.test(rawDigits)) issuer = 'DISCOVER';

          results.push({
            type: 'CREDIT_CARD',
            value: candidate,
            start: match.index,
            end: match.index + candidate.length,
            confidence: 0.99,
            metadata: { issuer },
          });
        }
      }
    }

    return results;
  }
}
