/**
 * Detects financial data:
 * - Currency amounts (EUR, USD, GBP, CHF, symbols and words, k€, M€)
 * - IBAN (International Bank Account Number) with ISO 7064 Modulo 97 validation
 * - BIC / SWIFT codes
 */

import type { DetectedEntity, DetectorPlugin } from '../types.ts';

// Matches currency symbols or words next to numbers, including scales (k€, M€, millions d'euros, etc.)
// e.g., 450 000 €, 12,500.50 $, $5,000, 15000 euros, 2.5M€, 80k$, 3 200 CHF, 10 millions d'euros
const CURRENCY_REGEX = /(?:[$€£¥]|USD|EUR|GBP|CHF)\s*\d+(?:[ \t.,]\d+)*(?:[.,]\d+)?|\b\d+(?:[ \t.,]\d+)*(?:[.,]\d+)?\s*(?:k€|M€|k\$|M\$|(?:(?:milles?|millions?|milliards?|k|M)\s*(?:d[\x27\u2019]|de\s+)?\s*)?(?:[$€£¥]|euros?|dollars?|livres?|CHF|USD|EUR|GBP))(?!\w)/gi;

// IBAN pattern: 2 letters (country), 2 check digits, followed by up to 30 alphanumeric characters
const IBAN_CANDIDATE_REGEX = /\b[A-Z]{2}[0-9]{2}(?:[ \t]?[0-9A-Z]{4}){3,7}(?:[ \t]?[0-9A-Z]{1,4})?\b/g;

// BIC/SWIFT: 4 letters (bank), 2 letters (country), 2 alphanumeric (location), optional 3 alphanumeric (branch)
const BIC_REGEX = /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;

/**
 * Validates an IBAN using ISO 7064 Modulo 97 algorithm.
 */
export function isValidIBAN(ibanStr: string): boolean {
  const clean = ibanStr.replace(/[\s\t-]/g, '').toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;

  // Move first 4 characters to the end
  const rearranged = clean.substring(4) + clean.substring(0, 4);

  // Replace letters with numbers (A=10, B=11, ..., Z=35)
  let numericString = '';
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numericString += (code - 55).toString();
    } else if (code >= 48 && code <= 57) {
      numericString += rearranged[i];
    } else {
      return false;
    }
  }

  // Modulo 97 with native BigInt
  try {
    return BigInt(numericString) % 97n === 1n;
  } catch {
    return false;
  }
}

export class FinancialDetector implements DetectorPlugin {
  public name = 'FinancialDetector';
  public supportedTypes = ['AMOUNT' as const, 'IBAN' as const];

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    // 1. IBAN Detection (with Modulo 97 validation)
    for (const match of text.matchAll(IBAN_CANDIDATE_REGEX)) {
      if (match.index !== undefined) {
        const candidate = match[0];
        if (isValidIBAN(candidate)) {
          results.push({
            type: 'IBAN',
            value: candidate,
            start: match.index,
            end: match.index + candidate.length,
            confidence: 0.99,
          });
        }
      }
    }

    // 2. Currency / Financial Amount Detection
    for (const match of text.matchAll(CURRENCY_REGEX)) {
      if (match.index !== undefined) {
        const val = match[0].trim();
        // Ensure this range isn't part of an already detected IBAN
        const overlapsWithIban = results.some(
          r => match.index! >= r.start && match.index! < r.end
        );

        if (!overlapsWithIban && val.length > 1) {
          // Check that there is at least one digit
          if (/\d/.test(val)) {
            results.push({
              type: 'AMOUNT',
              value: val,
              start: match.index,
              end: match.index + match[0].length,
              confidence: 0.94,
            });
          }
        }
      }
    }

    return results;
  }
}
