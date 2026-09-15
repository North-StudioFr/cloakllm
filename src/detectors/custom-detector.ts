/**
 * CloakLLM Custom Business Dictionaries & Rules Detector
 * Allows enterprises to register confidential project codenames, VIP clients,
 * internal server IDs, and custom regex patterns.
 */

import type {
  BusinessDictionaryEntry,
  CustomPatternRule,
  CustomRulesConfig,
  DetectedEntity,
  DetectorPlugin,
  EntityType,
} from '../types.ts';

export class CustomRulesDetector implements DetectorPlugin {
  public readonly name = 'CustomRulesDetector';
  public supportedTypes: EntityType[] = [];

  private dictionaries: BusinessDictionaryEntry[] = [];
  private patternRules: CustomPatternRule[] = [];

  constructor(config?: CustomRulesConfig) {
    if (config?.dictionaries) {
      for (const d of config.dictionaries) {
        this.addDictionary(d);
      }
    }
    if (config?.customPatterns) {
      for (const p of config.customPatterns) {
        this.addPattern(p);
      }
    }
  }

  public addDictionary(entry: BusinessDictionaryEntry): void {
    this.dictionaries.push(entry);
    if (!this.supportedTypes.includes(entry.type)) {
      this.supportedTypes.push(entry.type);
    }
  }

  public addPattern(rule: CustomPatternRule): void {
    this.patternRules.push(rule);
    if (!this.supportedTypes.includes(rule.type)) {
      this.supportedTypes.push(rule.type);
    }
  }

  public detect(text: string): DetectedEntity[] {
    if (!text || typeof text !== 'string') return [];

    const matches: DetectedEntity[] = [];

    // 1. Match business dictionary terms
    // Flatten and sort terms by length descending to prioritize longer phrases
    interface FlatTerm {
      term: string;
      type: EntityType;
      dictionaryName: string;
      caseSensitive: boolean;
    }

    const flatTerms: FlatTerm[] = [];
    for (const dict of this.dictionaries) {
      for (const term of dict.terms) {
        if (term && term.trim().length > 0) {
          flatTerms.push({
            term: term.trim(),
            type: dict.type,
            dictionaryName: dict.name,
            caseSensitive: Boolean(dict.caseSensitive),
          });
        }
      }
    }

    flatTerms.sort((a, b) => b.term.length - a.term.length);

    for (const item of flatTerms) {
      const escaped = item.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Word boundary compatible with Unicode characters
      const regex = new RegExp(
        `(?:^|(?<=[^\\p{L}\\p{N}_]))${escaped}(?=[^\\p{L}\\p{N}_]|$)`,
        item.caseSensitive ? 'gu' : 'giu'
      );

      for (const match of text.matchAll(regex)) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;

        matches.push({
          type: item.type,
          value: text.substring(start, end),
          start,
          end,
          confidence: 1.0,
          metadata: {
            source: 'dictionary',
            dictionary: item.dictionaryName,
          },
        });
      }
    }

    // 2. Match custom regex patterns
    for (const rule of this.patternRules) {
      let regex: RegExp;
      if (rule.pattern instanceof RegExp) {
        let flags = rule.pattern.flags;
        if (!flags.includes('g')) flags += 'g';
        if (!flags.includes('u')) flags += 'u';
        if (!rule.caseSensitive && !flags.includes('i')) flags += 'i';
        regex = new RegExp(rule.pattern.source, flags);
      } else {
        const flags = rule.caseSensitive ? 'gu' : 'giu';
        try {
          regex = new RegExp(rule.pattern, flags);
        } catch {
          continue;
        }
      }

      for (const match of text.matchAll(regex)) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;

        if (end > start) {
          matches.push({
            type: rule.type,
            value: text.substring(start, end),
            start,
            end,
            confidence: 0.98,
            metadata: {
              source: 'custom_pattern',
              ruleName: rule.name,
            },
          });
        }
      }
    }

    // 3. Deduplicate and resolve internal overlaps
    return this.deduplicateOverlaps(matches);
  }

  private deduplicateOverlaps(matches: DetectedEntity[]): DetectedEntity[] {
    if (matches.length <= 1) return matches;

    // Sort by length desc, confidence desc, start asc
    const sorted = [...matches].sort((a, b) => {
      const lenDiff = (b.end - b.start) - (a.end - a.start);
      if (lenDiff !== 0) return lenDiff;
      const confDiff = b.confidence - a.confidence;
      if (confDiff !== 0) return confDiff;
      return a.start - b.start;
    });

    const accepted: DetectedEntity[] = [];
    for (const candidate of sorted) {
      const overlaps = accepted.some(acc =>
        Math.max(candidate.start, acc.start) < Math.min(candidate.end, acc.end)
      );
      if (!overlaps) {
        accepted.push(candidate);
      }
    }

    return accepted.sort((a, b) => a.start - b.start);
  }
}
