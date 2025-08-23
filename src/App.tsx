import React, { useState, useEffect, useCallback } from 'react';
import type { ViewState, HudStats, RendererTier, ClientCapabilities } from '@/types';
import { RendererManager } from '@/renderer/RendererManager';
import { NetworkManager } from '@/net/NetworkManager';
import { ControlPanel } from '@/controls/ControlPanel';
import { HudOverlay } from '@/hud/HudOverlay';

const DEFAULT_VIEW_STATE: ViewState = {
  currentPlane: 0, // Inline
  sliceIndices: {
    inline: 1200,
    crossline: 900,
    timeDepth: 800
  },
  lut: 'SeismicRWB',
  clipPercent: 98,
  gain: 1.0,
  agcWindow: 0,
  isDragging: false,
  preferredQuality: {
    dtype: 1, // U16
    downsample: 1
  }
};

function App() {
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [hudStats, setHudStats] = useState<HudStats>({
    rtt: 0,
    tilesPerSecond: 0,
    droppedTiles: 0,
    bitrate: 0,
    rendererTier: 'webgl2' as RendererTier
  });
  const [rendererManager, setRendererManager] = useState<RendererManager | null>(null);
  const [networkManager, setNetworkManager] = useState<NetworkManager | null>(null);

  // Initialize renderer and network managers
  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('Initializing RemoteView client...');
        
        // Initialize renderer
        const renderer = new RendererManager();
        const capabilities = await renderer.initialize();
        setRendererManager(renderer);
        
        // Initialize network manager
        const network = new NetworkManager();
        network.onConnectionStatusChange = setConnectionStatus;
        network.onStatsUpdate = setHudStats;
        network.onTileReceived = (tileData) => {
          renderer.processTile(tileData);
        };
        
        setNetworkManager(network);
        
        // Send hello message with client capabilities
        const clientCaps: ClientCapabilities = {
          webgpu: capabilities.tier === 'webgpu',
          webgl2: capabilities.tier === 'webgl2' || capabilities.tier === 'webgpu',
          maxTexture: capabilities.maxTextureSize
        };
        
        console.log('Client initialized with capabilities:', clientCaps);
        
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    };

    initializeApp();

    // Cleanup on unmount
    return () => {
      rendererManager?.destroy();
      networkManager?.disconnect();
    };
  }, []);

  // Connect to server
  const handleConnect = useCallback(async () => {
    if (!networkManager) return;
    
    try {
      setConnectionStatus('connecting');
      await networkManager.connect('ws://localhost:8443/ws');
      
      // Send initial view state
      networkManager.sendSetSlice(
        viewState.sliceIndices.inline,
        viewState.sliceIndices.crossline,
        viewState.sliceIndices.timeDepth
      );
      
    } catch (error) {
      console.error('Failed to connect:', error);
      setConnectionStatus('disconnected');
    }
  }, [networkManager, viewState.sliceIndices]);

  // Handle view state changes
  const handleViewStateChange = useCallback((updates: Partial<ViewState>) => {
    setViewState(prev => {
      const newState = { ...prev, ...updates };
      
      // Send updates to server
      if (networkManager) {
        if (updates.sliceIndices) {
          networkManager.sendSetSlice(
            newState.sliceIndices.inline,
            newState.sliceIndices.crossline,
            newState.sliceIndices.timeDepth
          );
        }
        
        if (updates.lut || updates.clipPercent !== undefined || 
            updates.gain !== undefined || updates.agcWindow !== undefined) {
          networkManager.sendSetLut(
            newState.lut,
            newState.clipPercent,
            newState.gain,
            newState.agcWindow
          );
        }
        
        if (updates.currentPlane !== undefined) {
          const planeNames = ['inline', 'xline', 'z'] as const;
          networkManager.sendSetView(
            planeNames[newState.currentPlane],
            newState.sliceIndices[planeNames[newState.currentPlane] as keyof ViewState['sliceIndices']],
            newState.isDragging
          );
        }
      }
      
      return newState;
    });
  }, [networkManager]);

  return (
    <div className="viewer-container">
      {/* Main viewer canvas */}
      <div className="viewer-canvas-container">
        <canvas 
          id="remoteview-canvas"
          className="viewer-canvas"
          onMouseDown={() => handleViewStateChange({ isDragging: true })}
          onMouseUp={() => handleViewStateChange({ isDragging: false })}
        />
        
        {/* HUD overlay */}
        <HudOverlay 
          stats={hudStats}
          connectionStatus={connectionStatus}
        />
      </div>

      {/* Control panel */}
      <div className="controls-panel">
        <ControlPanel
          viewState={viewState}
          onViewStateChange={handleViewStateChange}
          connectionStatus={connectionStatus}
          onConnect={handleConnect}
          onDisconnect={() => networkManager?.disconnect()}
        />
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <span className={`status-${connectionStatus}`}>
          {connectionStatus === 'connected' && '● Connected'}
          {connectionStatus === 'connecting' && '● Connecting...'}
          {connectionStatus === 'disconnected' && '● Disconnected'}
        </span>
        
        {connectionStatus === 'connected' && (
          <>
            <span style={{ marginLeft: '20px' }}>
              RTT: {hudStats.rtt.toFixed(0)}ms
            </span>
            <span style={{ marginLeft: '20px' }}>
              Tiles/s: {hudStats.tilesPerSecond.toFixed(1)}
            </span>
            <span style={{ marginLeft: '20px' }}>
              {(hudStats.bitrate / 1024 / 1024).toFixed(1)} Mbps
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default App;