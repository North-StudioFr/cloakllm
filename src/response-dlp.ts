/**
 * CloakLLM Bidirectional Response DLP (Data Loss Prevention)
 * Inspects LLM completions before returning them to the client.
 * Restores authorized pseudonymized placeholders while catching and neutralizing
 * newly generated or leaked secrets, credit cards, PII, and internal infrastructure IPs.
 * Zero external dependencies. Execution latency < 1ms.
 */

import type { DetectedEntity, EntityType, VaultStore } from './types.ts';
import { Deanonymizer } from './deanonymizer.ts';
import { MasterDetector } from './detectors/index.ts';
import { PolicyEngine } from './policy.ts';

export interface ResponseDlpResult {
  text: string;
  deanonymizedCount: number;
  newLeaksDetected: DetectedEntity[];
  blocked: boolean;
  blockReason?: string;
}

export class ResponseDlp {
  private detector: MasterDetector;
  private policyEngine?: PolicyEngine;

  constructor(detector: MasterDetector, policyEngine?: PolicyEngine) {
    this.detector = detector;
    this.policyEngine = policyEngine;
  }

  /**
   * Evaluates and sanitizes a complete LLM response string.
   */
  public sanitizeResponse(
    rawResponse: string,
    vault: VaultStore,
    context?: { model?: string; department?: string; role?: string }
  ): ResponseDlpResult {
    // 1. Reversibly de-anonymize legitimate placeholders tracked in session vault
    const initialMappings = vault.getAllMappings();
    const authorizedValues = new Set(initialMappings.map(m => m.originalValue.toLowerCase()));
    const deanonymized = Deanonymizer.deanonymizeText(rawResponse, vault);

    // Count how many placeholders were replaced
    let deanonymizedCount = 0;
    for (const m of initialMappings) {
      if (rawResponse.includes(m.placeholder)) {
        deanonymizedCount++;
      }
    }

    // 2. Scan de-anonymized output with MasterDetector for any newly introduced sensitive data
    const detectedInResponse = this.detector.detect(deanonymized);
    const newLeaks: DetectedEntity[] = [];

    for (const ent of detectedInResponse) {
      // If the detected entity is NOT one of the authorized values restored from the vault,
      // then it is a new piece of confidential data generated/leaked by the LLM!
      if (!authorizedValues.has(ent.value.toLowerCase())) {
        newLeaks.push(ent);
      }
    }

    if (newLeaks.length === 0) {
      return {
        text: deanonymized,
        deanonymizedCount,
        newLeaksDetected: [],
        blocked: false,
      };
    }

    // 3. Evaluate Policy for response leaks if PolicyEngine is configured
    if (this.policyEngine) {
      const decision = this.policyEngine.evaluate({
        detectedEntities: newLeaks,
        model: context?.model,
        department: context?.department,
        role: context?.role,
      });

      if (decision.blocked) {
        return {
          text: '',
          deanonymizedCount,
          newLeaksDetected: newLeaks,
          blocked: true,
          blockReason: decision.reason || 'Blocked by Response DLP policy',
        };
      }
    }

    // 4. Irreversibly redact newly leaked entities from right to left
    const sortedLeaks = [...newLeaks].sort((a, b) => b.start - a.start);
    let sanitizedOutput = deanonymized;

    for (const leak of sortedLeaks) {
      const redactionMask = `[REDACTED_${leak.type}]`;
      sanitizedOutput =
        sanitizedOutput.substring(0, leak.start) +
        redactionMask +
        sanitizedOutput.substring(leak.end);
    }

    return {
      text: sanitizedOutput,
      deanonymizedCount,
      newLeaksDetected: newLeaks,
      blocked: false,
    };
  }
}
