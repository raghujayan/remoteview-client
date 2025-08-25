/**
 * RemoteView HUD Overlay Component
 * 
 * Displays real-time statistics and connection status over the main viewer.
 */

import React from 'react';
import type { HudStats } from '../types';

interface HudOverlayProps {
  stats: HudStats;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  stats,
  connectionStatus
}) => {
  const formatBitrate = (bps: number) => {
    if (bps === 0) return '0 bps';
    
    const k = 1000;
    const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    
    return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getConnectionQuality = (rtt: number, bitrate: number) => {
    if (connectionStatus !== 'connected') return { color: 'error', text: 'Disconnected' };
    if (rtt < 50 && bitrate > 1000000) return { color: 'good', text: 'Excellent' };
    if (rtt < 100 && bitrate > 500000) return { color: 'good', text: 'Good' };
    if (rtt < 200 && bitrate > 100000) return { color: 'warning', text: 'Fair' };
    return { color: 'error', text: 'Poor' };
  };

  const quality = getConnectionQuality(stats.rtt, stats.bitrate);

  if (connectionStatus === 'disconnected') {
    return (
      <div className="hud-overlay">
        <h4>RemoteView HUD</h4>
        <div className="hud-stat">
          <span className="label">Status:</span>
          <span className="value error">Disconnected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="hud-overlay">
      <h4>RemoteView HUD</h4>
      
      <div className="hud-stat">
        <span className="label">Connection:</span>
        <span className={`value ${quality.color}`}>{quality.text}</span>
      </div>

      <div className="hud-stat">
        <span className="label">Renderer:</span>
        <span className={`value ${stats.rendererTier === 'webgpu' ? 'good' : stats.rendererTier === 'webgl2' ? 'warning' : 'error'}`}>
          {stats.rendererTier.toUpperCase()}
        </span>
      </div>

      <div className="hud-stat">
        <span className="label">RTT:</span>
        <span className="value">{stats.rtt.toFixed(1)}ms</span>
      </div>

      <div className="hud-stat">
        <span className="label">Bitrate:</span>
        <span className="value">{formatBitrate(stats.bitrate)}</span>
      </div>

      <div className="hud-stat">
        <span className="label">Tiles/sec:</span>
        <span className="value">{stats.tilesPerSecond}</span>
      </div>

      <div className="hud-stat">
        <span className="label">Dropped:</span>
        <span className={`value ${stats.droppedTiles > 0 ? 'error' : 'good'}`}>
          {stats.droppedTiles}
        </span>
      </div>

      {stats.cacheHitRatio !== undefined && (
        <div className="hud-stat">
          <span className="label">Cache Hit:</span>
          <span className="value">{(stats.cacheHitRatio * 100).toFixed(1)}%</span>
        </div>
      )}

      {stats.memoryUsage !== undefined && (
        <div className="hud-stat">
          <span className="label">Memory:</span>
          <span className="value">{(stats.memoryUsage / 1024 / 1024).toFixed(1)}MB</span>
        </div>
      )}
    </div>
  );
};