/**
 * Detects official government & administrative identity numbers:
 * - French NIR (Numéro de Sécurité Sociale - 13 ou 15 chiffres, avec validation clé de contrôle)
 * - French SIREN (9 chiffres) et SIRET (14 chiffres) avec validation Luhn
 * - US SSN (Social Security Number - 9 digits with Area/Group/Serial validation)
 * - UK NINO (National Insurance Number - 2 prefix letters, 6 digits, suffix letter)
 */

import type { DetectedEntity, DetectorPlugin, EntityType } from '../types.ts';

// French NIR Regex: captures formats with or without spaces/dashes, 13 or 15 characters
// e.g.: 1 85 05 75 108 123 45 or 2850575108123
const NIR_REGEX = /\b([12])[\s.-]?([0-9]{2})[\s.-]?(0[1-9]|1[0-2]|[2-9][0-9])[\s.-]?([0-9]{2}|2[AB])[\s.-]?([0-9]{3})[\s.-]?([0-9]{3})(?:[\s.-]?([0-9]{2}))?\b/gi;

// SIRET: 14 consecutive or space-separated digits
const SIRET_REGEX = /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{5}\b/g;

// SIREN: 9 digits with context keyword or standard 3x3 grouping
const SIREN_REGEX = /(?:\bSIREN\b[\s.:-]*(\d{9})\b|\b(\d{3}[\s.-]\d{3}[\s.-]\d{3})\b)/gi;

// US SSN Formatted: XXX-XX-XXXX, XXX XX XXXX, or XXX.XX.XXXX
const US_SSN_FORMATTED_REGEX = /\b(?!000|666|9\d{2})([0-8]\d{2})[- .](?!00)(\d{2})[- .](?!0000)(\d{4})\b/g;

// US SSN Contextual (e.g. SSN: 123456789)
const US_SSN_CONTEXT_REGEX = /(?:\b(?:SSN|Social\s+Security(?:\s+Number)?)\b[\s.:#-]*)(?!000|666|9\d{2})([0-8]\d{2})[- ]?(?!00)(\d{2})[- ]?(?!0000)(\d{4})\b/gi;

// UK NINO: 2 prefix letters, 6 digits, suffix letter A-D
const UK_NINO_REGEX = /\b([A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]|QQ)[\s.-]?(\d{2})[\s.-]?(\d{2})[\s.-]?(\d{2})[\s.-]?([A-D])\b/gi;

// UK NINO Contextual
const UK_NINO_CONTEXT_REGEX = /(?:\b(?:NINO|National\s+Insurance(?:\s+Number)?)\b[\s.:#-]*)([A-Za-z]{2})[\s.-]?(\d{2})[\s.-]?(\d{2})[\s.-]?(\d{2})[\s.-]?([A-D])\b/gi;

/**
 * Validates French NIR (Social Security Number) control key if 15 digits provided.
 */
export function isValidNIR(nirCandidate: string): boolean {
  const clean = nirCandidate.replace(/[\s.-]/g, '').toUpperCase();
  if (clean.length !== 13 && clean.length !== 15) return false;

  const sex = parseInt(clean[0], 10);
  if (sex !== 1 && sex !== 2) return false;

  if (clean.length === 15) {
    const key = parseInt(clean.substring(13, 15), 10);
    let base = clean.substring(0, 13);

    // Corsica special handling (2A -> 19, 2B -> 18)
    if (base.includes('2A')) {
      base = base.replace('2A', '19');
    } else if (base.includes('2B')) {
      base = base.replace('2B', '18');
    }

    // If there are still non-digits, fail
    if (!/^\d+$/.test(base)) return false;

    const baseNum = BigInt(base);
    const expectedKey = Number(97n - (baseNum % 97n));
    return key === expectedKey;
  }

  return true; // 13 digits structural match
}

/**
 * Validates SIREN / SIRET using Luhn algorithm
 */
export function isValidLuhn(numStr: string): boolean {
  const clean = numStr.replace(/[\s.-]/g, '');
  if (!/^\d+$/.test(clean)) return false;

  let sum = 0;
  let alternate = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Validates US Social Security Number (SSN)
 * Must be 9 digits, Area != 000, 666, 900-999, Group != 00, Serial != 0000
 */
export function isValidUS_SSN(candidate: string): boolean {
  const clean = candidate.replace(/[\s.-]/g, '');
  if (clean.length !== 9 || !/^\d{9}$/.test(clean)) return false;

  const area = parseInt(clean.substring(0, 3), 10);
  const group = parseInt(clean.substring(3, 5), 10);
  const serial = parseInt(clean.substring(5, 9), 10);

  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;

  return true;
}

/**
 * Validates UK National Insurance Number (NINO)
 * Format: 2 prefix letters, 6 digits, suffix letter A-D (or space)
 */
export function isValidUK_NINO(candidate: string): boolean {
  const clean = candidate.replace(/[\s.-]/g, '').toUpperCase();
  if (clean.length !== 9) return false;

  const prefix = clean.substring(0, 2);
  const digits = clean.substring(2, 8);
  const suffix = clean.charAt(8);

  if (!/^\d{6}$/.test(digits)) return false;
  if (!/^[A-D]$/.test(suffix)) return false;

  // Standard UK HMRC test prefix is QQ
  if (prefix === 'QQ') return true;

  const invalidLetters = new Set(['D', 'F', 'I', 'Q', 'U', 'V']);
  if (invalidLetters.has(prefix[0]) || invalidLetters.has(prefix[1])) return false;
  if (prefix[1] === 'O') return false;

  const invalidPrefixes = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);
  if (invalidPrefixes.has(prefix)) return false;

  return true;
}

export class IdentityDetector implements DetectorPlugin {
  public name = 'IdentityDetector';
  public supportedTypes: EntityType[] = ['NIR', 'SIRET', 'SSN', 'NINO'];

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    // 1. French NIR (Secu)
    for (const match of text.matchAll(NIR_REGEX)) {
      if (match.index !== undefined) {
        const candidate = match[0];
        if (isValidNIR(candidate)) {
          results.push({
            type: 'NIR',
            value: candidate,
            start: match.index,
            end: match.index + candidate.length,
            confidence: 0.98,
            metadata: { country: 'FR' },
          });
        }
      }
    }

    // 2. SIRET Detection (14 digits with Luhn)
    for (const match of text.matchAll(SIRET_REGEX)) {
      if (match.index !== undefined) {
        const candidate = match[0];
        // Ensure no overlap with NIR
        const overlapsWithNir = results.some(
          r => match.index! >= r.start && match.index! < r.end
        );

        if (!overlapsWithNir && isValidLuhn(candidate)) {
          results.push({
            type: 'SIRET',
            value: candidate,
            start: match.index,
            end: match.index + candidate.length,
            confidence: 0.96,
            metadata: { country: 'FR', kind: 'SIRET' },
          });
        }
      }
    }

    // 3. SIREN Detection (9 digits with Luhn)
    for (const match of text.matchAll(SIREN_REGEX)) {
      if (match.index !== undefined) {
        const rawMatch = match[0];
        const numPart = match[1] || match[2] || rawMatch;
        const numStart = match.index + rawMatch.indexOf(numPart);

        // Ensure no overlap with existing NIR or SIRET
        const overlaps = results.some(
          r => Math.max(numStart, r.start) < Math.min(numStart + numPart.length, r.end)
        );

        if (!overlaps && isValidLuhn(numPart)) {
          results.push({
            type: 'SIRET',
            value: numPart,
            start: numStart,
            end: numStart + numPart.length,
            confidence: 0.95,
            metadata: { country: 'FR', kind: 'SIREN' },
          });
        }
      }
    }

    // 4. US SSN Detection (Formatted XXX-XX-XXXX)
    for (const match of text.matchAll(US_SSN_FORMATTED_REGEX)) {
      if (match.index !== undefined) {
        const candidate = match[0];
        const overlaps = results.some(
          r => Math.max(match.index!, r.start) < Math.min(match.index! + candidate.length, r.end)
        );

        if (!overlaps && isValidUS_SSN(candidate)) {
          results.push({
            type: 'SSN',
            value: candidate,
            start: match.index,
            end: match.index + candidate.length,
            confidence: 0.97,
            metadata: { country: 'US' },
          });
        }
      }
    }

    // 5. US SSN Contextual (e.g. SSN: 123456789)
    for (const match of text.matchAll(US_SSN_CONTEXT_REGEX)) {
      if (match.index !== undefined) {
        const fullMatch = match[0];
        // Extract the digits part
        const digitMatch = fullMatch.match(/(?!000|666|9\d{2})([0-8]\d{2})[- ]?(?!00)(\d{2})[- ]?(?!0000)(\d{4})\b/);
        if (digitMatch && digitMatch.index !== undefined) {
          const ssnVal = digitMatch[0];
          const ssnStart = match.index + digitMatch.index;
          const ssnEnd = ssnStart + ssnVal.length;

          const overlaps = results.some(
            r => Math.max(ssnStart, r.start) < Math.min(ssnEnd, r.end)
          );

          if (!overlaps && isValidUS_SSN(ssnVal)) {
            results.push({
              type: 'SSN',
              value: ssnVal,
              start: ssnStart,
              end: ssnEnd,
              confidence: 0.98,
              metadata: { country: 'US', context: true },
            });
          }
        }
      }
    }

    // 6. UK NINO Detection (Formatted standard QQ 12 34 56 A or unspaced)
    for (const match of text.matchAll(UK_NINO_REGEX)) {
      if (match.index !== undefined) {
        const candidate = match[0];
        const overlaps = results.some(
          r => Math.max(match.index!, r.start) < Math.min(match.index! + candidate.length, r.end)
        );

        if (!overlaps && isValidUK_NINO(candidate)) {
          results.push({
            type: 'NINO',
            value: candidate,
            start: match.index,
            end: match.index + candidate.length,
            confidence: 0.97,
            metadata: { country: 'UK' },
          });
        }
      }
    }

    // 7. UK NINO Contextual (e.g. National Insurance: ...)
    for (const match of text.matchAll(UK_NINO_CONTEXT_REGEX)) {
      if (match.index !== undefined) {
        const fullMatch = match[0];
        const ninoMatch = fullMatch.match(/([A-Za-z]{2})[\s.-]?(\d{2})[\s.-]?(\d{2})[\s.-]?(\d{2})[\s.-]?([A-D])\b/);
        if (ninoMatch && ninoMatch.index !== undefined) {
          const ninoVal = ninoMatch[0];
          const ninoStart = match.index + ninoMatch.index;
          const ninoEnd = ninoStart + ninoVal.length;

          const overlaps = results.some(
            r => Math.max(ninoStart, r.start) < Math.min(ninoEnd, r.end)
          );

          if (!overlaps && isValidUK_NINO(ninoVal)) {
            results.push({
              type: 'NINO',
              value: ninoVal,
              start: ninoStart,
              end: ninoEnd,
              confidence: 0.98,
              metadata: { country: 'UK', context: true },
            });
          }
        }
      }
    }

    return results;
  }
}
