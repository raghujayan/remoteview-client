/**
 * RemoteView HUD Module
 * 
 * Exports HUD components and utilities for displaying real-time statistics
 * including RTCPeerConnection stats and server metrics.
 */

export { StatsCollector } from './StatsCollector';
export { HudComponent } from './HudComponent';
export { HudOverlay } from './HudOverlay';
export type { RTCStatistics, ServerMetrics, ClientMetrics } from './StatsCollector';