/**
 * CloakLLM AI Cost & Abuse Guard (FinOps & Circuit Breaker)
 * Provides in-memory sliding window rate limiting, token quota tracking,
 * and an agentic loop circuit breaker to prevent runaway infinite loops and DoS.
 * Zero external dependencies. Execution latency < 0.2ms.
 */

import crypto from 'node:crypto';
import type { CircuitBreakerState, CostGuardConfig, RateLimitStatus } from './types.ts';

interface RequestLogEntry {
  timestamp: number;
  tokens: number;
  promptHash: string;
}

interface ClientTracker {
  requests: RequestLogEntry[];
  consecutiveIdenticalCount: number;
  lastPromptHash: string;
  lastPromptTime: number;
  circuitState: CircuitBreakerState;
  circuitOpenedAt: number;
}

/**
 * Approximate token estimator (~4 chars per token for Latin/code, with word heuristic)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Estimate based on whitespace and character length
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  return Math.max(1, Math.round(Math.max(chars / 4, words * 1.3)));
}

export class CostGuard {
  private clients = new Map<string, ClientTracker>();
  private maxRequestsPerMinute: number;
  private maxTokensPerMinute: number;
  private maxIdenticalPrompts: number;
  private circuitCooldownMs: number;
  private maxTrackedClients: number = 5000;

  constructor(config?: CostGuardConfig) {
    this.maxRequestsPerMinute = config?.maxRequestsPerMinute ?? 60;
    this.maxTokensPerMinute = config?.maxTokensPerMinute ?? 100_000;
    this.maxIdenticalPrompts = config?.maxIdenticalPrompts ?? 3;
    this.circuitCooldownMs = config?.circuitCooldownMs ?? 30_000;
  }

  private getTracker(key: string): ClientTracker {
    let tracker = this.clients.get(key);
    if (!tracker) {
      // Evict old entries if client map exceeds maximum bound
      if (this.clients.size >= this.maxTrackedClients) {
        const firstKey = this.clients.keys().next().value;
        if (firstKey) this.clients.delete(firstKey);
      }

      tracker = {
        requests: [],
        consecutiveIdenticalCount: 0,
        lastPromptHash: '',
        lastPromptTime: 0,
        circuitState: 'CLOSED',
        circuitOpenedAt: 0,
      };
      this.clients.set(key, tracker);
    }
    return tracker;
  }

  /**
   * Hashes prompt content for fast loop detection.
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Evaluates request against rate limits, token budget, and agentic loop patterns.
   */
  public checkRequest(
    clientKey: string,
    promptText: string,
    now: number = Date.now()
  ): RateLimitStatus {
    const tracker = this.getTracker(clientKey);
    const windowStart = now - 60_000;

    // 1. Check Circuit Breaker State
    if (tracker.circuitState === 'OPEN') {
      if (now - tracker.circuitOpenedAt >= this.circuitCooldownMs) {
        tracker.circuitState = 'HALF_OPEN';
      } else {
        const retryAfter = Math.ceil((this.circuitCooldownMs - (now - tracker.circuitOpenedAt)) / 1000);
        return {
          allowed: false,
          circuitState: 'OPEN',
          reason: `Agentic loop circuit breaker tripped. Cooling down for ${retryAfter}s.`,
          retryAfterSeconds: retryAfter,
          remainingRequests: 0,
        };
      }
    }

    // 2. Prune entries older than 60s
    tracker.requests = tracker.requests.filter(r => r.timestamp >= windowStart);

    // 3. Rate Limit (Requests per minute)
    if (tracker.requests.length >= this.maxRequestsPerMinute) {
      const oldest = tracker.requests[0];
      const retryAfter = Math.ceil((oldest.timestamp + 60_000 - now) / 1000);
      return {
        allowed: false,
        circuitState: tracker.circuitState,
        reason: `Rate limit exceeded (${this.maxRequestsPerMinute} req/min).`,
        retryAfterSeconds: Math.max(1, retryAfter),
        remainingRequests: 0,
      };
    }

    // 4. Token Quota Limit
    const estimatedNewTokens = estimateTokens(promptText);
    const currentTokens = tracker.requests.reduce((sum, r) => sum + r.tokens, 0);
    if (currentTokens + estimatedNewTokens > this.maxTokensPerMinute) {
      return {
        allowed: false,
        circuitState: tracker.circuitState,
        reason: `Token quota exceeded (${this.maxTokensPerMinute} tokens/min).`,
        retryAfterSeconds: 15,
        remainingRequests: Math.max(0, this.maxRequestsPerMinute - tracker.requests.length),
      };
    }

    // 5. Agentic Loop Detection (consecutive identical prompts within 60s)
    const promptHash = this.hashContent(promptText);
    const isRapidConsecutive = promptHash === tracker.lastPromptHash && (now - tracker.lastPromptTime <= 60_000);
    if (isRapidConsecutive) {
      tracker.consecutiveIdenticalCount++;
    } else {
      tracker.consecutiveIdenticalCount = 1;
      tracker.lastPromptHash = promptHash;
    }
    tracker.lastPromptTime = now;

    if (tracker.consecutiveIdenticalCount >= this.maxIdenticalPrompts) {
      // Trip the circuit breaker!
      tracker.circuitState = 'OPEN';
      tracker.circuitOpenedAt = now;
      const retryAfter = Math.ceil(this.circuitCooldownMs / 1000);
      return {
        allowed: false,
        circuitState: 'OPEN',
        reason: `Runaway agentic loop detected: ${this.maxIdenticalPrompts} identical consecutive requests. Circuit breaker OPEN.`,
        retryAfterSeconds: retryAfter,
        remainingRequests: 0,
      };
    }

    // If request was permitted in HALF_OPEN state and did not trigger a loop, close the circuit
    if (tracker.circuitState === 'HALF_OPEN') {
      tracker.circuitState = 'CLOSED';
    }

    // Record request in sliding window
    tracker.requests.push({
      timestamp: now,
      tokens: estimatedNewTokens,
      promptHash,
    });

    return {
      allowed: true,
      circuitState: tracker.circuitState,
      remainingRequests: Math.max(0, this.maxRequestsPerMinute - tracker.requests.length),
    };
  }

  /**
   * Resets limits for a specific client or all clients.
   */
  public reset(clientKey?: string): void {
    if (clientKey) {
      this.clients.delete(clientKey);
    } else {
      this.clients.clear();
    }
  }
}
