import test from 'node:test';
import assert from 'node:assert';
import { calculateShannonEntropy, EntropyDetector } from '../src/detectors/entropy.ts';
import { isPrivateIpv4, isPrivateIpv6, NetworkDetector } from '../src/detectors/network.ts';
import { MasterDetector } from '../src/detectors/index.ts';

test('calculateShannonEntropy computes accurate mathematical entropy', () => {
  // String of identical characters has 0 entropy
  assert.strictEqual(calculateShannonEntropy('AAAAAAAAAA'), 0);

  // Natural English words typically have low-to-medium entropy (< 3.5)
  const english = calculateShannonEntropy('internationalization');
  assert.ok(english < 3.8, `English entropy too high: ${english}`);

  // High randomness hex string (32 chars)
  const randomHex = '4f72fde6d1bb4777a00cf5537cc632bc';
  const hexEntropy = calculateShannonEntropy(randomHex);
  assert.ok(hexEntropy > 3.4, `Hex entropy too low: ${hexEntropy}`);

  // High randomness Base64 token (32 chars)
  const randomBase64 = 'k8Z+w1Vq9PxT2LmN0bC4YrD7GjQeFhU=';
  const base64Entropy = calculateShannonEntropy(randomBase64);
  assert.ok(base64Entropy > 4.2, `Base64 entropy too low: ${base64Entropy}`);
});

test('EntropyDetector detects unknown random secrets and ignores normal words', () => {
  const detector = new EntropyDetector();

  // High-entropy 32-char hex secret
  const hexSecret = 'Secret: a8f9c3e21047bd45ef901234abcd5678 in database';
  const detectedHex = detector.detect(hexSecret);
  assert.strictEqual(detectedHex.length, 1);
  assert.strictEqual(detectedHex[0].type, 'SECRET');
  assert.strictEqual(detectedHex[0].value, 'a8f9c3e21047bd45ef901234abcd5678');
  assert.strictEqual(detectedHex[0].metadata?.encoding, 'hex');

  // Normal text without high-entropy strings
  const clean = detector.detect('This is a completely normal sentence without any high entropy tokens at all.');
  assert.strictEqual(clean.length, 0);
});

test('isPrivateIpv4 and isPrivateIpv6 accurately classify RFC 1918 and loopback subnets', () => {
  // RFC 1918 10.0.0.0/8
  assert.strictEqual(isPrivateIpv4('10.0.0.1'), true);
  assert.strictEqual(isPrivateIpv4('10.254.12.34'), true);

  // RFC 1918 172.16.0.0/12
  assert.strictEqual(isPrivateIpv4('172.16.0.5'), true);
  assert.strictEqual(isPrivateIpv4('172.31.255.254'), true);
  assert.strictEqual(isPrivateIpv4('172.32.0.1'), false); // Outside /12

  // RFC 1918 192.168.0.0/16
  assert.strictEqual(isPrivateIpv4('192.168.1.1'), true);
  assert.strictEqual(isPrivateIpv4('192.168.100.250'), true);
  assert.strictEqual(isPrivateIpv4('192.169.1.1'), false);

  // Loopback and link-local
  assert.strictEqual(isPrivateIpv4('127.0.0.1'), true);
  assert.strictEqual(isPrivateIpv4('169.254.1.2'), true);

  // Public IPv4
  assert.strictEqual(isPrivateIpv4('8.8.8.8'), false);
  assert.strictEqual(isPrivateIpv4('142.250.180.206'), false);

  // IPv6 Private / Loopback
  assert.strictEqual(isPrivateIpv6('::1'), true);
  assert.strictEqual(isPrivateIpv6('fc00::1'), true);
  assert.strictEqual(isPrivateIpv6('fe80::1ff:fe23:4567'), true);

  // Public IPv6
  assert.strictEqual(isPrivateIpv6('2001:4860:4860::8888'), false);
});

test('NetworkDetector emits INTERNAL_IP for private subnets and IP_ADDRESS for public IPs', () => {
  const detector = new NetworkDetector();
  const text = 'Connect to database at 192.168.1.50 or proxy at 10.0.0.1, external DNS is 8.8.8.8.';

  const results = detector.detect(text);
  assert.strictEqual(results.length, 3);

  const internal1 = results.find(r => r.value === '192.168.1.50');
  assert.ok(internal1);
  assert.strictEqual(internal1.type, 'INTERNAL_IP');

  const internal2 = results.find(r => r.value === '10.0.0.1');
  assert.ok(internal2);
  assert.strictEqual(internal2.type, 'INTERNAL_IP');

  const publicIp = results.find(r => r.value === '8.8.8.8');
  assert.ok(publicIp);
  assert.strictEqual(publicIp.type, 'IP_ADDRESS');
});

test('MasterDetector prioritizes INTERNAL_IP over generic IP_ADDRESS', () => {
  const master = new MasterDetector();
  const detected = master.detect('Internal server: 10.10.20.30');

  assert.strictEqual(detected.length, 1);
  assert.strictEqual(detected[0].type, 'INTERNAL_IP');
  assert.strictEqual(detected[0].value, '10.10.20.30');
});
