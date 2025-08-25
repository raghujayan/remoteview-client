/**
 * RemoteView Stats Collector
 * 
 * Collects RTCPeerConnection statistics and server metrics for HUD display.
 * Polls getStats() and custom metrics endpoints to provide comprehensive monitoring.
 */

import { HudStats, RendererTier } from '../types';

export interface RTCStatistics {
  // Connection stats from RTCPeerConnection.getStats()
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsLost: number;
  availableIncomingBitrate?: number;
  currentRoundTripTime?: number;
  totalProcessingDelay?: number;
  
  // Data channel stats
  messagesReceived: number;
  messagesSent: number;
  bytesReceivedDataChannel: number;
  bytesSentDataChannel: number;
}

export interface ServerMetrics {
  // Fetched from server metrics endpoint
  connections: {
    active: number;
    total: number;
  };
  tiles: {
    served: number;
    cache_hits: number;
    cache_misses: number;
    cache_hit_ratio: number;
  };
  performance: {
    avg_tile_generation_ms: number;
    avg_compression_ratio: number;
  };
  system: {
    memory_usage_bytes: number;
    cpu_usage_percent: number;
  };
}

export interface ClientMetrics {
  // Local client performance metrics
  decompression: {
    totalTasks: number;
    completedTasks: number;
    averageTimeMs: number;
    queueLength: number;
    droppedTasks: number;
  };
  parsing: {
    totalFrames: number;
    droppedFrames: number;
    successRate: number;
  };
  rendering: {
    fps: number;
    droppedFrames: number;
    tier: RendererTier;
  };
}

export class StatsCollector {
  private peerConnection: RTCPeerConnection | null = null;
  private serverMetricsUrl: string | null = null;
  private pollingInterval = 1000; // 1 second
  private isPolling = false;
  private pollIntervalId: number | null = null;
  
  private lastStatsTime = 0;
  private lastBytesReceived = 0;
  private fpsCounter: number[] = [];
  private lastFrameTime = 0;
  
  private callbacks: ((stats: HudStats) => void)[] = [];

  constructor(serverMetricsUrl?: string) {
    this.serverMetricsUrl = serverMetricsUrl || null;
  }

  setPeerConnection(peerConnection: RTCPeerConnection) {
    this.peerConnection = peerConnection;
  }

  setServerMetricsUrl(url: string) {
    this.serverMetricsUrl = url;
  }

  startPolling() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    this.pollIntervalId = window.setInterval(async () => {
      await this.collectAndNotify();
    }, this.pollingInterval);

    console.log('[StatsCollector] Started polling stats');
  }

  stopPolling() {
    if (!this.isPolling) {
      return;
    }

    this.isPolling = false;
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    console.log('[StatsCollector] Stopped polling stats');
  }

  onStatsUpdate(callback: (stats: HudStats) => void) {
    this.callbacks.push(callback);
  }

  removeStatsCallback(callback: (stats: HudStats) => void) {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  private async collectAndNotify() {
    try {
      const stats = await this.collectStats();
      this.callbacks.forEach(callback => callback(stats));
    } catch (error) {
      console.error('[StatsCollector] Failed to collect stats:', error);
    }
  }

  async collectStats(): Promise<HudStats> {
    const [rtcStats, serverMetrics, clientMetrics] = await Promise.allSettled([
      this.collectRTCStats(),
      this.collectServerMetrics(),
      this.collectClientMetrics()
    ]);

    // Calculate derived metrics
    const currentTime = performance.now();
    const rtc = rtcStats.status === 'fulfilled' ? rtcStats.value : null;
    const server = serverMetrics.status === 'fulfilled' ? serverMetrics.value : null;
    const client = clientMetrics.status === 'fulfilled' ? clientMetrics.value : null;

    // Calculate bitrate
    let bitrate = 0;
    if (rtc && this.lastStatsTime > 0) {
      const timeDelta = currentTime - this.lastStatsTime;
      const bytesDelta = rtc.bytesReceived - this.lastBytesReceived;
      bitrate = (bytesDelta * 8 * 1000) / timeDelta; // bits per second
    }

    if (rtc) {
      this.lastBytesReceived = rtc.bytesReceived;
    }
    this.lastStatsTime = currentTime;

    // Calculate FPS
    this.updateFPS();

    return {
      rtt: rtc?.currentRoundTripTime || 0,
      tilesPerSecond: this.calculateTilesPerSecond(rtc),
      droppedTiles: (client?.parsing.droppedFrames || 0) + (client?.decompression.droppedTasks || 0),
      bitrate,
      rendererTier: client?.rendering.tier || RendererTier.CPU,
      cacheHitRatio: server?.tiles.cache_hit_ratio,
      memoryUsage: server?.system.memory_usage_bytes
    };
  }

  private async collectRTCStats(): Promise<RTCStatistics | null> {
    if (!this.peerConnection) {
      return null;
    }

    try {
      const stats = await this.peerConnection.getStats();
      const result: RTCStatistics = {
        bytesReceived: 0,
        bytesSent: 0,
        packetsReceived: 0,
        packetsLost: 0,
        messagesReceived: 0,
        messagesSent: 0,
        bytesReceivedDataChannel: 0,
        bytesSentDataChannel: 0
      };

      stats.forEach((report) => {
        switch (report.type) {
          case 'inbound-rtp':
            result.bytesReceived += report.bytesReceived || 0;
            result.packetsReceived += report.packetsReceived || 0;
            result.packetsLost += report.packetsLost || 0;
            break;
            
          case 'outbound-rtp':
            result.bytesSent += report.bytesSent || 0;
            break;
            
          case 'candidate-pair':
            if (report.state === 'succeeded') {
              result.currentRoundTripTime = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : undefined;
              result.availableIncomingBitrate = report.availableIncomingBitrate;
            }
            break;
            
          case 'data-channel':
            result.messagesReceived += report.messagesReceived || 0;
            result.messagesSent += report.messagesSent || 0;
            result.bytesReceivedDataChannel += report.bytesReceived || 0;
            result.bytesSentDataChannel += report.bytesSent || 0;
            break;
        }
      });

      return result;
    } catch (error) {
      console.error('[StatsCollector] Failed to collect RTC stats:', error);
      return null;
    }
  }

  private async collectServerMetrics(): Promise<ServerMetrics | null> {
    if (!this.serverMetricsUrl) {
      return null;
    }

    try {
      const response = await fetch(this.serverMetricsUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as ServerMetrics;
    } catch (error) {
      console.error('[StatsCollector] Failed to collect server metrics:', error);
      return null;
    }
  }

  private async collectClientMetrics(): Promise<ClientMetrics> {
    // Import dynamically to avoid circular dependencies
    const { getDecompressionPool } = await import('../workers/DecompressionPool');
    const { TileDecoder } = await import('../protocol');
    
    const decompressionStats = getDecompressionPool().getStats();
    const parsingStats = TileDecoder.getParseStats();

    return {
      decompression: decompressionStats,
      parsing: parsingStats,
      rendering: {
        fps: this.getCurrentFPS(),
        droppedFrames: 0, // TODO: Get from renderer
        tier: RendererTier.CPU // TODO: Get from renderer
      }
    };
  }

  private calculateTilesPerSecond(rtcStats: RTCStatistics | null): number {
    if (!rtcStats) {
      return 0;
    }
    
    // Estimate based on message rate over data channel
    // This is a rough estimate - could be improved with dedicated counters
    const messagesPerSecond = rtcStats.messagesReceived / (this.lastStatsTime / 1000);
    return Math.round(messagesPerSecond);
  }

  private updateFPS() {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const frameDelta = now - this.lastFrameTime;
      this.fpsCounter.push(1000 / frameDelta);
      
      // Keep only last 60 frame times for averaging
      if (this.fpsCounter.length > 60) {
        this.fpsCounter.shift();
      }
    }
    this.lastFrameTime = now;
  }

  private getCurrentFPS(): number {
    if (this.fpsCounter.length === 0) {
      return 0;
    }
    
    const sum = this.fpsCounter.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.fpsCounter.length);
  }

  // Call this from your render loop to update FPS tracking
  recordFrame() {
    this.updateFPS();
  }

  dispose() {
    this.stopPolling();
    this.callbacks.length = 0;
    this.peerConnection = null;
  }
}