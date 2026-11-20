import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "node:https";

export class UnsafeHttpsTargetError extends Error {
  constructor() {
    super("HTTPS destination does not resolve exclusively to public addresses.");
    this.name = "UnsafeHttpsTargetError";
  }
}

export type PublicHttpsTarget = { url: URL; hostname: string; address: string; family: number };
type Resolver = typeof lookup;

function ipv4Number(address: string) {
  return address.split(".").map(Number).reduce((value, part) => value * 256 + part, 0);
}

function ipv4In(address: string, network: string, prefix: number) {
  const shift = 32 - prefix;
  return (ipv4Number(address) >>> shift) === (ipv4Number(network) >>> shift);
}

function ipv6Groups(address: string): number[] {
  let input = address.toLowerCase();
  const embeddedV4 = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embeddedV4) {
    const bytes = embeddedV4[1].split(".").map(Number);
    if (bytes.some((byte) => byte < 0 || byte > 255)) return [];
    input = input.slice(0, -embeddedV4[1].length) + `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return [];
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return [];
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((group) => /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN);
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : [];
}

/** Rejects special-use IPv4 ranges and IPv6 addresses outside global unicast. */
export function unsafeHttpsAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([network, prefix]) => ipv4In(address, String(network), Number(prefix)));
  }
  if (family !== 6) return true;
  const groups = ipv6Groups(address);
  if (!groups.length) return true;
  const first = groups[0], second = groups[1];
  // Only the 2000::/3 global-unicast allocation is accepted. This also blocks
  // loopback, unspecified, ULA, link-local, multicast, and IPv4-mapped forms.
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return true;
  if (first === 0x2002 || first === 0x3fff) return true;
  return false;
}

export async function resolvePublicHttpsTarget(raw: string, resolver: Resolver = lookup): Promise<PublicHttpsTarget> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new UnsafeHttpsTargetError(); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname || (url.port && url.port !== "443"))
    throw new UnsafeHttpsTargetError();
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await resolver(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => unsafeHttpsAddress(address))) throw new UnsafeHttpsTargetError();
  return { url, hostname, address: addresses[0].address, family: addresses[0].family };
}

export function pinnedHttpsLookup(target: PublicHttpsTarget): LookupFunction {
  return (hostname, options, callback) => {
    const normalized = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (normalized !== target.hostname.toLowerCase()) {
      callback(new UnsafeHttpsTargetError(), "", 0);
      return;
    }
    if (typeof options === "object" && options !== null && "all" in options && options.all) {
      callback(null, [{ address: target.address, family: target.family }]);
      return;
    }
    callback(null, target.address, target.family);
  };
}

export function pinnedHttpsAgent(target: PublicHttpsTarget) {
  return new Agent({ keepAlive: false, lookup: pinnedHttpsLookup(target) });
}
