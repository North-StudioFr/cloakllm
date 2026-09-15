/**
 * In-Memory Reversible Pseudonymization Vault
 * Manages bidirectional mappings between raw sensitive values and placeholders.
 * Guarantees consistency across multiple occurrences within the same session/request.
 */

import type { EntityType, PseudonymMapping, VaultStore } from './types.ts';

export class SessionVault implements VaultStore {
  private valueToPlaceholder: Map<string, string> = new Map();
  private placeholderToOriginal: Map<string, string> = new Map();
  private lowercasePlaceholderToOriginal: Map<string, string> = new Map();
  private typeCounters: Map<EntityType, number> = new Map();
  private mappingsList: PseudonymMapping[] = [];
  public readonly createdAt: number = Date.now();

  /**
   * Retrieves an existing placeholder for a sensitive value or creates a new deterministic one.
   */
  public getPlaceholder(value: string, type: EntityType): string {
    const trimmed = value.trim();
    // Normalize key for lookup to avoid duplicate placeholders for trivial whitespace differences
    const lookupKey = `${type}:::${trimmed.toLowerCase()}`;

    const existing = this.valueToPlaceholder.get(lookupKey);
    if (existing) {
      return existing;
    }

    // Increment counter for this entity type
    const currentCount = (this.typeCounters.get(type) || 0) + 1;
    this.typeCounters.set(type, currentCount);

    const placeholder = `[${type}_${currentCount}]`;

    // Store mappings
    this.valueToPlaceholder.set(lookupKey, placeholder);
    this.placeholderToOriginal.set(placeholder, trimmed);
    this.lowercasePlaceholderToOriginal.set(placeholder.toLowerCase(), trimmed);

    this.mappingsList.push({
      placeholder,
      originalValue: trimmed,
      type,
      createdAt: Date.now(),
    });

    return placeholder;
  }

  /**
   * Reverses a placeholder back to its original value.
   * Handles case-insensitivity if the upstream LLM altered the casing (e.g. [amount_1]).
   */
  public getOriginal(placeholder: string): string | undefined {
    // 1. Exact match
    const exact = this.placeholderToOriginal.get(placeholder);
    if (exact !== undefined) return exact;

    // 2. Case-insensitive fallback
    return this.lowercasePlaceholderToOriginal.get(placeholder.toLowerCase());
  }

  /**
   * Returns all current mappings in this vault session.
   */
  public getAllMappings(): PseudonymMapping[] {
    return [...this.mappingsList];
  }

  /**
   * Total number of pseudonymized entities.
   */
  public size(): number {
    return this.mappingsList.length;
  }

  /**
   * Clears all stored mappings immediately.
   */
  public clear(): void {
    this.valueToPlaceholder.clear();
    this.placeholderToOriginal.clear();
    this.lowercasePlaceholderToOriginal.clear();
    this.typeCounters.clear();
    this.mappingsList = [];
  }
}

/**
 * Vault Manager for handling sessions with auto-pruning TTL
 */
export class VaultManager {
  private sessions: Map<string, { vault: SessionVault; lastAccess: number }> = new Map();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 30 * 60 * 1000) { // 30 minutes default
    this.ttlMs = ttlMs;
  }

  public getOrCreate(sessionId: string): SessionVault {
    this.pruneExpired();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing.vault;
    }

    const newVault = new SessionVault();
    this.sessions.set(sessionId, {
      vault: newVault,
      lastAccess: Date.now(),
    });
    return newVault;
  }

  public delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.vault.clear();
      this.sessions.delete(sessionId);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, item] of this.sessions.entries()) {
      if (now - item.lastAccess > this.ttlMs) {
        item.vault.clear();
        this.sessions.delete(id);
      }
    }
  }
}
