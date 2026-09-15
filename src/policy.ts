/**
 * CloakLLM Declarative AI Policy Engine ("Policy as Code")
 * Evaluates access rules and security policies by department, role, provider, model,
 * and detected entity types.
 * Supports ALLOW, CLOAK, REDACT, BLOCK, and WARN actions.
 * Zero external dependencies. Execution latency < 0.5ms.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  DetectedEntity,
  EntityType,
  FirewallResult,
  PolicyAction,
  PolicyConfig,
  PolicyContext,
  PolicyDecision,
  PolicyRule,
} from './types.ts';

/**
 * Helper to match wildcard strings (e.g. "gpt-*" or "*")
 */
export function matchWildcard(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === '') return true;
  if (!pattern.includes('*')) {
    return pattern.toLowerCase() === value.toLowerCase();
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(value);
}

/**
 * Checks if a value matches a criteria that could be a single string or an array of strings.
 */
function matchStringOrArray(criteria: string | string[] | undefined, actualValue: string | undefined): boolean {
  if (!criteria || !actualValue) return false;
  const list = Array.isArray(criteria) ? criteria : [criteria];
  return list.some(item => matchWildcard(item, actualValue));
}

/**
 * Parses simple YAML policy configuration files without any external npm dependency.
 */
export function parsePolicyYaml(content: string): PolicyConfig {
  const lines = content.split(/\r?\n/);
  const config: PolicyConfig = {
    defaultAction: 'CLOAK',
    rules: [],
  };

  let currentRule: Partial<PolicyRule> | null = null;
  let inMatchBlock = false;

  for (let rawLine of lines) {
    const hashIndex = rawLine.indexOf('#');
    let line = hashIndex !== -1 ? rawLine.substring(0, hashIndex) : rawLine;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.search(/\S/);

    if (trimmed.startsWith('defaultAction:')) {
      const val = trimmed.substring('defaultAction:'.length).trim().toUpperCase();
      if (['ALLOW', 'CLOAK', 'REDACT', 'BLOCK', 'WARN'].includes(val)) {
        config.defaultAction = val as PolicyAction;
      }
      continue;
    }

    if (trimmed.startsWith('- id:')) {
      if (currentRule && currentRule.id && currentRule.action) {
        config.rules.push(currentRule as PolicyRule);
      }
      const idVal = trimmed.substring('- id:'.length).trim().replace(/^['"]|['"]$/g, '');
      currentRule = { id: idVal, match: {} };
      inMatchBlock = false;
      continue;
    }

    if (!currentRule) continue;

    if (trimmed.startsWith('name:')) {
      currentRule.name = trimmed.substring('name:'.length).trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (trimmed.startsWith('description:')) {
      currentRule.description = trimmed.substring('description:'.length).trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (trimmed.startsWith('action:')) {
      const act = trimmed.substring('action:'.length).trim().toUpperCase();
      currentRule.action = act as PolicyAction;
      inMatchBlock = false;
      continue;
    }

    if (trimmed.startsWith('reason:')) {
      currentRule.reason = trimmed.substring('reason:'.length).trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (trimmed === 'match:') {
      inMatchBlock = true;
      currentRule.match = currentRule.match || {};
      continue;
    }

    if (inMatchBlock) {
      currentRule.match = currentRule.match || {};

      const parseArrayOrString = (valStr: string): string | string[] => {
        const cleaned = valStr.trim();
        if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
          return cleaned
            .substring(1, cleaned.length - 1)
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        }
        return cleaned.replace(/^['"]|['"]$/g, '');
      };

      if (trimmed.startsWith('department:')) {
        currentRule.match.department = parseArrayOrString(trimmed.substring('department:'.length));
      } else if (trimmed.startsWith('role:')) {
        currentRule.match.role = parseArrayOrString(trimmed.substring('role:'.length));
      } else if (trimmed.startsWith('provider:')) {
        currentRule.match.provider = parseArrayOrString(trimmed.substring('provider:'.length));
      } else if (trimmed.startsWith('model:')) {
        currentRule.match.model = parseArrayOrString(trimmed.substring('model:'.length));
      } else if (trimmed.startsWith('minRiskScore:')) {
        currentRule.match.minRiskScore = parseInt(trimmed.substring('minRiskScore:'.length).trim(), 10);
      } else if (trimmed.startsWith('entities:')) {
        const parsed = parseArrayOrString(trimmed.substring('entities:'.length));
        currentRule.match.entities = (Array.isArray(parsed) ? parsed : [parsed]) as EntityType[];
      }
    }
  }

  if (currentRule && currentRule.id && currentRule.action) {
    config.rules.push(currentRule as PolicyRule);
  }

  return config;
}

/**
 * Loads and parses a policy file (JSON or YAML).
 */
export function loadPolicyFile(filePath: string): PolicyConfig {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Policy file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  if (resolved.endsWith('.json')) {
    return JSON.parse(content) as PolicyConfig;
  }
  return parsePolicyYaml(content);
}

export class PolicyEngine {
  private config: PolicyConfig;

  constructor(config?: PolicyConfig) {
    this.config = config || { defaultAction: 'CLOAK', rules: [] };
  }

  public getConfig(): PolicyConfig {
    return this.config;
  }

  public setConfig(config: PolicyConfig): void {
    this.config = config;
  }

  /**
   * Evaluates the policy against request context, detected entities, and prompt firewall results.
   */
  public evaluate(context: PolicyContext): PolicyDecision {
    const matchedRules: PolicyRule[] = [];
    const warnings: string[] = [];
    const redactTypes = new Set<EntityType>();
    const cloakTypes = new Set<EntityType>();
    const allowTypes = new Set<EntityType>();

    let overallAction: PolicyAction = this.config.defaultAction || 'CLOAK';
    let blockReason: string | undefined;

    const detectedTypes = new Set(context.detectedEntities.map(e => e.type));

    for (const rule of this.config.rules) {
      let isMatch = true;

      if (rule.match) {
        // 1. Department match
        if (rule.match.department && !matchStringOrArray(rule.match.department, context.department)) {
          isMatch = false;
        }

        // 2. Role match
        if (isMatch && rule.match.role && !matchStringOrArray(rule.match.role, context.role)) {
          isMatch = false;
        }

        // 3. Provider match
        if (isMatch && rule.match.provider && !matchStringOrArray(rule.match.provider, context.provider)) {
          isMatch = false;
        }

        // 4. Model match
        if (isMatch && rule.match.model && !matchStringOrArray(rule.match.model, context.model)) {
          isMatch = false;
        }

        // 5. Min risk score (Prompt injection firewall)
        if (isMatch && rule.match.minRiskScore !== undefined) {
          const actualScore = context.firewallResult?.riskScore ?? 0;
          if (actualScore < rule.match.minRiskScore) {
            isMatch = false;
          }
        }

        // 6. Entities match (must have detected at least one matching entity type)
        if (isMatch && rule.match.entities && rule.match.entities.length > 0) {
          const hasMatchingEntity = rule.match.entities.some(ent => detectedTypes.has(ent));
          if (!hasMatchingEntity) {
            isMatch = false;
          }
        }
      }

      if (isMatch) {
        matchedRules.push(rule);

        // If rule action is BLOCK, trigger immediate block
        if (rule.action === 'BLOCK') {
          overallAction = 'BLOCK';
          blockReason = rule.reason || `Blocked by security policy rule: ${rule.id}`;
          return {
            action: 'BLOCK',
            blocked: true,
            reason: blockReason,
            matchedRules,
            warnings,
            redactTypes,
            cloakTypes,
            allowTypes,
          };
        }

        // Apply rule action to specific entities or all detected entities
        overallAction = rule.action;
        const targetEntities = rule.match?.entities && rule.match.entities.length > 0
          ? rule.match.entities
          : Array.from(detectedTypes);

        for (const ent of targetEntities) {
          if (rule.action === 'REDACT') redactTypes.add(ent);
          if (rule.action === 'CLOAK') cloakTypes.add(ent);
          if (rule.action === 'ALLOW') allowTypes.add(ent);
        }

        if (rule.action === 'WARN') {
          warnings.push(rule.reason || `Policy warning triggered by rule: ${rule.id}`);
        }
      }
    }

    return {
      action: overallAction,
      blocked: false,
      matchedRules,
      warnings,
      redactTypes,
      cloakTypes,
      allowTypes,
    };
  }
}
