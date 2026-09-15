/**
 * CloakLLM RFC 1918 & Internal Network IP Detector
 * Differentiates public IP addresses from private enterprise subnets:
 * - RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - RFC 3927: 169.254.0.0/16 (Link-local)
 * - RFC 1122: 127.0.0.0/8 (Loopback)
 * - IPv6 RFC 4193 / 4291: fc00::/7 (ULA), fe80::/10 (Link-local), ::1 (Loopback)
 * Zero external dependencies. Execution latency < 0.2ms.
 */

import type { DetectedEntity, DetectorPlugin, EntityType } from '../types.ts';

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
// IPv6 regex including IPv4-mapped IPv6 (::ffff:x.x.x.x)
const IPV6_PATTERN = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:|\b::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b|::ffff:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b|\b::1\b/g;

/**
 * Evaluates whether an IPv4 address belongs to a private/internal subnet.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;

  // 10.0.0.0/8
  if (a === 10) return true;

  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Evaluates whether an IPv6 address belongs to a private/internal subnet.
 */
export function isPrivateIpv6(ip: string): boolean {
  const clean = ip.toLowerCase().trim();

  // IPv4-mapped IPv6 (::ffff:192.168.1.1)
  if (clean.startsWith('::ffff:')) {
    const mapped = clean.substring('::ffff:'.length);
    return isPrivateIpv4(mapped);
  }

  // Loopback ::1
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1') return true;

  // Unique Local Addresses (fc00::/7 -> fc.. or fd..)
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true;

  // Link-local addresses (fe80::/10 -> fe8, fe9, fea, feb)
  if (/^fe[89ab]/i.test(clean)) return true;

  return false;
}

export class NetworkDetector implements DetectorPlugin {
  public name = 'NetworkDetector';
  public supportedTypes = ['INTERNAL_IP' as const, 'IP_ADDRESS' as const];

  public detect(text: string): DetectedEntity[] {
    const results: DetectedEntity[] = [];
    if (!text) return results;

    // 1. IPv4 Detection and Subnet Classification
    for (const match of text.matchAll(IPV4_PATTERN)) {
      if (match.index === undefined) continue;
      const ip = match[0];

      // Exclude version patterns like v1.2.3.4
      const prefix = text.substring(Math.max(0, match.index - 10), match.index);
      if (/(?:^|[\s,;:])v(?:ersion)?[\s.]*$/i.test(prefix)) continue;

      // Exclude IPv4-mapped IPv6 (handled by IPv6 pattern)
      if (/::ffff:$/i.test(prefix)) continue;

      const isInternal = isPrivateIpv4(ip);
      const entityType: EntityType = isInternal ? 'INTERNAL_IP' : 'IP_ADDRESS';

      results.push({
        type: entityType,
        value: ip,
        start: match.index,
        end: match.index + ip.length,
        confidence: 0.98,
        metadata: {
          version: 'v4',
          isInternal,
          subnet: isInternal ? 'RFC_1918_OR_LOCAL' : 'PUBLIC',
        },
      });
    }

    // 2. IPv6 Detection and Subnet Classification
    for (const match of text.matchAll(IPV6_PATTERN)) {
      if (match.index === undefined) continue;
      const ip = match[0];

      const isInternal = isPrivateIpv6(ip);
      const entityType: EntityType = isInternal ? 'INTERNAL_IP' : 'IP_ADDRESS';

      results.push({
        type: entityType,
        value: ip,
        start: match.index,
        end: match.index + ip.length,
        confidence: 0.96,
        metadata: {
          version: 'v6',
          isInternal,
          subnet: isInternal ? 'RFC_4193_OR_LOCAL' : 'PUBLIC',
        },
      });
    }

    return results;
  }
}
