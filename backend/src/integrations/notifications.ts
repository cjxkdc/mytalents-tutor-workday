import type { DomainEvent } from '../domain/state.js';
/** Implemented by the teammate-owned WeCom/message module. Core never sends messages by itself. */
export interface NotificationAdapter {
  /** Must deduplicate by event.id and persist delivery status in the consuming module. */
  deliver(event: DomainEvent): Promise<{ externalId: string }>;
}
export interface ArtifactStorage {
  put(input: { key: string; bytes: Uint8Array; mimeType: string }): Promise<{ artifactId: string }>;
  get(artifactId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
}
