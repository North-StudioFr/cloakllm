/**
 * Unified Local SLM & NER Model Provider
 * Connects to local AI runtimes (0 € cost, zero cloud telemetry, 100% on-premise):
 * 1. Ollama (local daemon, default port 11434)
 * 2. OpenAI-Compatible local engines (LM Studio port 1234, vLLM port 8000, llama.cpp, LocalAI, Jan.ai)
 * 3. Hugging Face local endpoints (TEI token-classification or local transformers server port 8080)
 *
 * Supports environment profiles:
 * - Workstation (developer / employee workstation on 127.0.0.1)
 * - LAN / Private Server (dedicated on-premise AI box / GPU cluster)
 * - Custom host configuration
 */

import type { DetectedEntity, DetectorPlugin, EntityType, LocalNerProviderOptions, LocalProviderType, EnvironmentProfile } from '../types.ts';

export function resolveDefaultUrl(
  provider: LocalProviderType,
  profile: EnvironmentProfile = 'workstation',
  customUrl?: string
): string {
  if (customUrl && customUrl.trim().length > 0) {
    return customUrl.trim().replace(/\/$/, '');
  }

  const isLan = profile === 'lan';
  const host = isLan ? 'http://ai-server.local' : 'http://127.0.0.1';

  switch (provider) {
    case 'ollama':
      return `${host}:11434`;
    case 'openai-compatible':
      return `${host}:1234/v1`;
    case 'huggingface':
      return `${host}:8080`;
    default:
      return `${host}:11434`;
  }
}

export function resolveDefaultModel(provider: LocalProviderType, customModel?: string): string {
  if (customModel && customModel.trim().length > 0) {
    return customModel.trim();
  }

  switch (provider) {
    case 'ollama':
      return 'llama3.2:1b';
    case 'openai-compatible':
      return 'local-model';
    case 'huggingface':
      return 'dslim/bert-base-NER';
    default:
      return 'llama3.2:1b';
  }
}

export class LocalNerDetector implements DetectorPlugin {
  public name = 'LocalNerDetector';
  public supportedTypes: EntityType[] = ['PERSON', 'ORGANIZATION', 'CUSTOM'];

  public readonly providerType: LocalProviderType;
  public readonly profile: EnvironmentProfile;
  public readonly baseUrl: string;
  public readonly model: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;
  private apiKey?: string;

  constructor(options?: LocalNerProviderOptions) {
    this.providerType = options?.providerType || 'ollama';
    this.profile = options?.profile || 'workstation';
    this.baseUrl = resolveDefaultUrl(this.providerType, this.profile, options?.baseUrl);
    this.model = resolveDefaultModel(this.providerType, options?.model);
    this.timeoutMs = options?.timeoutMs || 1800;
    this.fetchFn = options?.fetchFn || globalThis.fetch.bind(globalThis);
    this.apiKey = options?.apiKey;
  }

  /**
   * Synchronous detect implementation (DetectorPlugin compatibility).
   * Returns empty array; use detectAsync for async SLM inference.
   */
  public detect(_text: string): DetectedEntity[] {
    return [];
  }

  /**
   * Asynchronously queries the local provider to extract named entities.
   */
  public async detectAsync(text: string): Promise<DetectedEntity[]> {
    if (!text || text.trim().length < 4) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      switch (this.providerType) {
        case 'ollama':
          return await this.queryOllama(text, controller.signal);
        case 'openai-compatible':
          return await this.queryOpenAICompatible(text, controller.signal);
        case 'huggingface':
          return await this.queryHuggingFace(text, controller.signal);
        default:
          return await this.queryOllama(text, controller.signal);
      }
    } catch {
      // Graceful offline fallback: provider unreachable, aborted or timed out
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 1. Query Ollama local daemon
   */
  private async queryOllama(text: string, signal: AbortSignal): Promise<DetectedEntity[]> {
    const prompt = `Tu es un modèle NER local de haute précision pour la confidentialité des données.
Analyse le texte ci-dessous et identifie toutes les entités sensibles réelles :
- PERSON : noms ou prénoms de personnes réelles (ex: "Thomas Bernard", "John Smith")
- ORGANIZATION : noms d'entreprises, institutions, marques réelles (ex: "Acquisys", "Doctolib", "Acme Corp")

Réponds UNIQUEMENT avec un objet JSON strict au format suivant :
{"entities": [{"type": "PERSON" | "ORGANIZATION", "value": "nom_exact"}]}
Si aucune entité n'est présente, réponds: {"entities": []}

Texte:
"""
${text}
"""`;

    const res = await this.fetchFn(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.0,
          num_predict: 256,
        },
      }),
      signal,
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { response?: string };
    const rawText = data.response?.trim() || '{}';
    return this.parseEntitiesFromJsonText(rawText, text);
  }

  /**
   * 2. Query generic local OpenAI-compatible endpoint (LM Studio, vLLM, llama.cpp, LocalAI)
   */
  private async queryOpenAICompatible(text: string, signal: AbortSignal): Promise<DetectedEntity[]> {
    let url = this.baseUrl.replace(/\/$/, '');
    if (!url.endsWith('/chat/completions')) {
      if (!url.endsWith('/v1')) {
        url = `${url}/v1/chat/completions`;
      } else {
        url = `${url}/chat/completions`;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let res = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a local data privacy NER model. Identify PERSON and ORGANIZATION entities. Output strictly a JSON object: {"entities": [{"type": "PERSON"|"ORGANIZATION", "value": "exact_name"}]}',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.0,
        response_format: { type: 'json_object' },
      }),
      signal,
    });

    // Fallback for local engines that return 400 on response_format (e.g. older llama.cpp or LM Studio builds)
    if (!res.ok && res.status === 400) {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a local data privacy NER model. Identify PERSON and ORGANIZATION entities. Output strictly a JSON object: {"entities": [{"type": "PERSON"|"ORGANIZATION", "value": "exact_name"}]}',
            },
            {
              role: 'user',
              content: text,
            },
          ],
          temperature: 0.0,
        }),
        signal,
      });
    }

    if (!res.ok) return [];

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim() || '{}';
    return this.parseEntitiesFromJsonText(content, text);
  }

  /**
   * 3. Query local Hugging Face inference endpoint (TEI token-classification or text-generation)
   */
  private async queryHuggingFace(text: string, signal: AbortSignal): Promise<DetectedEntity[]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Standard local HuggingFace inference endpoint
    const url = this.baseUrl;

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: text,
        parameters: {
          aggregation_strategy: 'simple',
        },
      }),
      signal,
    });

    if (!res.ok) return [];

    const rawData = await res.json();

    // Format A: Direct array of token classifications from Hugging Face NER pipeline
    // Handles single input array or batch nested array e.g. [[{ entity_group: "PER", ... }]]
    if (Array.isArray(rawData)) {
      const items: any[] = rawData.length > 0 && Array.isArray(rawData[0]) ? rawData.flat() : rawData;
      const rawEntities: DetectedEntity[] = [];

      for (const item of items) {
        // If it's text generation output format [{ generated_text: "..." }]
        if (typeof item?.generated_text === 'string') {
          return this.parseEntitiesFromJsonText(item.generated_text, text);
        }

        const tag = (item.entity_group || item.entity || '').toUpperCase();
        const word = (item.word || '').trim().replace(/^##/, '');
        if (!word || word.length < 2) continue;

        let type: EntityType | null = null;
        if (tag.includes('PER')) {
          type = 'PERSON';
        } else if (tag.includes('ORG')) {
          type = 'ORGANIZATION';
        }

        if (type) {
          // If HF provided start and end positions, use them with whitespace trimming
          if (typeof item.start === 'number' && typeof item.end === 'number' && item.end <= text.length) {
            let start = item.start;
            let end = item.end;
            while (start < end && /\s/.test(text[start])) start++;
            while (end > start && /\s/.test(text[end - 1])) end--;
            let value = text.substring(start, end);

            // If word is provided and trimmed span differs, align to word position if nearby
            if (word && value.toLowerCase() !== word.toLowerCase()) {
              const exactPos = text.toLowerCase().indexOf(word.toLowerCase(), Math.max(0, item.start - 3));
              if (exactPos !== -1 && Math.abs(exactPos - item.start) <= 4) {
                start = exactPos;
                end = exactPos + word.length;
                value = text.substring(start, end);
              }
            }

            if (value.length > 0) {
              rawEntities.push({
                type,
                value,
                start,
                end,
                confidence: typeof item.score === 'number' ? item.score : 0.90,
                metadata: { source: 'huggingface', model: this.model },
              });
            }
          } else if (!item.word?.startsWith('##')) {
            // Find positions by text search (only if not a subword token fragment)
            const found = this.matchSubstringEntities(text, word, type, 0.90);
            rawEntities.push(...found);
          }
        }
      }

      // Merge adjacent spans of the same entity type (e.g. B-PER + I-PER or subword tokens)
      rawEntities.sort((a, b) => a.start - b.start);
      const merged: DetectedEntity[] = [];

      for (const ent of rawEntities) {
        if (merged.length === 0) {
          merged.push({ ...ent });
          continue;
        }

        const last = merged[merged.length - 1];
        // If same type and adjacent (or separated only by whitespace)
        if (
          last.type === ent.type &&
          ent.start >= last.end &&
          text.substring(last.end, ent.start).trim().length === 0
        ) {
          last.end = ent.end;
          last.value = text.substring(last.start, last.end);
          last.confidence = Math.max(last.confidence, ent.confidence);
        } else if (Math.max(last.start, ent.start) < Math.min(last.end, ent.end)) {
          // Overlapping: expand to span union
          last.end = Math.max(last.end, ent.end);
          last.value = text.substring(last.start, last.end);
        } else {
          merged.push({ ...ent });
        }
      }

      return merged;
    }

    // Format B: Single object with generated_text
    if (rawData && typeof rawData.generated_text === 'string') {
      return this.parseEntitiesFromJsonText(rawData.generated_text, text);
    }

    return [];
  }

  /**
   * Helper: parses JSON output containing {"entities": [{"type": "...", "value": "..."}]}
   * or direct array format [{"type": "...", "value": "..."}].
   */
  private parseEntitiesFromJsonText(jsonText: string, originalText: string): DetectedEntity[] {
    let rawList: Array<{ type?: string; value?: string }> = [];

    // Strip markdown code fences if present (```json ... ```)
    const cleaned = jsonText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        rawList = parsed;
      } else if (parsed && Array.isArray(parsed.entities)) {
        rawList = parsed.entities;
      }
    } catch {
      // Try regex matching for { ... } or [ ... ]
      const objMatch = cleaned.match(/\{[\s\S]*\}/);
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);

      if (objMatch) {
        try {
          const parsed = JSON.parse(objMatch[0]);
          if (Array.isArray(parsed.entities)) {
            rawList = parsed.entities;
          }
        } catch {
          // continue
        }
      }

      if (rawList.length === 0 && arrMatch) {
        try {
          const parsed = JSON.parse(arrMatch[0]);
          if (Array.isArray(parsed)) {
            rawList = parsed;
          }
        } catch {
          // continue
        }
      }
    }

    if (rawList.length === 0) {
      return [];
    }

    const results: DetectedEntity[] = [];

    for (const item of rawList) {
      if (!item.value || typeof item.value !== 'string') continue;
      const val = item.value.trim();
      if (val.length < 2) continue;

      const type: EntityType =
        item.type?.toUpperCase() === 'ORGANIZATION' ? 'ORGANIZATION' : 'PERSON';

      const found = this.matchSubstringEntities(originalText, val, type, 0.88);
      results.push(...found);
    }

    return results;
  }

  /**
   * Helper: finds exact non-overlapping occurrences of a substring in text with strict word boundaries
   */
  private matchSubstringEntities(
    fullText: string,
    targetValue: string,
    type: EntityType,
    confidence: number
  ): DetectedEntity[] {
    const results: DetectedEntity[] = [];
    const lowerText = fullText.toLowerCase();
    const lowerVal = targetValue.toLowerCase();

    let searchPos = 0;
    while ((searchPos = lowerText.indexOf(lowerVal, searchPos)) !== -1) {
      const start = searchPos;
      const end = start + targetValue.length;

      // Ensure word boundaries: preceding and trailing character must not be alphanumeric or Unicode word character
      const prevChar = start === 0 ? ' ' : fullText[start - 1];
      const nextChar = end >= fullText.length ? ' ' : fullText[end];
      const isWordChar = /[\p{L}\p{N}]/u;

      if (!isWordChar.test(prevChar) && !isWordChar.test(nextChar)) {
        const actualText = fullText.substring(start, end);

        results.push({
          type,
          value: actualText,
          start,
          end,
          confidence,
          metadata: {
            source: this.providerType,
            model: this.model,
            profile: this.profile,
          },
        });
      }

      searchPos = end;
    }

    return results;
  }

  /**
   * Checks if local provider is reachable.
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 900);

      let checkUrl = `${this.baseUrl}/api/tags`;
      if (this.providerType === 'openai-compatible') {
        checkUrl = this.baseUrl.endsWith('/v1')
          ? `${this.baseUrl}/models`
          : `${this.baseUrl}/v1/models`;
      } else if (this.providerType === 'huggingface') {
        checkUrl = `${this.baseUrl}/health`;
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const res = await this.fetchFn(checkUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }
}
