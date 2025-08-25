/**
 * RemoteView HUD Component
 * 
 * Displays real-time statistics including RTCPeerConnection stats,
 * server metrics, and client performance metrics side-by-side.
 */

import React, { useState, useEffect, useRef } from 'react';
import { HudStats, RendererTier } from '../types';
import { StatsCollector } from './StatsCollector';

interface HudProps {
  statsCollector: StatsCollector;
  visible?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  compact?: boolean;
}

export const HudComponent: React.FC<HudProps> = ({ 
  statsCollector, 
  visible = true,
  position = 'top-right',
  compact = false
}) => {
  const [stats, setStats] = useState<HudStats>({
    rtt: 0,
    tilesPerSecond: 0,
    droppedTiles: 0,
    bitrate: 0,
    rendererTier: RendererTier.CPU
  });

  const [isExpanded, setIsExpanded] = useState(!compact);
  const updateCountRef = useRef(0);

  useEffect(() => {
    const handleStatsUpdate = (newStats: HudStats) => {
      setStats(newStats);
      updateCountRef.current++;
    };

    statsCollector.onStatsUpdate(handleStatsUpdate);

    return () => {
      statsCollector.removeStatsCallback(handleStatsUpdate);
    };
  }, [statsCollector]);

  if (!visible) {
    return null;
  }

  const formatBytes = (bytes?: number) => {
    if (bytes === undefined) return 'N/A';
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatBitrate = (bps: number) => {
    if (bps === 0) return '0 bps';
    
    const k = 1000;
    const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    
    return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getPositionClasses = () => {
    const base = 'fixed z-50';
    switch (position) {
      case 'top-left':
        return `${base} top-4 left-4`;
      case 'top-right':
        return `${base} top-4 right-4`;
      case 'bottom-left':
        return `${base} bottom-4 left-4`;
      case 'bottom-right':
        return `${base} bottom-4 right-4`;
      default:
        return `${base} top-4 right-4`;
    }
  };

  const getRendererColor = (tier: RendererTier) => {
    switch (tier) {
      case RendererTier.WebGPU:
        return 'text-green-400';
      case RendererTier.WebGL2:
        return 'text-yellow-400';
      case RendererTier.CPU:
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getConnectionQuality = (rtt: number, bitrate: number) => {
    if (rtt < 50 && bitrate > 1000000) return { color: 'text-green-400', text: 'Excellent' };
    if (rtt < 100 && bitrate > 500000) return { color: 'text-yellow-400', text: 'Good' };
    if (rtt < 200 && bitrate > 100000) return { color: 'text-orange-400', text: 'Fair' };
    return { color: 'text-red-400', text: 'Poor' };
  };

  const quality = getConnectionQuality(stats.rtt, stats.bitrate);

  return (
    <div className={getPositionClasses()}>
      <div className="bg-black bg-opacity-80 text-white text-xs font-mono rounded-lg border border-gray-600 shadow-lg">
        {/* Header */}
        <div 
          className="flex items-center justify-between p-2 border-b border-gray-600 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${quality.color.replace('text-', 'bg-')}`}></div>
            <span className="font-semibold">RemoteView HUD</span>
          </div>
          <span className="text-gray-400">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>

        {isExpanded && (
          <div className="p-3 space-y-3">
            {/* Connection Quality */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-400">Connection:</span>
                <span className={`ml-1 font-semibold ${quality.color}`}>
                  {quality.text}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Renderer:</span>
                <span className={`ml-1 font-semibold ${getRendererColor(stats.rendererTier)}`}>
                  {stats.rendererTier.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Network Stats */}
            <div className="border-t border-gray-700 pt-2">
              <div className="text-gray-300 font-semibold mb-1">Network</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-400">RTT:</span>
                  <span className="ml-1 text-white">
                    {stats.rtt.toFixed(1)}ms
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Bitrate:</span>
                  <span className="ml-1 text-white">
                    {formatBitrate(stats.bitrate)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Tiles/sec:</span>
                  <span className="ml-1 text-white">
                    {stats.tilesPerSecond}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">Dropped:</span>
                  <span className={`ml-1 ${stats.droppedTiles > 0 ? 'text-red-400' : 'text-white'}`}>
                    {stats.droppedTiles}
                  </span>
                </div>
              </div>
            </div>

            {/* Server Stats (if available) */}
            {(stats.cacheHitRatio !== undefined || stats.memoryUsage !== undefined) && (
              <div className="border-t border-gray-700 pt-2">
                <div className="text-gray-300 font-semibold mb-1">Server</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {stats.cacheHitRatio !== undefined && (
                    <div>
                      <span className="text-gray-400">Cache Hit:</span>
                      <span className="ml-1 text-white">
                        {(stats.cacheHitRatio * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {stats.memoryUsage !== undefined && (
                    <div>
                      <span className="text-gray-400">Memory:</span>
                      <span className="ml-1 text-white">
                        {formatBytes(stats.memoryUsage)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Update Counter (for debugging) */}
            <div className="border-t border-gray-700 pt-1 text-gray-500 text-xs">
              Updates: {updateCountRef.current}
            </div>
          </div>
        )}

        {/* Compact view */}
        {!isExpanded && (
          <div className="px-3 py-1 text-xs">
            <span className={quality.color}>
              {stats.rtt.toFixed(0)}ms • {formatBitrate(stats.bitrate)} • {stats.tilesPerSecond} t/s
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default HudComponent;