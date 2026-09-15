/**
 * Contextual and Heuristic Named Entity Recognition (NER):
 * - PERSON: Honorifics (M., Mme, Dr., etc.) and capitalized first/last names
 * - ORGANIZATION: Corporate suffixes (SARL, SAS, SA, Inc., LLC) and enterprise names
 * - Custom customizable dictionary
 */

import type { DetectedEntity, DetectorPlugin } from '../types.ts';

// Common French/English honorifics & courtesy titles
// Handles standalone honorifics or preceded by greeting (e.g. "Dear Mr. John Smith", "Bonjour M. Dupont", "Dr. Watson", "Professor Alan Turing")
const PERSON_PREFIX_REGEX = /\b(?:(?:Bonjour|Salut|Hello|Hi|Dear|Cher|Chère)\s+)?(?:M\.|Mme|Mlle|Monsieur|Madame|Mademoiselle|Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Doctor|Docteur|Prof\.?|Professor|Professeur|Ma[iî]tre|Me\b|Sir|Lady|Lord)\s+([A-ZÀ-ÖØ-ß][a-zà-öø-ÿ]+(?:[- ][A-ZÀ-ÖØ-ß][a-zà-öø-ÿ]+){0,3})\b|\b(?:Bonjour|Salut|Hello|Hi|Dear|Cher|Chère)\s+([A-ZÀ-ÖØ-ß][a-zà-öø-ÿ]+(?:[- ][A-ZÀ-ÖØ-ß][a-zà-öø-ÿ]+){0,2})\b/gu;

// Standalone full capitalized names when in typical correspondence context (e.g. "employé Jean Dupont" or "Customer: John Smith")
const PERSON_CONTEXT_REGEX = /\b(?:[Pp]atient|[Cc]lient|[Cc]ustomer|[Ss]alarié|[Ee]mployé|[Ee]mployee|[Ww]orker|[Cc]ollaborateur|[Cc]andidat|[Cc]andidate|[Cc]ontact|[Mm]onsieur|[Mm]adame|[Uu]ser|[Uu]tilisateur|[Nn]ame|[Pp]erson)\s*:\s*([A-ZÀ-ÖØ-ß][a-zà-öø-ÿ]+(?:[- ][A-ZÀ-ÖØ-ß][a-zà-öø-ÿ]+){0,2})\b/gu;

// Exclude honorifics or conversational words from being falsely tagged as person names
const EXCLUDED_NAME_WORDS = new Set([
  'monsieur', 'madame', 'mademoiselle', 'docteur', 'doctor', 'professeur', 'professor', 'maitre', 'maître',
  'm.', 'mme', 'dr', 'me', 'prof', 'mr', 'mrs', 'ms', 'miss', 'sir', 'lord', 'lady',
  'tous', 'tout', 'tout le monde', 'everyone', 'all', 'welcome', 'thanks', 'thank you',
  'merci', 'cordialement', 'bienvenue', 'bonjour', 'salut', 'hello', 'hi', 'dear',
  'client', 'patient', 'customer', 'employee', 'candidate', 'user', 'name', 'person',
  'utilisateur', 'contact', 'dossier', 'projet', 'project', 'societe', 'société',
  'entreprise', 'company', 'corporation', 'agency', 'bank', 'hospital'
]);

// Corporate suffixes & prefixes (French & Anglo-Saxon)
const ORG_SUFFIX_REGEX = /\b([A-ZÀ-ÖØ-ß0-9][A-Za-zÀ-ÖØ-ß0-9&.\-_]*(?:\s+[A-ZÀ-ÖØ-ß0-9&][A-Za-zÀ-ÖØ-ß0-9&.\-_]*){0,3})\s+(?:SARL|SAS|SASU|SA|EURL|SCI|GIE|Inc\.?|LLC|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|GmbH|PLC|LLP|LP|Holdings)\b/g;
const ORG_PREFIX_REGEX = /\b(?:[Gg]roupe|[Ss]ociété|[Ee]ntreprise|[Cc]abinet|[Bb]anque|[Mm]utuelle|[Aa]ssurance|[Aa]gence|[Cc]linique|[Hh]ôpital|[Cc]ompany|[Cc]orporation|[Gg]roup|[Bb]ank|[Hh]ospital|[Cc]linic|[Aa]gency|[Ff]irm|[Hh]oldings)\s+([A-ZÀ-ÖØ-ß0-9][A-Za-zÀ-ÖØ-ß0-9&.\-_]*(?:\s+[A-ZÀ-ÖØ-ß0-9&][A-Za-zÀ-ÖØ-ß0-9&.\-_]*){0,2})\b/g;

// High-profile enterprise names often present in corporate prompts (French & International)
const KNOWN_ORGS = new Set([
  'bnp paribas', 'société générale', 'credit agricole', 'crédit agricole',
  'bpce', 'axa', 'totalenergies', 'sanofi', 'l\'oreal', 'loreal',
  'renault', 'stellantis', 'airbus', 'carrefour', 'danone', 'orange',
  'capgemini', 'thales', 'veolia', 'engie', 'michelin', 'bouygues',
  'dassault systemes', 'dassault aviation', 'saint-gobain', 'vinci',
  'kering', 'lvmh', 'hermes', 'alstom', 'publicis', 'sncf', 'edf',
  'apple', 'microsoft', 'google', 'amazon', 'meta', 'nvidia', 'netflix',
  'openai', 'anthropic', 'tesla', 'goldman sachs', 'jpmorgan', 'morgan stanley',
  'barclays', 'hsbc', 'deepmind',
]);

export class NerHeuristicDetector implements DetectorPlugin {
  public name = 'NerHeuristicDetector';
  public supportedTypes = ['PERSON' as const, 'ORGANIZATION' as const];
  private customEntities: Map<string, 'PERSON' | 'ORGANIZATION'> = new Map();

  constructor(customEntities?: Record<string, 'PERSON' | 'ORGANIZATION'>) {
    if (customEntities) {
      for (const [key, type] of Object.entries(customEntities)) {
        this.customEntities.set(key.toLowerCase(), type);
      }
    }
  }

  public registerEntity(name: string, type: 'PERSON' | 'ORGANIZATION'): void {
    this.customEntities.set(name.toLowerCase(), type);
  }

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];

    // 1. Person with Honorific (M. Jean Dupont, Mr. John Smith, Dr. Jane Watson)
    for (const match of text.matchAll(PERSON_PREFIX_REGEX)) {
      const namePart = match[1] || match[2];
      if (match.index !== undefined && namePart) {
        const fullMatch = match[0];
        if (!EXCLUDED_NAME_WORDS.has(namePart.toLowerCase())) {
          const nameStart = match.index + fullMatch.lastIndexOf(namePart);

          results.push({
            type: 'PERSON',
            value: namePart,
            start: nameStart,
            end: nameStart + namePart.length,
            confidence: 0.92,
          });
        }
      }
    }

    // 2. Person with Context label (Client: Jean Dupont, Client: Dupont)
    for (const match of text.matchAll(PERSON_CONTEXT_REGEX)) {
      if (match.index !== undefined && match[1]) {
        const fullMatch = match[0];
        const namePart = match[1];
        if (!EXCLUDED_NAME_WORDS.has(namePart.toLowerCase())) {
          const nameStart = match.index + fullMatch.indexOf(namePart);

          results.push({
            type: 'PERSON',
            value: namePart,
            start: nameStart,
            end: nameStart + namePart.length,
            confidence: 0.90,
          });
        }
      }
    }

    // 3. Organization with Suffix (Acme Corp, Dupont SARL)
    for (const match of text.matchAll(ORG_SUFFIX_REGEX)) {
      if (match.index !== undefined) {
        results.push({
          type: 'ORGANIZATION',
          value: match[0].trim(),
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.94,
        });
      }
    }

    // 4. Organization with Prefix (Cabinet Jones, Groupe Alpha)
    for (const match of text.matchAll(ORG_PREFIX_REGEX)) {
      if (match.index !== undefined) {
        results.push({
          type: 'ORGANIZATION',
          value: match[0].trim(),
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.93,
        });
      }
    }

    // 5. Known Organizations & Custom Registered Entities
    const lowerText = text.toLowerCase();

    for (const org of KNOWN_ORGS) {
      let searchPos = 0;
      while ((searchPos = lowerText.indexOf(org, searchPos)) !== -1) {
        // Boundary check
        const before = searchPos === 0 ? ' ' : lowerText[searchPos - 1];
        const after = searchPos + org.length >= lowerText.length ? ' ' : lowerText[searchPos + org.length];
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          results.push({
            type: 'ORGANIZATION',
            value: text.substring(searchPos, searchPos + org.length),
            start: searchPos,
            end: searchPos + org.length,
            confidence: 0.95,
          });
        }
        searchPos += org.length;
      }
    }

    // 6. Custom registered entities
    for (const [entityName, type] of this.customEntities.entries()) {
      let searchPos = 0;
      while ((searchPos = lowerText.indexOf(entityName, searchPos)) !== -1) {
        const before = searchPos === 0 ? ' ' : lowerText[searchPos - 1];
        const after = searchPos + entityName.length >= lowerText.length ? ' ' : lowerText[searchPos + entityName.length];
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          results.push({
            type,
            value: text.substring(searchPos, searchPos + entityName.length),
            start: searchPos,
            end: searchPos + entityName.length,
            confidence: 0.98,
          });
        }
        searchPos += entityName.length;
      }
    }

    // Deduplicate overlapping spans within NER results (longest match wins)
    const sorted = [...results].sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const deduped: DetectedEntity[] = [];

    for (const cand of sorted) {
      const overlaps = deduped.some(
        acc => Math.max(cand.start, acc.start) < Math.min(cand.end, acc.end)
      );
      if (!overlaps) {
        deduped.push(cand);
      }
    }

    return deduped.sort((a, b) => a.start - b.start);
  }
}
