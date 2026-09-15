/**
 * Master Detector Hub
 * Coordinates and combines multiple specialized detector plugins, resolving
 * overlapping entity spans by confidence and specificity.
 */

import type { DetectedEntity, DetectorPlugin, EntityType, MasterDetectorOptions } from '../types.ts';
import { RegexDetector } from './regex-detector.ts';
import { FinancialDetector } from './financial.ts';
import { IdentityDetector } from './identity.ts';
import { CreditCardDetector } from './credit-card.ts';
import { SecretsDetector } from './secrets.ts';
import { NerHeuristicDetector } from './ner-heuristics.ts';
import { OllamaNerDetector } from './ollama-detector.ts';
import { LocalNerDetector } from './local-provider.ts';
import { CustomRulesDetector } from './custom-detector.ts';

export class MasterDetector {
  private plugins: DetectorPlugin[] = [];
  private ollamaPlugin?: OllamaNerDetector;
  private localModelPlugin?: LocalNerDetector;
  private customRulesPlugin?: CustomRulesDetector;

  constructor(options?: MasterDetectorOptions) {
    const enabledTypes = options?.enabledTypes;

    // Register built-in synchronous plugins
    this.plugins.push(new RegexDetector());
    this.plugins.push(new FinancialDetector());
    this.plugins.push(new IdentityDetector());
    this.plugins.push(new CreditCardDetector());
    this.plugins.push(new SecretsDetector());
    this.plugins.push(new NerHeuristicDetector());

    // Register Custom Enterprise Rules / Dictionaries
    if (options?.customRules) {
      this.customRulesPlugin = new CustomRulesDetector(options.customRules);
      this.plugins.push(this.customRulesPlugin);
    }

    // Register Local SLM Provider (Ollama, OpenAI-compatible LM Studio/vLLM, or Hugging Face)
    if (options?.localProvider) {
      this.localModelPlugin = new LocalNerDetector(options.localProvider);
    } else if (options?.enableOllama) {
      // Legacy Ollama fallback
      this.ollamaPlugin = new OllamaNerDetector(
        options.ollamaModel || 'llama3.2:1b',
        options.ollamaBaseUrl || 'http://127.0.0.1:11434'
      );
    }
  }

  public addPlugin(plugin: DetectorPlugin): void {
    this.plugins.push(plugin);
  }

  public getCustomRulesDetector(): CustomRulesDetector | undefined {
    return this.customRulesPlugin;
  }

  /**
   * Synchronous detection combining fast regex and algorithmic plugins.
   */
  public detect(text: string): DetectedEntity[] {
    const allMatches: DetectedEntity[] = [];

    for (const plugin of this.plugins) {
      try {
        const matches = plugin.detect(text);
        allMatches.push(...matches);
      } catch (err) {
        // Plugin error isolation: prevent a failing plugin from crashing the proxy
        console.error(`Detector plugin ${plugin.name} error:`, err);
      }
    }

    return this.resolveOverlaps(allMatches);
  }

  /**
   * Asynchronous detection combining fast plugins with local SLM providers.
   */
  public async detectAsync(text: string): Promise<DetectedEntity[]> {
    // 1. Run sync plugins first (sub-millisecond latency)
    const baseMatches = this.detect(text);

    // 2. Query Local SLM provider if configured
    if (this.localModelPlugin) {
      try {
        const localMatches = await this.localModelPlugin.detect(text);
        baseMatches.push(...localMatches);
      } catch (err) {
        console.error('LocalModelPlugin detection error:', err);
      }
    } else if (this.ollamaPlugin) {
      try {
        const ollamaMatches = await this.ollamaPlugin.detectAsync(text);
        baseMatches.push(...ollamaMatches);
      } catch (err) {
        console.error('OllamaPlugin detection error:', err);
      }
    }

    return this.resolveOverlaps(baseMatches);
  }

  /**
   * Resolves overlapping spans prioritizing:
   * 1. Higher confidence score
   * 2. Longer matched substring length
   */
  private resolveOverlaps(matches: DetectedEntity[]): DetectedEntity[] {
    if (matches.length <= 1) return matches;

    // Sort by start position ascending, then length descending, then confidence descending
    const sorted = [...matches].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const lenA = a.end - a.start;
      const lenB = b.end - b.start;
      if (lenA !== lenB) return lenB - lenA;
      return b.confidence - a.confidence;
    });

    const resolved: DetectedEntity[] = [];

    for (const candidate of sorted) {
      let hasConflict = false;

      for (let i = 0; i < resolved.length; i++) {
        const accepted = resolved[i];

        // Check if candidate overlaps with an already accepted entity
        const overlaps = candidate.start < accepted.end && candidate.end > accepted.start;

        if (overlaps) {
          hasConflict = true;
          // Priority rules:
          // Business dictionary terms always win over generic regex/heuristics
          const candidateIsCustom = candidate.metadata?.source === 'dictionary' || candidate.metadata?.source === 'custom_pattern';
          const acceptedIsCustom = accepted.metadata?.source === 'dictionary' || accepted.metadata?.source === 'custom_pattern';

          if (candidateIsCustom && !acceptedIsCustom) {
            resolved[i] = candidate;
            break;
          } else if (acceptedIsCustom && !candidateIsCustom) {
            break;
          }

          // Strict algorithmic matches (Credit Card, IBAN, NIR, SSN, Secrets) win over generic heuristics
          const isHighPriority = (type: EntityType) =>
            ['CREDIT_CARD', 'IBAN', 'FRENCH_NIR', 'US_SSN', 'UK_NINO', 'SECRET_API_KEY'].includes(type);

          if (isHighPriority(candidate.type) && !isHighPriority(accepted.type)) {
            resolved[i] = candidate;
            break;
          } else if (candidate.confidence > accepted.confidence && (candidate.end - candidate.start) >= (accepted.end - accepted.start)) {
            resolved[i] = candidate;
            break;
          }
          break;
        }
      }

      if (!hasConflict) {
        resolved.push(candidate);
      }
    }

    // Final sort by start position
    return resolved.sort((a, b) => a.start - b.start);
  }
}
