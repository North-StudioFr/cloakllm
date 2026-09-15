/**
 * Tests for CloakLLM Custom Business Dictionaries & Rules Engine
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  parseConfig,
  parseSimpleYaml,
  loadConfigFile,
  CustomRulesDetector,
  MasterDetector,
  Anonymizer,
  Deanonymizer,
  CloakProxyServer,
} from '../src/index.ts';

test('parseConfig parses JSON dictionaries and custom patterns', () => {
  const jsonContent = JSON.stringify({
    dictionaries: [
      {
        name: 'secret_projects',
        type: 'PROJECT',
        terms: ['Project Titan', 'Apollo 11', 'Project Bluebook'],
        caseSensitive: false,
      },
      {
        name: 'vip_clients',
        type: 'CLIENT',
        terms: ['Acme Corp', 'Wayne Enterprises'],
      },
    ],
    customPatterns: [
      {
        name: 'badge_id',
        type: 'EMPLOYEE_ID',
        pattern: 'EMP-\\d{4,6}',
      },
    ],
  });

  const config = parseConfig(jsonContent);
  assert.equal(config.dictionaries?.length, 2);
  assert.equal(config.dictionaries?.[0].name, 'secret_projects');
  assert.equal(config.dictionaries?.[0].type, 'PROJECT');
  assert.equal(config.dictionaries?.[0].terms.length, 3);
  assert.equal(config.customPatterns?.length, 1);
  assert.equal(config.customPatterns?.[0].name, 'badge_id');
});

test('parseSimpleYaml parses YAML dictionaries and custom patterns without dependencies', () => {
  const yamlContent = `
dictionaries:
  - name: internal_projects
    type: PROJECT
    caseSensitive: true
    terms:
      - Project Starlight
      - Pegasus Vault
  - name: key_partners
    type: CLIENT
    terms:
      - Cyberdyne Systems
customPatterns:
  - name: internal_ip
    type: INTERNAL_IP
    pattern: "10\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}"
`;

  const config = parseSimpleYaml(yamlContent);
  assert.equal(config.dictionaries?.length, 2);
  assert.equal(config.dictionaries?.[0].name, 'internal_projects');
  assert.equal(config.dictionaries?.[0].type, 'PROJECT');
  assert.equal(config.dictionaries?.[0].caseSensitive, true);
  assert.deepEqual(config.dictionaries?.[0].terms, ['Project Starlight', 'Pegasus Vault']);
  assert.equal(config.customPatterns?.length, 1);
  assert.equal(config.customPatterns?.[0].type, 'INTERNAL_IP');
});

test('CustomRulesDetector accurately detects dictionary terms with boundary safety', () => {
  const detector = new CustomRulesDetector({
    dictionaries: [
      {
        name: 'projects',
        type: 'PROJECT',
        terms: ['Titan', 'Project Apollo', 'Valkyrie'],
      },
      {
        name: 'clients',
        type: 'CLIENT',
        terms: ['Stark Industries', 'Wayne Corp'],
      },
    ],
  });

  const text = 'Meeting with Stark Industries regarding Project Apollo and Titan deployment.';
  const entities = detector.detect(text);

  assert.equal(entities.length, 3);
  assert.equal(entities[0].type, 'CLIENT');
  assert.equal(entities[0].value, 'Stark Industries');
  assert.equal(entities[1].type, 'PROJECT');
  assert.equal(entities[1].value, 'Project Apollo');
  assert.equal(entities[2].type, 'PROJECT');
  assert.equal(entities[2].value, 'Titan');

  // Verify boundary safety: "Titanium" should not match "Titan"
  const safeText = 'The fuselage is made of Titanium alloy.';
  const noMatches = detector.detect(safeText);
  assert.equal(noMatches.length, 0);
});

test('CustomRulesDetector handles terms containing regex special characters', () => {
  const detector = new CustomRulesDetector({
    dictionaries: [
      {
        name: 'tech_stacks',
        type: 'TECH_SECRET',
        terms: ['C++', 'Node.js', 'A&B (Holdings)', '$SuperSecret'],
      },
    ],
  });

  const text = 'Migration from C++ and Node.js to A&B (Holdings) with $SuperSecret vault.';
  const matches = detector.detect(text);

  assert.equal(matches.length, 4);
  assert.equal(matches[0].value, 'C++');
  assert.equal(matches[1].value, 'Node.js');
  assert.equal(matches[2].value, 'A&B (Holdings)');
  assert.equal(matches[3].value, '$SuperSecret');
});

test('CustomRulesDetector respects case sensitivity setting', () => {
  const detector = new CustomRulesDetector({
    dictionaries: [
      {
        name: 'case_sensitive_code',
        type: 'SECRET_CODE',
        terms: ['RedAlert'],
        caseSensitive: true,
      },
    ],
  });

  assert.equal(detector.detect('System in RedAlert mode.').length, 1);
  assert.equal(detector.detect('System in redalert mode.').length, 0);
});

test('CustomRulesDetector detects custom regex patterns', () => {
  const detector = new CustomRulesDetector({
    customPatterns: [
      {
        name: 'internal_ip',
        type: 'INTERNAL_IP',
        pattern: '10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}',
      },
      {
        name: 'employee_badge',
        type: 'EMPLOYEE_ID',
        pattern: 'EMP-[0-9]{5}',
      },
    ],
  });

  const text = 'Forward audit logs to 10.4.15.22 for user EMP-49201.';
  const entities = detector.detect(text);

  assert.equal(entities.length, 2);
  assert.equal(entities[0].type, 'INTERNAL_IP');
  assert.equal(entities[0].value, '10.4.15.22');
  assert.equal(entities[1].type, 'EMPLOYEE_ID');
  assert.equal(entities[1].value, 'EMP-49201');
});

test('MasterDetector prioritizes business dictionaries over generic NER heuristics', () => {
  const master = new MasterDetector({
    customConfig: {
      dictionaries: [
        {
          name: 'vip_clients',
          type: 'CLIENT',
          terms: ['Wayne Enterprises'],
        },
        {
          name: 'projects',
          type: 'PROJECT',
          terms: ['Project Phoenix'],
        },
      ],
    },
  });

  // Wayne Enterprises could be classified as ORGANIZATION by heuristic, but should be CLIENT
  const entities = master.detect('Review confidential contract for Wayne Enterprises under Project Phoenix.');
  const clientEnt = entities.find(e => e.value === 'Wayne Enterprises');
  const projectEnt = entities.find(e => e.value === 'Project Phoenix');

  assert.ok(clientEnt);
  assert.equal(clientEnt.type, 'CLIENT');

  assert.ok(projectEnt);
  assert.equal(projectEnt.type, 'PROJECT');
});

test('End-to-end Anonymization and Deanonymization with custom business tokens', () => {
  const master = new MasterDetector({
    customConfig: {
      dictionaries: [
        {
          name: 'projects',
          type: 'PROJECT',
          terms: ['Project Chimera'],
        },
        {
          name: 'clients',
          type: 'CLIENT',
          terms: ['Cyberdyne Systems'],
        },
      ],
    },
  });

  const anonymizer = new Anonymizer(master);
  const rawPrompt = 'Deliver deliverables for Cyberdyne Systems under Project Chimera.';
  const result = anonymizer.anonymizeText(rawPrompt);

  assert.ok(result.sanitized.includes('[CLIENT_1]'));
  assert.ok(result.sanitized.includes('[PROJECT_1]'));
  assert.ok(!result.sanitized.includes('Cyberdyne Systems'));
  assert.ok(!result.sanitized.includes('Project Chimera'));

  // Reversible de-anonymization
  const restored = Deanonymizer.deanonymizeText(result.sanitized, result.vault);
  assert.equal(restored, rawPrompt);
});

test('loadConfigFile loads and applies custom JSON configuration file', () => {
  const tmpFile = path.join(os.tmpdir(), `cloakllm-test-${Date.now()}.json`);
  fs.writeFileSync(
    tmpFile,
    JSON.stringify({
      dictionaries: [
        {
          name: 'top_secret',
          type: 'PROJECT',
          terms: ['Blackbird X'],
        },
      ],
    })
  );

  try {
    const config = loadConfigFile(tmpFile);
    assert.equal(config.dictionaries?.length, 1);
    assert.equal(config.dictionaries?.[0].terms[0], 'Blackbird X');

    const master = new MasterDetector({ customConfig: config });
    const entities = master.detect('Operation Blackbird X initiated.');
    assert.equal(entities.length, 1);
    assert.equal(entities[0].type, 'PROJECT');
    assert.equal(entities[0].value, 'Blackbird X');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

function createMockRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  const stream = new Readable({
    read() {
      if (options.body) {
        this.push(Buffer.from(options.body));
      }
      this.push(null);
    },
  });
  (stream as any).method = options.method;
  (stream as any).url = options.url;
  (stream as any).headers = options.headers || {};
  return stream;
}

function createMockResponse() {
  const ee = new EventEmitter();
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];

  return Object.assign(ee, {
    statusCode,
    headersSent: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return this;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    writeHead(c: number, hdrs?: Record<string, string>) {
      statusCode = c;
      this.headersSent = true;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v;
        }
      }
      return this;
    },
    write(chunk: any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.headersSent = true;
      ee.emit('finish');
      return this;
    },
    getStatusCode() { return statusCode; },
    getBody() { return Buffer.concat(chunks).toString('utf-8'); },
  });
}

test('CloakProxyServer /api/config and /api/config/dictionary routes work', async () => {
  const proxy = new CloakProxyServer({
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL', 'PROJECT', 'CLIENT'],
    enableDashboard: false,
    logLevel: 'silent',
    customConfig: {
      dictionaries: [
        {
          name: 'initial_dict',
          type: 'PROJECT',
          terms: ['Project Genesis'],
        },
      ],
    },
  });

  // 1. Check GET /api/config
  const req1 = createMockRequest({ method: 'GET', url: '/api/config' });
  const res1 = createMockResponse();
  await proxy.handleRequest(req1 as any, res1 as any);

  assert.equal(res1.getStatusCode(), 200);
  const cfgData = JSON.parse(res1.getBody());
  assert.equal(cfgData.hasCustomConfig, true);
  assert.equal(cfgData.dictionaries.length, 1);
  assert.equal(cfgData.dictionaries[0].name, 'initial_dict');

  // 2. Register dynamic dictionary via POST /api/config/dictionary
  const req2 = createMockRequest({
    method: 'POST',
    url: '/api/config/dictionary',
    body: JSON.stringify({
      name: 'dynamic_partners',
      type: 'CLIENT',
      terms: ['Omni Consumer Products'],
    }),
  });
  const res2 = createMockResponse();
  await proxy.handleRequest(req2 as any, res2 as any);

  assert.equal(res2.getStatusCode(), 200);
  const postData = JSON.parse(res2.getBody());
  assert.equal(postData.status, 'ok');

  // 3. Register dynamic pattern via POST /api/config/pattern
  const reqPattern = createMockRequest({
    method: 'POST',
    url: '/api/config/pattern',
    body: JSON.stringify({
      name: 'badge_rule',
      type: 'BADGE_ID',
      pattern: 'BADGE-[0-9]{4}',
    }),
  });
  const resPattern = createMockResponse();
  await proxy.handleRequest(reqPattern as any, resPattern as any);
  assert.equal(resPattern.getStatusCode(), 200);

  // 4. Verify GET /api/config reflects both registered dictionary and pattern
  const reqCheck = createMockRequest({ method: 'GET', url: '/api/config' });
  const resCheck = createMockResponse();
  await proxy.handleRequest(reqCheck as any, resCheck as any);
  assert.equal(resCheck.getStatusCode(), 200);
  const updatedCfg = JSON.parse(resCheck.getBody());
  assert.equal(updatedCfg.dictionaries.length, 2);
  assert.ok(updatedCfg.dictionaries.some((d: any) => d.name === 'dynamic_partners'));
  assert.equal(updatedCfg.patterns.length, 1);
  assert.equal(updatedCfg.patterns[0].name, 'badge_rule');

  // 5. Test that both newly registered dictionary and pattern are detected via /api/sanitize
  const req3 = createMockRequest({
    method: 'POST',
    url: '/api/sanitize',
    body: JSON.stringify({ text: 'Contract with Omni Consumer Products for employee BADGE-9481.' }),
  });
  const res3 = createMockResponse();
  await proxy.handleRequest(req3 as any, res3 as any);

  assert.equal(res3.getStatusCode(), 200);
  const testData = JSON.parse(res3.getBody());
  assert.ok(testData.sanitized.includes('[CLIENT_1]'));
  assert.ok(testData.sanitized.includes('[BADGE_ID_1]'));
  assert.ok(!testData.sanitized.includes('Omni Consumer Products'));
  assert.ok(!testData.sanitized.includes('BADGE-9481'));
});

test('parseSimpleYaml handles terms containing "name:", inline arrays, and boolean variants', () => {
  const yaml = `
dictionaries:
  - name: internal_servers
    type: PROJECT
    case_sensitive: yes
    terms:
      - server with name: zeus
      - regular database node
  - name: inline_partners
    type: CLIENT
    caseSensitive: false
    terms: ["Cyberdyne Systems", "Tyrell Corporation"]
customPatterns:
  - name: project_tag
    type: PROJECT_TAG
    pattern: "PRJ-[A-Z]{3}-[0-9]{2}"
`;

  const config = parseSimpleYaml(yaml);
  assert.equal(config.dictionaries?.length, 2);

  const d1 = config.dictionaries?.[0];
  assert.equal(d1?.name, 'internal_servers');
  assert.equal(d1?.caseSensitive, true);
  assert.deepEqual(d1?.terms, ['server with name: zeus', 'regular database node']);

  const d2 = config.dictionaries?.[1];
  assert.equal(d2?.name, 'inline_partners');
  assert.equal(d2?.caseSensitive, false);
  assert.deepEqual(d2?.terms, ['Cyberdyne Systems', 'Tyrell Corporation']);

  assert.equal(config.customPatterns?.length, 1);
  assert.equal(config.customPatterns?.[0].name, 'project_tag');
});
