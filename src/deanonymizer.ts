/**
 * CloakLLM De-anonymization Engine
 * Replaces placeholders in LLM responses back to their original sensitive values.
 * Supports both static JSON responses and real-time streaming SSE chunks with boundary buffering.
 */

import type { VaultStore } from './types.ts';

// Placeholder pattern: e.g., [PERSON_1], [AMOUNT_12], [CREDIT_CARD_2], [EMPLOYEE-ID_1], [PROJ2_1]
const PLACEHOLDER_REGEX = /\[([A-Za-z0-9_-]+_\d+)\]/gi;

// Maximum length of any placeholder (e.g. "[CONFIDENTIAL_PROJECT_9999]" is ~32 chars).
// Any bracket sequence longer than this is regular text (e.g. markdown links).
const MAX_PLACEHOLDER_LEN = 45;

export class Deanonymizer {
  /**
   * De-anonymizes a static string using mappings from the vault.
   */
  public static deanonymizeText(text: string, vault: VaultStore): string {
    if (vault.size() === 0 || !text.includes('[')) {
      return text;
    }

    return text.replace(PLACEHOLDER_REGEX, (match) => {
      const original = vault.getOriginal(match);
      return original !== undefined ? original : match;
    });
  }
}

/**
 * StreamDeanonymizer buffers incoming text deltas across SSE chunk boundaries
 * to prevent placeholders from breaking when split across consecutive chunks.
 */
export class StreamDeanonymizer {
  private vault: VaultStore;
  private buffer: string = '';

  constructor(vault: VaultStore) {
    this.vault = vault;
  }

  /**
   * Processes a chunk of text delta and returns the de-anonymized output safe to emit.
   */
  public feed(chunk: string): string {
    if (this.vault.size() === 0) {
      return chunk;
    }

    this.buffer += chunk;
    let emit = '';

    while (this.buffer.length > 0) {
      const openBracketIndex = this.buffer.indexOf('[');

      if (openBracketIndex === -1) {
        // No open bracket in buffer: safe to emit everything
        emit += this.buffer;
        this.buffer = '';
        break;
      }

      if (openBracketIndex > 0) {
        // Characters before the open bracket are safe to emit
        emit += this.buffer.substring(0, openBracketIndex);
        this.buffer = this.buffer.substring(openBracketIndex);
      }

      // Now this.buffer starts with '['
      const nextOpen = this.buffer.indexOf('[', 1);
      const closeBracketIndex = this.buffer.indexOf(']');

      // If another '[' occurs before any ']', the current '[' cannot be part of a placeholder
      if (nextOpen !== -1 && (closeBracketIndex === -1 || nextOpen < closeBracketIndex)) {
        emit += this.buffer.substring(0, nextOpen);
        this.buffer = this.buffer.substring(nextOpen);
        continue;
      }

      if (closeBracketIndex !== -1) {
        const candidate = this.buffer.substring(0, closeBracketIndex + 1);

        if (/^\[[A-Za-z0-9_-]+_\d+\]$/i.test(candidate)) {
          const original = this.vault.getOriginal(candidate);
          emit += original !== undefined ? original : candidate;
        } else {
          // Regular bracketed text like [Link] or [1]
          emit += candidate;
        }
        this.buffer = this.buffer.substring(closeBracketIndex + 1);
      } else {
        // Open bracket exists, but closing bracket has not arrived yet.
        // Check if current buffer looks like an incomplete placeholder prefix (e.g. "[PER" or "[EMPLOYEE-")
        if (/^\[[A-Za-z0-9_-]*$/i.test(this.buffer) && this.buffer.length <= MAX_PLACEHOLDER_LEN) {
          // Could be a split placeholder, wait for next chunk
          break;
        } else {
          // Contains spaces or characters invalid for placeholders (e.g. "[ Note:"): emit '[' immediately!
          emit += '[';
          this.buffer = this.buffer.substring(1);
        }
      }
    }

    return emit;
  }

  /**
   * Flushes any remaining characters in the buffer at the end of the stream.
   */
  public flush(): string {
    if (this.buffer.length === 0) return '';
    const remaining = Deanonymizer.deanonymizeText(this.buffer, this.vault);
    this.buffer = '';
    return remaining;
  }
}
