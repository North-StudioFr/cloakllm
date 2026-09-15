/**
 * CloakLLM Deterministic Prompt Firewall & Unicode Canonicalizer
 * Provides NFKC normalization, zero-width stripping, homoglyph decoding,
 * and high-speed weighted heuristic detection for prompt injection and jailbreaks.
 * Zero external dependencies. Execution latency < 1ms.
 */

import type { FirewallConfig, FirewallPatternMatch, FirewallResult } from './types.ts';

// Homoglyph lookup table: maps visually confusable Cyrillic, Greek, and Fullwidth characters to Latin equivalents
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic lowercase
  'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd',
  // Cyrillic uppercase
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'Ј': 'J', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Ѕ': 'S', 'Т': 'T', 'Х': 'X',
  // Greek lowercase / uppercase
  'α': 'a', 'β': 'b', 'γ': 'g', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Р': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
};

// Zero-width characters and invisible formatting markers regex
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2060-\u2064\u00AD]/g;

// Control characters (excluding newline \n, CR \r, and tab \t)
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Normalizes text to prevent Unicode obfuscation, homoglyph bypasses, and invisible payload smuggling.
 */
export function normalizeUnicode(text: string): string {
  if (!text) return '';

  // 1. Unicode NFKC (Compatibility Decomposition followed by Canonical Composition)
  let normalized = text.normalize('NFKC');

  // 2. Strip zero-width and invisible control characters
  normalized = normalized.replace(ZERO_WIDTH_REGEX, '').replace(CONTROL_CHARS_REGEX, '');

  // 3. Normalize common homoglyphs to standard Latin
  let homoglyphCleaned = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    homoglyphCleaned += HOMOGLYPH_MAP[char] || char;
  }

  return homoglyphCleaned;
}

interface HeuristicRule {
  category: 'INSTRUCTION_OVERRIDE' | 'SYSTEM_PROMPT_EXTRACTION' | 'ROLEPLAY_JAILBREAK' | 'DELIMITER_SMUGGLING' | 'OBFUSCATION_INDICATORS';
  pattern: RegExp;
  weight: number;
}

const FIREWALL_RULES: HeuristicRule[] = [
  // 1. Instruction Override / Hijack (weight 50)
  {
    category: 'INSTRUCTION_OVERRIDE',
    pattern: /\b(?:ignore|disregard|forget|bypass|override|drop)\s+(?:all\s+)?(?:previous|prior|earlier|above|initial)\s+(?:instructions|rules|prompts|guidelines|directives|constraints)\b/i,
    weight: 50,
  },
  {
    category: 'INSTRUCTION_OVERRIDE',
    pattern: /\b(?:ignore|oublie|contourne|annule|supprime)\s+(?:toutes?\s+)?(?:les\s+)?(?:instructions|consignes|directives|regles|règles)\s+(?:précédentes|precedentes|antérieures|anterieures|initiales)\b/i,
    weight: 50,
  },
  {
    category: 'INSTRUCTION_OVERRIDE',
    pattern: /\b(?:system\s+override|reset\s+(?:all\s+)?instructions|new\s+instructions\s+(?:take\s+precedence|follow)|stop\s+following\s+rules)\b/i,
    weight: 50,
  },
  {
    category: 'INSTRUCTION_OVERRIDE',
    pattern: /\b(?:ne\s+suis\s+plus\s+(?:les|aucune)\s+r[eè]gles|nouvelles?\s+instructions?\s+prioritaires?)\b/i,
    weight: 50,
  },
  {
    category: 'INSTRUCTION_OVERRIDE',
    pattern: /\b(?:do\s+not\s+follow\s+any\s+(?:prior|previous|existing)\s+rules)\b/i,
    weight: 50,
  },

  // 2. System Prompt Extraction / Exfiltration (weight 45)
  {
    category: 'SYSTEM_PROMPT_EXTRACTION',
    pattern: /\b(?:repeat|print|show|display|echo|output|reveal|dump)\s+(?:everything|all|the\s+text)\s+(?:above|prior|before|from\s+the\s+beginning)\b/i,
    weight: 45,
  },
  {
    category: 'SYSTEM_PROMPT_EXTRACTION',
    pattern: /\b(?:r[eé]p[eè]te|affiche|montre|donne|r[eé]v[eè]le)\s+(?:tout\s+)?(?:le\s+)?(?:prompt\s+syst[eè]me|instructions?\s+syst[eè]me|texte\s+ci-dessus)\b/i,
    weight: 45,
  },
  {
    category: 'SYSTEM_PROMPT_EXTRACTION',
    pattern: /\b(?:what\s+(?:are|were)\s+(?:your|the)\s+(?:initial\s+|original\s+|system\s+)*(?:prompts?|instructions?|rules?|guidelines?))\b/i,
    weight: 45,
  },
  {
    category: 'SYSTEM_PROMPT_EXTRACTION',
    pattern: /\b(?:quelles?\s+(?:sont|etaient|étaient)\s+(?:tes|vos)\s+(?:instructions|directives)\s+initiales)\b/i,
    weight: 45,
  },
  {
    category: 'SYSTEM_PROMPT_EXTRACTION',
    pattern: /\b(?:output\s+your\s+(?:system\s+prompt|initialization\s+instructions?|secret\s+key))\b/i,
    weight: 45,
  },

  // 3. Roleplay Jailbreak / DAN / Uncensored modes (weight 50)
  {
    category: 'ROLEPLAY_JAILBREAK',
    pattern: /\b(?:dan\s+mode|do\s+anything\s+now|jailbreak(?:\s+mode)?|developer\s+mode\s+enabled)\b/i,
    weight: 50,
  },
  {
    category: 'ROLEPLAY_JAILBREAK',
    pattern: /\b(?:uncensored\s+mode|always\s+agree\s+and\s+answer\s+unfiltered|hypothetical\s+scenario\s+where\s+ethics\s+are\s+disabled)\b/i,
    weight: 50,
  },
  {
    category: 'ROLEPLAY_JAILBREAK',
    pattern: /\b(?:mode\s+sans\s+filtre|fais\s+n['’]importe\s+quoi\s+maintenant|ignore\s+l['’][eé]thique)\b/i,
    weight: 50,
  },
  {
    category: 'ROLEPLAY_JAILBREAK',
    pattern: /\b(?:pretend\s+(?:you\s+are\s+an?\s+unrestricted|there\s+are\s+no\s+(?:rules|filters|safety)))\b/i,
    weight: 45,
  },
  {
    category: 'ROLEPLAY_JAILBREAK',
    pattern: /\b(?:fais\s+comme\s+si\s+tu\s+n['’]avais\s+aucune\s+r[eè]gle|agis\s+sans\s+aucune\s+limite)\b/i,
    weight: 45,
  },

  // 4. Delimiter & Prompt Boundary Smuggling (weight 35)
  {
    category: 'DELIMITER_SMUGGLING',
    pattern: /(?:---|===|###)\s*(?:BEGIN|START|SYSTEM)\s+(?:SYSTEM|PROMPT|INSTRUCTIONS)[\s\S]*?(?:---|===|###)/i,
    weight: 35,
  },
  {
    category: 'DELIMITER_SMUGGLING',
    pattern: /<\/?(?:system|instruction|admin|prompt_context)>/i,
    weight: 35,
  },
  {
    category: 'DELIMITER_SMUGGLING',
    pattern: /(?:\[(?:SYSTEM|ADMIN|INTERNAL)\s*(?:PROMPT|MODE|OVERRIDE)?\]|<<SYS>>|<\|im_start\|>system)/i,
    weight: 35,
  },

  // 5. Obfuscation & Indirect Execution Indicators (weight 30)
  {
    category: 'OBFUSCATION_INDICATORS',
    pattern: /\b(?:base64\s+decode\s+and\s+execute|rot13\s+decode|execute\s+hex\s+encoded)\b/i,
    weight: 30,
  },
];

export class PromptFirewall {
  private threshold: number;
  private customRules: HeuristicRule[];

  constructor(config?: FirewallConfig) {
    this.threshold = config?.riskThreshold ?? 40;
    this.customRules = [];

    if (config?.customPatterns) {
      for (const rule of config.customPatterns) {
        this.customRules.push({
          category: (rule.category as any) || 'INSTRUCTION_OVERRIDE',
          pattern: typeof rule.pattern === 'string' ? new RegExp(rule.pattern, 'i') : rule.pattern,
          weight: rule.weight || 25,
        });
      }
    }
  }

  /**
   * Inspects text for prompt injection, jailbreak attempts, and system prompt extraction.
   * Runs in < 1ms deterministically.
   */
  public inspect(text: string): FirewallResult {
    const normalized = normalizeUnicode(text);
    const matchedPatterns: FirewallPatternMatch[] = [];
    const triggeredCategories = new Set<string>();
    let totalScore = 0;

    const allRules = [...FIREWALL_RULES, ...this.customRules];

    for (const rule of allRules) {
      const match = normalized.match(rule.pattern);
      if (match) {
        matchedPatterns.push({
          category: rule.category,
          match: match[0],
          weight: rule.weight,
        });

        // Ensure each category adds its weight once to prevent over-inflation from redundant rules
        if (!triggeredCategories.has(rule.category)) {
          triggeredCategories.add(rule.category);
          totalScore += rule.weight;
        }
      }
    }

    const riskScore = Math.min(100, totalScore);
    const safe = riskScore < this.threshold;

    return {
      safe,
      riskScore,
      flags: Array.from(triggeredCategories),
      normalizedText: normalized,
      matchedPatterns,
    };
  }
}
