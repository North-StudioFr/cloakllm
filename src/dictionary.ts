/**
 * CloakLLM Business Dictionary & Config Loader
 * Loads, parses and validates enterprise dictionaries and custom regex patterns.
 * Supports zero-dependency JSON and YAML formats.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BusinessDictionaryEntry, CustomPatternRule, CustomRulesConfig, EntityType } from './types.ts';

/**
 * Parses simple YAML configuration without any external npm dependency.
 * Supports:
 * - dictionaries:
 *     - name: internal_projects
 *       type: PROJECT
 *       terms:
 *         - Project Titan
 *         - Apollo-11
 * - customPatterns:
 *     - name: internal_ip
 *       type: INTERNAL_IP
 *       pattern: "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}"
 */
function parseYamlBoolean(val: string): boolean {
  const lower = val.toLowerCase().trim();
  return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'on';
}

function parseInlineYamlArray(val: string): string[] {
  const trimmed = val.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.substring(1, trimmed.length - 1).trim();
    if (!inner) return [];
    const items: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if ((c === '"' || c === "'") && (i === 0 || inner[i - 1] !== '\\')) {
        if (inQuotes && c === quoteChar) {
          inQuotes = false;
        } else if (!inQuotes) {
          inQuotes = true;
          quoteChar = c;
        }
      } else if (c === ',' && !inQuotes) {
        items.push(current.trim().replace(/^['"]|['"]$/g, ''));
        current = '';
        continue;
      }
      current += c;
    }
    if (current.trim()) {
      items.push(current.trim().replace(/^['"]|['"]$/g, ''));
    }
    return items.filter(Boolean);
  }
  return [];
}

/**
 * Parses simple YAML configuration without any external npm dependency.
 * Supports:
 * - dictionaries:
 *     - name: internal_projects
 *       type: PROJECT
 *       terms:
 *         - Project Titan
 *         - Apollo-11
 * - customPatterns:
 *     - name: internal_ip
 *       type: INTERNAL_IP
 *       pattern: "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}"
 */
export function parseSimpleYaml(content: string): CustomRulesConfig {
  const lines = content.split(/\r?\n/);
  const config: CustomRulesConfig = {
    dictionaries: [],
    customPatterns: [],
  };

  let currentSection: 'dictionaries' | 'customPatterns' | null = null;
  let currentDict: Partial<BusinessDictionaryEntry> | null = null;
  let currentPattern: Partial<CustomPatternRule> | null = null;
  let inTermsList = false;
  let termsIndent = -1;

  for (let rawLine of lines) {
    // Strip comments
    const hashIndex = rawLine.indexOf('#');
    let line = hashIndex !== -1 ? rawLine.substring(0, hashIndex) : rawLine;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.search(/\S/);

    if (trimmed === 'dictionaries:') {
      currentSection = 'dictionaries';
      inTermsList = false;
      currentDict = null;
      continue;
    } else if (trimmed === 'customPatterns:' || trimmed === 'custom_patterns:') {
      currentSection = 'customPatterns';
      inTermsList = false;
      currentPattern = null;
      continue;
    }

    if (currentSection === 'dictionaries') {
      const isNewDict = (!inTermsList && (trimmed.startsWith('- name:') || (trimmed.startsWith('-') && trimmed.includes('name:')))) ||
        (inTermsList && indent <= (termsIndent > 0 ? termsIndent - 2 : 2) && trimmed.startsWith('-') && trimmed.includes('name:'));

      if (isNewDict) {
        inTermsList = false;
        termsIndent = -1;
        const nameVal = trimmed.split('name:')[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
        currentDict = { name: nameVal, terms: [] };
        config.dictionaries!.push(currentDict as BusinessDictionaryEntry);
        continue;
      }

      if (currentDict) {
        if (trimmed.startsWith('type:')) {
          inTermsList = false;
          currentDict.type = trimmed.split('type:')[1]?.trim().replace(/^['"]|['"]$/g, '') as EntityType;
        } else if (trimmed.startsWith('caseSensitive:') || trimmed.startsWith('case_sensitive:')) {
          inTermsList = false;
          const boolVal = trimmed.split(':')[1]?.trim() || '';
          currentDict.caseSensitive = parseYamlBoolean(boolVal);
        } else if (trimmed.startsWith('terms:')) {
          const rest = trimmed.substring('terms:'.length).trim();
          if (rest.startsWith('[') && rest.endsWith(']')) {
            inTermsList = false;
            currentDict.terms = parseInlineYamlArray(rest);
          } else {
            inTermsList = true;
            termsIndent = indent;
          }
        } else if (inTermsList && trimmed.startsWith('-')) {
          const term = trimmed.replace(/^-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
          if (term) {
            currentDict.terms = currentDict.terms || [];
            currentDict.terms.push(term);
          }
        }
      }
    } else if (currentSection === 'customPatterns') {
      if (trimmed.startsWith('- name:') || (trimmed.startsWith('-') && trimmed.includes('name:'))) {
        const nameVal = trimmed.split('name:')[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
        currentPattern = { name: nameVal };
        config.customPatterns!.push(currentPattern as CustomPatternRule);
        continue;
      }

      if (currentPattern) {
        if (trimmed.startsWith('type:')) {
          currentPattern.type = trimmed.split('type:')[1]?.trim().replace(/^['"]|['"]$/g, '') as EntityType;
        } else if (trimmed.startsWith('pattern:')) {
          const rawPat = trimmed.split('pattern:')[1]?.trim() || '';
          currentPattern.pattern = rawPat.replace(/^['"]|['"]$/g, '');
        } else if (trimmed.startsWith('caseSensitive:') || trimmed.startsWith('case_sensitive:')) {
          const boolVal = trimmed.split(':')[1]?.trim() || '';
          currentPattern.caseSensitive = parseYamlBoolean(boolVal);
        }
      }
    }
  }

  return config;
}

/**
 * Parses JSON or YAML configuration content into CustomRulesConfig.
 */
export function parseConfig(content: string): CustomRulesConfig {
  const trimmed = content.trim();
  if (!trimmed) {
    return { dictionaries: [], customPatterns: [] };
  }

  // Attempt JSON parsing first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeConfig(parsed);
    } catch {
      // Fall through to YAML parser
    }
  }

  return normalizeConfig(parseSimpleYaml(content));
}

/**
 * Normalizes and validates configuration object.
 */
export function normalizeConfig(raw: any): CustomRulesConfig {
  const config: CustomRulesConfig = {
    dictionaries: [],
    customPatterns: [],
  };

  if (!raw || typeof raw !== 'object') {
    return config;
  }

  // Dictionaries
  const dictList = raw.dictionaries || raw.Dictionaries || [];
  if (Array.isArray(dictList)) {
    for (const d of dictList) {
      if (d && typeof d === 'object' && d.name && Array.isArray(d.terms)) {
        config.dictionaries!.push({
          name: String(d.name),
          type: (d.type ? String(d.type).toUpperCase() : 'CUSTOM') as EntityType,
          terms: d.terms.map((t: any) => String(t).trim()).filter(Boolean),
          caseSensitive: Boolean(d.caseSensitive || d.case_sensitive),
        });
      }
    }
  }

  // Custom Patterns
  const patternsList = raw.customPatterns || raw.custom_patterns || raw.patterns || [];
  if (Array.isArray(patternsList)) {
    for (const p of patternsList) {
      if (p && typeof p === 'object' && p.name && p.pattern) {
        config.customPatterns!.push({
          name: String(p.name),
          type: (p.type ? String(p.type).toUpperCase() : 'CUSTOM') as EntityType,
          pattern: p.pattern,
          caseSensitive: Boolean(p.caseSensitive || p.case_sensitive),
        });
      }
    }
  }

  return config;
}

/**
 * Loads configuration file from disk.
 */
export function loadConfigFile(filePath: string): CustomRulesConfig {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Configuration file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  return parseConfig(content);
}

/**
 * Generates sample enterprise configuration template.
 */
export function generateSampleConfig(): string {
  const sample = {
    dictionaries: [
      {
        name: 'confidential_projects',
        type: 'PROJECT',
        terms: [
          'Project Titan',
          'Operation Starlight',
          'Apollo-11',
          'Pegasus Vault',
        ],
        caseSensitive: false,
      },
      {
        name: 'vip_corporate_clients',
        type: 'CLIENT',
        terms: [
          'Acme Global Corp',
          'Cyberdyne Systems',
          'Wayne Enterprises',
          'Stark Industries',
        ],
        caseSensitive: false,
      },
      {
        name: 'internal_infrastructure',
        type: 'INTERNAL_IP',
        terms: [
          '10.0.0.1',
          '10.0.4.15',
          '192.168.1.100',
        ],
      },
    ],
    customPatterns: [
      {
        name: 'employee_badge_id',
        type: 'EMPLOYEE_ID',
        pattern: 'EMP-[0-9]{5,7}',
      },
      {
        name: 'internal_hostnames',
        type: 'INTERNAL_HOST',
        pattern: 'srv-[a-z0-9-]+\\.internal\\.corp',
      },
    ],
  };

  return JSON.stringify(sample, null, 2);
}
