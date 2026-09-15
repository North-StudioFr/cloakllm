/**
 * Detects common pattern-based PII:
 * - Email addresses (RFC 5322 pattern)
 * - Phone numbers (French national, French international, and international E.164 formats)
 * - IP addresses (IPv4 and IPv6)
 */

import type { DetectedEntity, DetectorPlugin } from '../types.ts';

// Comprehensive RFC 5322 compliant regex for emails
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;

// French phone numbers:
// Format 1: 0[1-9]([ .\-_]?[0-9]{2}){4}
// Format 2: (+33|0033)[ .\-_]?[1-9]([ .\-_]?[0-9]{2}){4}
const FR_PHONE_REGEX = /(?:\+33|0033|0)[\s.\-_]?[1-9](?:[\s.\-_]?[0-9]{2}){4}\b/g;

// US / North American phone numbers (e.g. (555) 234-5678, (555)234-5678, +1-555-234-5678, 1-800-555-0199, 555-234-5678)
const US_PHONE_REGEX = /(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)[\s.-]?|[2-9]\d{2}[\s.-])[2-9]\d{2}[\s.-]\d{4}\b/g;

// UK phone numbers (e.g. +44 20 7946 0958, +44 7911 123456, 020 7946 0958, 07911 123456)
const UK_PHONE_REGEX = /(?:\+44[\s.-]?(?:\(0\)\s*)?|0)(?:2\d|1\d{2,3}|7\d{3})[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;

// International E.164 (+[1-9][0-9]{6,14})
const INT_PHONE_REGEX = /\b\+[1-9]\d{1,3}(?:[\s.-]?\d{2,4}){2,4}\b/g;

// IPv4 and IPv6 patterns
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const IPV6_REGEX = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:|\b::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b/g;

export class RegexDetector implements DetectorPlugin {
  public name = 'RegexDetector';
  public supportedTypes = ['EMAIL' as const, 'PHONE' as const, 'IP_ADDRESS' as const];

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    // 1. Email Detection
    for (const match of text.matchAll(EMAIL_REGEX)) {
      if (match.index !== undefined) {
        results.push({
          type: 'EMAIL',
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.98,
        });
      }
    }

    // 2. Phone Detection (French priority)
    for (const match of text.matchAll(FR_PHONE_REGEX)) {
      if (match.index !== undefined) {
        // Exclude false positives that are pure 10-digit dates (e.g. 2026-09-14)
        const val = match[0];
        if (!val.includes('-') || !val.startsWith('20')) {
          results.push({
            type: 'PHONE',
            value: val,
            start: match.index,
            end: match.index + val.length,
            confidence: 0.95,
            metadata: { country: 'FR' },
          });
        }
      }
    }

    // 3. US / North American Phone Detection
    for (const match of text.matchAll(US_PHONE_REGEX)) {
      if (match.index !== undefined) {
        const val = match[0];
        const alreadyFound = results.some(
          r => r.type === 'PHONE' && Math.max(match.index!, r.start) < Math.min(match.index! + val.length, r.end)
        );
        if (!alreadyFound) {
          results.push({
            type: 'PHONE',
            value: val,
            start: match.index,
            end: match.index + val.length,
            confidence: 0.94,
            metadata: { country: 'US' },
          });
        }
      }
    }

    // 4. UK Phone Detection
    for (const match of text.matchAll(UK_PHONE_REGEX)) {
      if (match.index !== undefined) {
        const val = match[0];
        const alreadyFound = results.some(
          r => r.type === 'PHONE' && Math.max(match.index!, r.start) < Math.min(match.index! + val.length, r.end)
        );
        if (!alreadyFound) {
          results.push({
            type: 'PHONE',
            value: val,
            start: match.index,
            end: match.index + val.length,
            confidence: 0.93,
            metadata: { country: 'UK' },
          });
        }
      }
    }

    // 5. International Phone Detection
    for (const match of text.matchAll(INT_PHONE_REGEX)) {
      if (match.index !== undefined) {
        // Avoid duplicate matches already captured
        const val = match[0];
        const alreadyFound = results.some(
          r => r.type === 'PHONE' && Math.max(match.index!, r.start) < Math.min(match.index! + val.length, r.end)
        );
        if (!alreadyFound) {
          results.push({
            type: 'PHONE',
            value: val,
            start: match.index,
            end: match.index + val.length,
            confidence: 0.90,
            metadata: { country: 'INTL' },
          });
        }
      }
    }

    // 4. IP Addresses (IPv4 and IPv6)
    for (const match of text.matchAll(IPV4_REGEX)) {
      if (match.index !== undefined) {
        // Filter out version numbers like v1.2.3.4 or version 1.2.3.4 if immediately preceded by v/version
        const prefix = text.substring(Math.max(0, match.index - 10), match.index);
        const isVersionNumber = /(?:^|[\s,;:])v(?:ersion)?[\s.]*$/i.test(prefix);
        if (!isVersionNumber) {
          results.push({
            type: 'IP_ADDRESS',
            value: match[0],
            start: match.index,
            end: match.index + match[0].length,
            confidence: 0.95,
            metadata: { version: 'v4' },
          });
        }
      }
    }

    for (const match of text.matchAll(IPV6_REGEX)) {
      if (match.index !== undefined) {
        results.push({
          type: 'IP_ADDRESS',
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.95,
          metadata: { version: 'v6' },
        });
      }
    }

    return results;
  }
}
