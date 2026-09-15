/**
 * CloakLLM Financial Detector Plugin
 * Detects IBAN bank accounts (with ISO 7064 Modulo 97 validation) and monetary amounts.
 */

import type { DetectedEntity, DetectorPlugin, EntityType } from '../types.ts';

export class FinancialDetector implements DetectorPlugin {
  public readonly name = 'FinancialDetector';
  public readonly supportedTypes: EntityType[] = ['IBAN', 'FINANCIAL_AMOUNT'];

  // IBAN regex pattern covering international IBAN formats (15 to 34 alphanumeric chars)
  private static readonly IBAN_REGEX =
    /\b([A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7,30})\b/gi;

  // Formatted amounts e.g., 45 000 €, 1,250.00 $, $15,000, 350.50 EUR, 12 millions d'euros, 50k$
  private static readonly AMOUNT_REGEX =
    /(?:(?:[\$€£¥CHF]|EUR|USD|GBP)\s*[\d\s,.]+(?:k|M|m|k€|M€|k\$|M\$|k£|M£| millions?| milliards?)?|[\d\s,.]+\s*(?:[\$€£¥]|CHF|EUR|USD|GBP|euros?|dollars?|livres?)(?:\s+(?:millions?|milliards?))?)\b/gi;

  /**
   * ISO 7064 Modulo 97-10 IBAN Validation
   */
  public static isValidIban(rawIban: string): boolean {
    const cleaned = rawIban.replace(/[\s-]/g, '').toUpperCase();
    if (cleaned.length < 15 || cleaned.length > 34) return false;

    // Move first 4 characters to the end
    const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);

    // Convert letters to digits (A = 10, B = 11, ..., Z = 35)
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

    // Compute Modulo 97 using BigInt
    try {
      return BigInt(numericString) % 97n === 1n;
    } catch {
      return false;
    }
  }

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    // 1. Detect and validate IBANs
    FinancialDetector.IBAN_REGEX.lastIndex = 0;
    let ibanMatch: RegExpExecArray | null;
    while ((ibanMatch = FinancialDetector.IBAN_REGEX.exec(text)) !== null) {
      const value = ibanMatch[0];
      if (FinancialDetector.isValidIban(value)) {
        results.push({
          type: 'IBAN',
          value,
          start: ibanMatch.index,
          end: ibanMatch.index + value.length,
          confidence: 0.99,
          metadata: {
            countryCode: value.slice(0, 2).toUpperCase(),
          },
        });
      }
    }

    // 2. Detect Monetary Amounts
    FinancialDetector.AMOUNT_REGEX.lastIndex = 0;
    let amountMatch: RegExpExecArray | null;
    while ((amountMatch = FinancialDetector.AMOUNT_REGEX.exec(text)) !== null) {
      const raw = amountMatch[0].trim();
      // Filter out single digits, isolated dots, or mere numbers without currency indicators
      if (/\d/.test(raw) && /[\$€£¥]|CHF|EUR|USD|GBP|euro|dollar|livre/i.test(raw)) {
        results.push({
          type: 'FINANCIAL_AMOUNT',
          value: raw,
          start: amountMatch.index,
          end: amountMatch.index + raw.length,
          confidence: 0.95,
        });
      }
    }

    return results;
  }
}
