import test from 'node:test';
import assert from 'node:assert';
import { matchWildcard, parsePolicyYaml, PolicyEngine } from '../src/policy.ts';
import type { DetectedEntity, PolicyConfig } from '../src/types.ts';

test('matchWildcard handles exact matches, wildcards, and stars', () => {
  assert.strictEqual(matchWildcard('*', 'anything'), true);
  assert.strictEqual(matchWildcard('gpt-*', 'gpt-4o'), true);
  assert.strictEqual(matchWildcard('gpt-*', 'gpt-3.5-turbo'), true);
  assert.strictEqual(matchWildcard('gpt-*', 'claude-3-5-sonnet'), false);
  assert.strictEqual(matchWildcard('claude-*', 'claude-3-5-sonnet'), true);
});

test('parsePolicyYaml parses rules without external dependencies', () => {
  const yaml = `
defaultAction: CLOAK
rules:
  - id: block-secrets-public-llm
    name: "Block Secrets"
    match:
      entities: [SECRET, CREDIT_CARD]
      model: ["gpt-4o", "claude-*"]
    action: BLOCK
    reason: "Secrets cannot be sent to public models"
  - id: redact-hr-social-security
    name: "Redact NIR"
    match:
      department: hr
      entities: [NIR, SSN]
    action: REDACT
    reason: "Permanently redact SSN for HR"
  - id: allow-dev-internal-ips
    match:
      role: developer
      entities: [INTERNAL_IP]
    action: ALLOW
`;

  const config = parsePolicyYaml(yaml);
  assert.strictEqual(config.defaultAction, 'CLOAK');
  assert.strictEqual(config.rules.length, 3);
  assert.strictEqual(config.rules[0].id, 'block-secrets-public-llm');
  assert.strictEqual(config.rules[0].action, 'BLOCK');
  assert.deepStrictEqual(config.rules[0].match?.entities, ['SECRET', 'CREDIT_CARD']);
  assert.strictEqual(config.rules[1].action, 'REDACT');
  assert.strictEqual(config.rules[2].action, 'ALLOW');
});

test('PolicyEngine evaluates BLOCK action when rule matches', () => {
  const config: PolicyConfig = {
    defaultAction: 'CLOAK',
    rules: [
      {
        id: 'rule-block-secrets',
        match: {
          entities: ['SECRET'],
          model: 'gpt-*',
        },
        action: 'BLOCK',
        reason: 'Secrets blocked for gpt models',
      },
    ],
  };

  const engine = new PolicyEngine(config);
  const secretEntity: DetectedEntity = {
    type: 'SECRET',
    value: 'sk-proj-secret1234567890abcdef',
    start: 0,
    end: 30,
    confidence: 1,
  };

  // 1. Matches model and entity -> blocked
  const decision1 = engine.evaluate({
    model: 'gpt-4o',
    detectedEntities: [secretEntity],
  });
  assert.strictEqual(decision1.blocked, true);
  assert.strictEqual(decision1.action, 'BLOCK');
  assert.strictEqual(decision1.reason, 'Secrets blocked for gpt models');

  // 2. Different model -> not blocked
  const decision2 = engine.evaluate({
    model: 'local-mistral',
    detectedEntities: [secretEntity],
  });
  assert.strictEqual(decision2.blocked, false);
  assert.strictEqual(decision2.action, 'CLOAK');
});

test('PolicyEngine partitions entities into redactTypes, cloakTypes, and allowTypes', () => {
  const config: PolicyConfig = {
    defaultAction: 'CLOAK',
    rules: [
      {
        id: 'redact-ssn-rule',
        match: {
          department: 'hr',
          entities: ['NIR', 'SSN'],
        },
        action: 'REDACT',
      },
      {
        id: 'allow-ips-for-dev',
        match: {
          role: 'developer',
          entities: ['INTERNAL_IP'],
        },
        action: 'ALLOW',
      },
    ],
  };

  const engine = new PolicyEngine(config);
  const decision = engine.evaluate({
    department: 'hr',
    role: 'developer',
    model: 'gpt-4o',
    detectedEntities: [
      { type: 'NIR', value: '1850575108123', start: 0, end: 13, confidence: 1 },
      { type: 'INTERNAL_IP', value: '10.0.0.1', start: 15, end: 23, confidence: 1 },
      { type: 'PERSON', value: 'Alice Dupont', start: 25, end: 37, confidence: 1 },
    ],
  });

  assert.strictEqual(decision.blocked, false);
  assert.ok(decision.redactTypes.has('NIR'));
  assert.ok(decision.allowTypes.has('INTERNAL_IP'));
});

test('PolicyEngine evaluates firewall minRiskScore for blocking prompt injections', () => {
  const config: PolicyConfig = {
    rules: [
      {
        id: 'block-high-risk-prompt-injection',
        match: {
          minRiskScore: 70,
        },
        action: 'BLOCK',
        reason: 'Prompt injection attempt detected',
      },
    ],
  };

  const engine = new PolicyEngine(config);

  const decisionSafe = engine.evaluate({
    detectedEntities: [],
    firewallResult: { safe: true, riskScore: 20, flags: [], normalizedText: '', matchedPatterns: [] },
  });
  assert.strictEqual(decisionSafe.blocked, false);

  const decisionAttack = engine.evaluate({
    detectedEntities: [],
    firewallResult: { safe: false, riskScore: 75, flags: ['INSTRUCTION_OVERRIDE'], normalizedText: '', matchedPatterns: [] },
  });
  assert.strictEqual(decisionAttack.blocked, true);
  assert.strictEqual(decisionAttack.reason, 'Prompt injection attempt detected');
});
