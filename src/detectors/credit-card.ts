/**
 * CloakLLM Credit Card Detector Plugin
 * Detects Visa, Mastercard, American Express, and Discover numbers.
 * Enforces mandatory Luhn algorithm (Mod 10) validation.
 */

import type { DetectedEntity, DetectorPlugin, EntityType } from '../types.ts';

export class CreditCardDetector implements DetectorPlugin {
  public readonly name = 'CreditCardDetector';
  public readonly supportedTypes: EntityType[] = ['CREDIT_CARD'];

  // Matches 13-19 digit card patterns with optional spaces or dashes
  private static readonly CARD_REGEX =
    /\b(?:\d[ -]*?){13,19}\b/g;

  /**
   * Luhn Algorithm (Mod 10 Checksum)
   */
  public static isValidLuhn(cardNumber: string): boolean {
    const digitsOnly = cardNumber.replace(/\D/g, '');
    if (digitsOnly.length < 13 || digitsOnly.length > 19) return false;

    let sum = 0;
    let shouldDouble = false;

    for (let i = digitsOnly.length - 1; i >= 0; i--) {
      let digit = parseInt(digitsOnly.charAt(i), 10);

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];
    CreditCardDetector.CARD_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = CreditCardDetector.CARD_REGEX.exec(text)) !== null) {
      const raw = match[0].trim();
      const digits = raw.replace(/\D/g, '');

      // Reject non-card lengths or numbers that are all identical zeros
      if (digits.length >= 13 && digits.length <= 19 && !/^0+$/.test(digits)) {
        if (CreditCardDetector.isValidLuhn(digits)) {
          results.push({
            type: 'CREDIT_CARD',
            value: raw,
            start: match.index,
            end: match.index + raw.length,
            confidence: 0.99,
            metadata: {
              digitCount: digits.length,
              luhnValid: true,
            },
          });
        }
      }
    }

    return results;
  }
}
