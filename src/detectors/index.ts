/**
 * Master Detection Registry and Overlap Resolver (v3.0)
 * Coordinates all specialized detector plugins and returns a clean, non-overlapping list of entities.
 */

import type {
  BusinessDictionaryEntry,
  CustomPatternRule,
  CustomRulesConfig,
  DetectedEntity,
  DetectorPlugin,
  EntityType,
  LocalNerProviderOptions,
} from '../types.ts';
import { RegexDetector } from './regex-detector.ts';
import { FinancialDetector } from './financial.ts';
import { IdentityDetector } from './identity.ts';
import { CreditCardDetector } from './credit-card.ts';
import { SecretsDetector } from './secrets.ts';
import { NerHeuristicDetector } from './ner-heuristics.ts';
import { OllamaNerDetector, type OllamaNerOptions } from './ollama-detector.ts';
import { LocalNerDetector } from './local-provider.ts';
import { CustomRulesDetector } from './custom-detector.ts';
import { EntropyDetector } from './entropy.ts';
import { NetworkDetector } from './network.ts';

export * from './local-provider.ts';
export * from './custom-detector.ts';
export * from './entropy.ts';
export * from './network.ts';

export class MasterDetector {
  private plugins: DetectorPlugin[] = [];
  private nerPlugin: NerHeuristicDetector;
  private customPlugin: CustomRulesDetector;
  private entropyPlugin: EntropyDetector;
  private networkPlugin: NetworkDetector;
  private localPlugin?: LocalNerDetector;
  private enabledTypes: Set<EntityType>;

  constructor(options?: {
    enabledTypes?: EntityType[];
    customEntities?: Record<string, 'PERSON' | 'ORGANIZATION'>;
    customConfig?: CustomRulesConfig;
    enableOllama?: boolean;
    ollamaOptions?: OllamaNerOptions;
    enableLocalSLM?: boolean;
    localProviderOptions?: LocalNerProviderOptions;
    enableEntropy?: boolean;
    entropyOptions?: { base64Threshold?: number; hexThreshold?: number };
  }) {
    this.enabledTypes = new Set(
      options?.enabledTypes || [
        'EMAIL',
        'PHONE',
        'IBAN',
        'NIR',
        'SSN',
        'NINO',
        'CREDIT_CARD',
        'AMOUNT',
        'SECRET',
        'IP_ADDRESS',
        'PERSON',
        'ORGANIZATION',
        'SIRET',
        'PROJECT',
        'CLIENT',
        'INTERNAL_IP',
        'CUSTOM',
      ]
    );

    this.customPlugin = new CustomRulesDetector(options?.customConfig);
    // Auto-enable any custom types declared in customConfig
    for (const t of this.customPlugin.supportedTypes) {
      this.enabledTypes.add(t);
    }

    this.nerPlugin = new NerHeuristicDetector(options?.customEntities);
    this.entropyPlugin = new EntropyDetector(options?.entropyOptions);
    this.networkPlugin = new NetworkDetector();

    if (options?.enableLocalSLM && options.localProviderOptions) {
      this.localPlugin = new LocalNerDetector(options.localProviderOptions);
    } else if (options?.enableOllama) {
      this.localPlugin = new OllamaNerDetector(options.ollamaOptions);
    }

    // Register all detection engines in order of intrinsic precedence
    this.plugins = [
      new SecretsDetector(),       // Highest priority: known patterns (API keys, tokens)
      this.entropyPlugin,         // Shannon entropy: unknown random secrets / base64 / hex keys
      this.customPlugin,          // Enterprise business dictionaries and custom rules
      new CreditCardDetector(),    // Credit cards have strict Luhn check
      new IdentityDetector(),      // NIR, SIRET, US SSN, UK NINO
      new FinancialDetector(),     // IBAN with Mod 97 check and monetary amounts
      this.networkPlugin,         // RFC 1918 subnets and IP addresses
      new RegexDetector(),         // Email, Phone (FR, US, UK, INTL)
      this.nerPlugin,              // Named entities & heuristics
    ];
  }

  public registerPlugin(plugin: DetectorPlugin): void {
    this.plugins.push(plugin);
  }

  public registerNamedEntity(name: string, type: 'PERSON' | 'ORGANIZATION'): void {
    this.nerPlugin.registerEntity(name, type);
  }

  public registerCustomDictionary(entry: BusinessDictionaryEntry): void {
    this.customPlugin.addDictionary(entry);
    this.enabledTypes.add(entry.type);
  }

  public registerCustomPattern(rule: CustomPatternRule): void {
    this.customPlugin.addPattern(rule);
    this.enabledTypes.add(rule.type);
  }

  public getCustomDetector(): CustomRulesDetector {
    return this.customPlugin;
  }

  public setOllamaDetector(ollama: OllamaNerDetector): void {
    this.localPlugin = ollama;
  }

  public setLocalDetector(detector: LocalNerDetector): void {
    this.localPlugin = detector;
  }

  /**
   * Runs all enabled detectors on text and resolves overlaps (synchronous fast path).
   */
  public detect(text: string): DetectedEntity[] {
    const rawMatches: DetectedEntity[] = [];

    for (const plugin of this.plugins) {
      const entities = plugin.detect(text);
      for (const entity of entities) {
        if (this.enabledTypes.has(entity.type)) {
          rawMatches.push(entity);
        }
      }
    }

    return this.resolveOverlaps(rawMatches);
  }

  /**
   * Asynchronously runs all enabled detectors plus optional local SLM (Ollama, LM Studio, Hugging Face).
   */
  public async detectAsync(text: string): Promise<DetectedEntity[]> {
    const syncMatches = this.detect(text);

    if (!this.localPlugin) {
      return syncMatches;
    }

    try {
      const localMatches = await this.localPlugin.detectAsync(text);
      const combined = [...syncMatches];
      for (const ent of localMatches) {
        if (this.enabledTypes.has(ent.type)) {
          combined.push(ent);
        }
      }
      return this.resolveOverlaps(combined);
    } catch {
      return syncMatches;
    }
  }

  /**
   * Resolves overlaps between detected entities.
   * Priority strategy:
   * 1. Secrets and Credit Cards have highest intrinsic priority.
   * 2. Highest confidence score.
   * 3. Longest span length.
   * 4. Earliest start position.
   */
  private resolveOverlaps(matches: DetectedEntity[]): DetectedEntity[] {
    if (matches.length <= 1) return matches;

    const priorityScore = (type: EntityType): number => {
      switch (type) {
        case 'SECRET': return 100;
        case 'PROJECT': return 95;
        case 'CLIENT': return 95;
        case 'INTERNAL_IP': return 95;
        case 'CUSTOM': return 95;
        case 'CREDIT_CARD': return 90;
        case 'NIR': return 85;
        case 'SSN': return 85;
        case 'NINO': return 85;
        case 'IBAN': return 80;
        case 'SIRET': return 75;
        case 'EMAIL': return 70;
        case 'PHONE': return 65;
        case 'AMOUNT': return 60;
        case 'PERSON': return 50;
        case 'ORGANIZATION': return 50;
        case 'IP_ADDRESS': return 40;
        default: return 92; // Dynamic custom enterprise types default to high priority
      }
    };

    // Sort matches by priority, length, and position
    const sorted = [...matches].sort((a, b) => {
      const pDiff = priorityScore(b.type) - priorityScore(a.type);
      if (pDiff !== 0) return pDiff;

      const lenDiff = (b.end - b.start) - (a.end - a.start);
      if (lenDiff !== 0) return lenDiff;

      const confDiff = b.confidence - a.confidence;
      if (Math.abs(confDiff) > 0.05) return confDiff;

      return a.start - b.start;
    });

    const accepted: DetectedEntity[] = [];

    for (const candidate of sorted) {
      // Check if candidate overlaps with any already accepted entity
      const overlaps = accepted.some(acc => {
        return Math.max(candidate.start, acc.start) < Math.min(candidate.end, acc.end);
      });

      if (!overlaps) {
        accepted.push(candidate);
      }
    }

    // Return sorted strictly by starting index in the text
    return accepted.sort((a, b) => a.start - b.start);
  }
}
