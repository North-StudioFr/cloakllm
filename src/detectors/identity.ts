/**
 * CloakLLM Identity Detector Plugin
 * Detects and validates French NIR (Social Security Number), French SIRET/SIREN,
 * US SSN (Social Security Numbers), and UK National Insurance Numbers (NINO).
 */

import type { DetectedEntity, DetectorPlugin, EntityType } from '../types.ts';

export class IdentityDetector implements DetectorPlugin {
  public readonly name = 'IdentityDetector';
  public readonly supportedTypes: EntityType[] = [
    'FRENCH_NIR',
    'SIRET_SIREN',
    'US_SSN',
    'UK_NINO',
  ];

  // NIR: 13 digits optionally followed by 2 digits security key
  // Supports optional spaces or dots between components
  private static readonly NIR_REGEX =
    /\b([12][0-9]{2}(?:0[1-9]|1[0-2]|[2-9][0-9])(?:[0-9]{2}|2[ABab])[0-9]{3}[0-9]{3})(?:[\s.-]*([0-9]{2}))?\b/g;

  // SIRET (14 digits) or SIREN (9 digits)
  private static readonly SIRET_SIREN_REGEX =
    /\b(\d{3}[\s.-]?\d{3}[\s.-]?\d{3}(?:[\s.-]?\d{5})?)\b/g;

  // US SSN: 9 digits in format AAA-GG-SSSS or AAAGGSSSS or AAA.GG.SSSS
  // Validates Area number (001-899, excluding 666), Group (01-99), Serial (0001-9999)
  private static readonly US_SSN_REGEX =
    /\b(?!000|666)(?:[0-8]\d{2})(?:[-.\s]?)(?!00)(?:\d{2})(?:[-.\s]?)(?!0000)(?:\d{4})\b/g;

  // UK National Insurance Number (NINO): 2 letters, 6 digits, 1 letter (A-D or space)
  // Official prefix exclusions: D, F, I, Q, U, V cannot be used; second letter cannot be D, F, I, Q, U, V; prefixes BG, GB, KN, NK, NT, TN, ZZ are disallowed
  private static readonly UK_NINO_REGEX =
    /\b(?!BG|GB|KN|NK|NT|TN|ZZ)([A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z])\s*([0-9]{2})\s*([0-9]{2})\s*([0-9]{2})\s*([A-D ]?)\b/gi;

  /**
   * Official NIR Checksum Algorithm (Modulo 97)
   */
  public static isValidNir(rawNir: string, rawKey?: string): boolean {
    let clean = rawNir.replace(/[\s.-]/g, '').toUpperCase();
    if (clean.length !== 13 && clean.length !== 15) return false;

    // Handle Corsica department codes: 2A -> 19, 2B -> 18
    clean = clean.replace('2A', '19').replace('2B', '18');

    const baseNumber = clean.slice(0, 13);
    const key = rawKey ? parseInt(rawKey, 10) : clean.length === 15 ? parseInt(clean.slice(13), 10) : null;

    if (key !== null) {
      try {
        const expectedKey = 97n - (BigInt(baseNumber) % 97n);
        return BigInt(key) === expectedKey;
      } catch {
        return false;
      }
    }

    // If key not provided, validate structure
    return /^[12][0-9]{12}$/.test(baseNumber);
  }

  /**
   * Luhn Algorithm for SIREN/SIRET verification
   */
  public static isValidLuhn(digitsOnly: string): boolean {
    let sum = 0;
    let shouldDouble = false;
    for (let i = digitsOnly.length - 1; i >= 0; i--) {
      let d = parseInt(digitsOnly.charAt(i), 10);
      if (shouldDouble) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    // 1. French NIR
    IdentityDetector.NIR_REGEX.lastIndex = 0;
    let nirMatch: RegExpExecArray | null;
    while ((nirMatch = IdentityDetector.NIR_REGEX.exec(text)) !== null) {
      const fullValue = nirMatch[0];
      const nirPart = nirMatch[1];
      const keyPart = nirMatch[2];

      if (IdentityDetector.isValidNir(nirPart, keyPart)) {
        results.push({
          type: 'FRENCH_NIR',
          value: fullValue,
          start: nirMatch.index,
          end: nirMatch.index + fullValue.length,
          confidence: keyPart ? 0.99 : 0.92,
        });
      }
    }

    // 2. SIREN (9 digits) & SIRET (14 digits)
    IdentityDetector.SIRET_SIREN_REGEX.lastIndex = 0;
    let siretMatch: RegExpExecArray | null;
    while ((siretMatch = IdentityDetector.SIRET_SIREN_REGEX.exec(text)) !== null) {
      const raw = siretMatch[0];
      const digits = raw.replace(/[\s.-]/g, '');

      if ((digits.length === 9 || digits.length === 14) && IdentityDetector.isValidLuhn(digits)) {
        results.push({
          type: 'SIRET_SIREN',
          value: raw,
          start: siretMatch.index,
          end: siretMatch.index + raw.length,
          confidence: 0.95,
          metadata: {
            kind: digits.length === 14 ? 'SIRET' : 'SIREN',
          },
        });
      }
    }

    // 3. US Social Security Numbers (SSN)
    IdentityDetector.US_SSN_REGEX.lastIndex = 0;
    let ssnMatch: RegExpExecArray | null;
    while ((ssnMatch = IdentityDetector.US_SSN_REGEX.exec(text)) !== null) {
      const raw = ssnMatch[0];
      const digits = raw.replace(/\D/g, '');

      if (digits.length === 9) {
        // Exclude repetitive test numbers e.g. 111111111, 078051120
        if (!/^(\d)\1{8}$/.test(digits) && digits !== '078051120') {
          results.push({
            type: 'US_SSN',
            value: raw,
            start: ssnMatch.index,
            end: ssnMatch.index + raw.length,
            confidence: 0.96,
            metadata: {
              format: raw.includes('-') ? 'hyphenated' : 'raw',
            },
          });
        }
      }
    }

    // 4. UK National Insurance Numbers (NINO)
    IdentityDetector.UK_NINO_REGEX.lastIndex = 0;
    let ninoMatch: RegExpExecArray | null;
    while ((ninoMatch = IdentityDetector.UK_NINO_REGEX.exec(text)) !== null) {
      const raw = ninoMatch[0];
      const clean = raw.replace(/\s+/g, '').toUpperCase();

      // Check final character is A, B, C, D or empty
      if (clean.length === 9 || clean.length === 8) {
        results.push({
          type: 'UK_NINO',
          value: raw,
          start: ninoMatch.index,
          end: ninoMatch.index + raw.length,
          confidence: 0.97,
        });
      }
    }

    return results;
  }
}
