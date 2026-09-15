/**
 * CloakLLM Anonymization Engine
 * Replaces sensitive entities with deterministic placeholders and stores mapping in SessionVault.
 * Supports Policy Actions (ALLOW, CLOAK, REDACT) seamlessly.
 */

import type { ChatMessage, DetectedEntity, EntityType, PolicyAction, VaultStore } from './types.ts';
import { MasterDetector } from './detectors/index.ts';
import { SessionVault } from './vault.ts';

export interface AnonymizationResult<T = string> {
  sanitized: T;
  entities: DetectedEntity[];
  vault: VaultStore;
}

export interface AnonymizerOptions {
  action?: PolicyAction;
  redactTypes?: Set<EntityType>;
  allowTypes?: Set<EntityType>;
}

export class Anonymizer {
  private detector: MasterDetector;

  constructor(detector?: MasterDetector) {
    this.detector = detector || new MasterDetector();
  }

  public getDetector(): MasterDetector {
    return this.detector;
  }

  /**
   * Internal helper: replaces entities in text using detected entities and all known vault mappings.
   */
  private applySanitization(
    text: string,
    detectedEntities: DetectedEntity[],
    targetVault: VaultStore,
    options?: AnonymizerOptions
  ): { sanitized: string; entities: DetectedEntity[] } {
    const redactTypes = options?.redactTypes;
    const allowTypes = options?.allowTypes;

    // Filter out allowed entities from masking
    const actionableDetected = detectedEntities.filter(e => !allowTypes || !allowTypes.has(e.type));

    const isPermanentRedact = (type: EntityType) => {
      if (redactTypes && redactTypes.has(type)) return true;
      if (options?.action === 'REDACT' && (!allowTypes || !allowTypes.has(type))) return true;
      return false;
    };

    // 1. Register newly detected entities into vault (unless marked for permanent REDACT)
    for (const ent of actionableDetected) {
      if (!isPermanentRedact(ent.type)) {
        targetVault.getPlaceholder(ent.value, ent.type);
      }
    }

    const allEntities = [...actionableDetected];

    // 2. Scan text for all known entities registered in the vault (e.g. from previous messages/turns)
    const sortedMappings = [...targetVault.getAllMappings()].sort(
      (a, b) => b.originalValue.length - a.originalValue.length
    );
    for (const mapping of sortedMappings) {
      if (!mapping.originalValue || mapping.originalValue.trim().length < 2) continue;
      if (allowTypes && allowTypes.has(mapping.type)) continue;

      const escaped = mapping.originalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Boundary-safe matching preserving punctuation and Unicode characters
      const regex = new RegExp(`(?:^|(?<=[^\\p{L}\\p{N}_]))${escaped}(?=[^\\p{L}\\p{N}_]|$)`, 'giu');

      for (const match of text.matchAll(regex)) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;

        // Check for overlap with already tracked entities
        const overlaps = allEntities.some(
          e => Math.max(start, e.start) < Math.min(end, e.end)
        );

        if (!overlaps) {
          allEntities.push({
            type: mapping.type,
            value: text.substring(start, end),
            start,
            end,
            confidence: 0.95,
          });
        }
      }
    }

    // 3. Sort entities descending by position to replace from right to left
    allEntities.sort((a, b) => b.start - a.start);

    let sanitized = text;
    for (const entity of allEntities) {
      let replacement: string;
      if (isPermanentRedact(entity.type)) {
        // Irreversible redaction
        replacement = `[REDACTED_${entity.type}]`;
      } else {
        // Deterministic pseudonym placeholder
        replacement = targetVault.getPlaceholder(entity.value, entity.type);
      }

      sanitized =
        sanitized.substring(0, entity.start) +
        replacement +
        sanitized.substring(entity.end);
    }

    return {
      sanitized,
      entities: allEntities.sort((a, b) => a.start - b.start),
    };
  }

  /**
   * Anonymizes a single raw string synchronously.
   */
  public anonymizeText(
    text: string,
    vault?: VaultStore,
    options?: AnonymizerOptions
  ): AnonymizationResult<string> {
    const targetVault = vault || new SessionVault();
    const initialEntities = this.detector.detect(text);
    const { sanitized, entities } = this.applySanitization(text, initialEntities, targetVault, options);

    return {
      sanitized,
      entities,
      vault: targetVault,
    };
  }

  /**
   * Anonymizes a single raw string asynchronously (including local Ollama / SLM if enabled).
   */
  public async anonymizeTextAsync(
    text: string,
    vault?: VaultStore,
    options?: AnonymizerOptions
  ): Promise<AnonymizationResult<string>> {
    const targetVault = vault || new SessionVault();
    const initialEntities = await this.detector.detectAsync(text);
    const { sanitized, entities } = this.applySanitization(text, initialEntities, targetVault, options);

    return {
      sanitized,
      entities,
      vault: targetVault,
    };
  }

  /**
   * Helper to extract all text payloads from a ChatMessage
   */
  private extractMessageTexts(msg: ChatMessage): string[] {
    const texts: string[] = [];
    if (typeof msg.content === 'string') {
      texts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text);
        }
      }
    }

    // Also extract tool calls function arguments if present
    const toolCalls = (msg as any).tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        if (tc?.function?.arguments && typeof tc.function.arguments === 'string') {
          texts.push(tc.function.arguments);
        }
      }
    }

    return texts;
  }

  /**
   * Anonymizes an array of OpenAI ChatMessages synchronously.
   * Uses a two-pass architecture to guarantee multi-message and multi-turn consistency.
   */
  public anonymizeMessages(
    messages: ChatMessage[],
    vault?: VaultStore,
    options?: AnonymizerOptions
  ): AnonymizationResult<ChatMessage[]> {
    const targetVault = vault || new SessionVault();
    const redactTypes = options?.redactTypes;
    const allowTypes = options?.allowTypes;

    // Pass 1: Global discovery pass across all messages to populate the vault
    for (const msg of messages) {
      const texts = this.extractMessageTexts(msg);
      for (const t of texts) {
        const detected = this.detector.detect(t);
        for (const ent of detected) {
          if (allowTypes && allowTypes.has(ent.type)) continue;
          if (!redactTypes || !redactTypes.has(ent.type)) {
            targetVault.getPlaceholder(ent.value, ent.type);
          }
        }
      }
    }

    // Pass 2: Sanitization pass using the fully populated vault
    const allDetectedEntities: DetectedEntity[] = [];

    const sanitizedMessages: ChatMessage[] = messages.map(msg => {
      const cloned = { ...msg };

      if (typeof msg.content === 'string') {
        const res = this.anonymizeText(msg.content, targetVault, options);
        allDetectedEntities.push(...res.entities);
        cloned.content = res.sanitized;
      } else if (Array.isArray(msg.content)) {
        cloned.content = msg.content.map(block => {
          if (block.type === 'text' && typeof block.text === 'string') {
            const res = this.anonymizeText(block.text, targetVault, options);
            allDetectedEntities.push(...res.entities);
            return { ...block, text: res.sanitized };
          }
          return block;
        });
      }

      // Handle tool_calls
      const toolCalls = (cloned as any).tool_calls;
      if (Array.isArray(toolCalls)) {
        (cloned as any).tool_calls = toolCalls.map((tc: any) => {
          if (tc?.function?.arguments && typeof tc.function.arguments === 'string') {
            const res = this.anonymizeText(tc.function.arguments, targetVault, options);
            allDetectedEntities.push(...res.entities);
            return {
              ...tc,
              function: { ...tc.function, arguments: res.sanitized },
            };
          }
          return tc;
        });
      }

      return cloned;
    });

    return {
      sanitized: sanitizedMessages,
      entities: allDetectedEntities,
      vault: targetVault,
    };
  }

  /**
   * Anonymizes an array of OpenAI ChatMessages asynchronously.
   */
  public async anonymizeMessagesAsync(
    messages: ChatMessage[],
    vault?: VaultStore,
    options?: AnonymizerOptions
  ): Promise<AnonymizationResult<ChatMessage[]>> {
    const targetVault = vault || new SessionVault();
    const redactTypes = options?.redactTypes;
    const allowTypes = options?.allowTypes;

    // Pass 1: Async global discovery pass
    for (const msg of messages) {
      const texts = this.extractMessageTexts(msg);
      for (const t of texts) {
        const detected = await this.detector.detectAsync(t);
        for (const ent of detected) {
          if (allowTypes && allowTypes.has(ent.type)) continue;
          if (!redactTypes || !redactTypes.has(ent.type)) {
            targetVault.getPlaceholder(ent.value, ent.type);
          }
        }
      }
    }

    // Pass 2: Sanitization pass
    return this.anonymizeMessages(messages, targetVault, options);
  }
}
