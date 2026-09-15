/**
 * Local SLM Named Entity Recognition (NER) Plugin via Ollama
 * Connects to a local Ollama runtime (0 € cost, zero cloud telemetry)
 * to detect ambiguous or non-standard named entities (people, orgs, custom PII).
 * Falls back gracefully if Ollama is unreachable.
 *
 * Backed by the unified LocalNerDetector architecture.
 */

import { LocalNerDetector } from './local-provider.ts';

export interface OllamaNerOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class OllamaNerDetector extends LocalNerDetector {
  constructor(options?: OllamaNerOptions) {
    super({
      providerType: 'ollama',
      baseUrl: options?.baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      model: options?.model || 'llama3.2:1b',
      timeoutMs: options?.timeoutMs || 1500,
      fetchFn: options?.fetchFn,
      profile: 'workstation',
    });
    this.name = 'OllamaNerDetector';
  }
}
