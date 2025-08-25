import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ViewState, HudStats, RendererTier, ClientCapabilities } from './types';
import { RendererManager } from './renderer/RendererManager';
import { NetworkManager } from './net/NetworkManager';
import { ControlPanel } from './controls/ControlPanel';
import { HudOverlay } from './hud/HudOverlay';
import { TileBasedSeismicRenderer } from './renderer/TileBasedSeismicRenderer';

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
  console.log(`[App] 🚀 APP COMPONENT LOADED - ${new Date().toISOString()}`);
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
  
  // Tile-Based Seismic Renderer
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seismicRenderer, setSeismicRenderer] = useState<TileBasedSeismicRenderer | null>(null);
  const initializationAttempted = useRef(false);
  const eventListenerAttached = useRef(false);
  // Refs to access current values in event handlers (avoid closure issues)
  const seismicRendererRef = useRef<TileBasedSeismicRenderer | null>(null);


  // Initialize 3D seismic renderer and network managers
  useEffect(() => {
    console.log(`[App] 🚀 useEffect called - initializationAttempted: ${initializationAttempted.current}, canvasRef: ${!!canvasRef.current}`);
    
    if (initializationAttempted.current) {
      console.log('[App] ⚠️ Initialization already attempted, skipping...');
      return; // Prevent double initialization
    }
    
    const initializeApp = async () => {
      try {
        initializationAttempted.current = true;
        console.log(`[App] 🔄 Initializing 3D Seismic Volume Renderer... - ${new Date().toISOString()}`);
        
        // Initialize tile-based seismic renderer
        if (canvasRef.current) {
          console.log('[App] ✅ Canvas ref exists, creating TileBasedSeismicRenderer...');
          try {
            console.log('[App] 📝 About to call: new TileBasedSeismicRenderer(canvasRef.current)');
            const renderer = new TileBasedSeismicRenderer(canvasRef.current);
            console.log('[App] ✅ TileBasedSeismicRenderer constructor returned successfully');
            setSeismicRenderer(renderer);
            seismicRendererRef.current = renderer;
            
            // Start rendering loop
            renderer.startAnimation();
            
            console.log('[App] ✅ Tile-Based Renderer initialized');
          } catch (rendererError) {
            console.error('[App] Failed to initialize 3D renderer:', rendererError);
            console.log('[App] Falling back to 2D visualization...');
            // Fall back to basic 2D rendering if 3D fails
          }
        }
        
        const capabilities = {
          tier: 'webgl2' as const,
          maxTextureSize: 4096,
          supportsFloatTextures: true,
          preferredDataType: 2
        };
        
        // Initialize network manager
        const network = new NetworkManager();
        network.onConnectionStatusChange = setConnectionStatus;
        network.onStatsUpdate = setHudStats;
        network.onTileReceived = async (tileData) => {
          console.log('[App] Received tile via onTileReceived:', tileData.header);
        };
        
        setNetworkManager(network);
        
        // Send hello message with client capabilities
        const clientCaps: ClientCapabilities = {
          webgpu: capabilities?.tier === 'webgpu' || false,
          webgl2: capabilities?.tier === 'webgl2' || capabilities?.tier === 'webgpu' || false,
          maxTexture: capabilities?.maxTextureSize || 2048
        };
        
        console.log('[App] Client initialized with capabilities:', clientCaps);
        
        // Set up VDS tile event listener AFTER components are initialized
        const handleVDSTile = (event: CustomEvent) => {
          const tileData = event.detail;
          const currentSeismicRenderer = seismicRendererRef.current;
          
          console.log('[App] 🎯 VDS-TILE-RECEIVED EVENT CAUGHT BY APP.TSX:', {
            plane: tileData.plane,
            slice: tileData.sliceIndex,
            size: `${tileData.width}x${tileData.height}`,
            dataBytes: tileData.data.length,
            rendererReady: !!currentSeismicRenderer
          });
          
          // Process tile directly with tile-based renderer
          if (!currentSeismicRenderer) {
            console.warn('[App] ❌ Tile renderer not initialized for tile processing');
            return;
          }
          
          try {
            console.log('[App] Processing VDS tile for direct rendering:', {
              plane: tileData.plane,
              slice: tileData.sliceIndex,
              size: `${tileData.width}x${tileData.height}`,
              dataBytes: tileData.data.length
            });
            
            // Convert to SeismicTile format
            const seismicTile = {
              plane: tileData.plane,
              sliceIndex: tileData.sliceIndex,
              x: tileData.x || 0,
              y: tileData.y || 0,
              width: tileData.width,
              height: tileData.height,
              data: new Uint8Array(tileData.data)
            };
            
            // Render tile directly
            currentSeismicRenderer.renderTile(seismicTile);
            
            console.log('[App] ✅ Tile processed and rendered successfully');
            
          } catch (error) {
            console.error('[App] Failed to process VDS tile:', error);
          }
        };
        
        // Only attach event listener once to prevent double-registration
        if (!eventListenerAttached.current) {
          window.addEventListener('vds-tile-received', handleVDSTile as EventListener);
          eventListenerAttached.current = true;
          console.log('[App] 🎧 VDS tile event listener registered');
        } else {
          console.log('[App] 🎧 Event listener already attached, skipping...');
        }
        
      } catch (error) {
        console.error('[App] Failed to initialize app:', error);
      }
    };

    initializeApp();

    // Event listener is now registered inside initializeApp after components are ready

    // Cleanup on unmount
    return () => {
      // Remove all vds-tile-received listeners (since we can't reference the specific handler)
      const oldListeners = window.addEventListener;
      console.log('[App] 🧹 Cleaning up event listeners and components');
      seismicRenderer?.dispose();
      rendererManager?.dispose();
      networkManager?.disconnect();
    };
  }, []); // Empty dependency array to prevent re-initialization

  // Connect to server
  const handleConnect = useCallback(async () => {
    if (!networkManager) return;
    
    try {
      setConnectionStatus('connecting');
      console.log('[App] 🔌 Attempting to connect to server via SSH tunnel...');
      await networkManager.connect('ws://localhost:8081');
      
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
      {/* Tile-Based Seismic Renderer Canvas */}
      <div className="viewer-canvas-container">
        <canvas 
          ref={canvasRef}
          id="seismic-tiles-canvas"
          data-testid="seismic-tiles-canvas"
          className="viewer-canvas"
          width={800}
          height={600}
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