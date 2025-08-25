/**
 * RemoteView Network Manager
 * 
 * Handles WebRTC DataChannel communication with the RemoteView server,
 * including connection management, message parsing, and statistics collection.
 */

import { TileFrameParser } from '../protocol/parseTileFrame';
import { StatsCollector } from '../hud/StatsCollector';
import type { TileData, HudStats } from '../types';

interface NetworkConfig {
  iceServers?: RTCIceServer[];
  dataChannelOptions?: RTCDataChannelInit;
}

type ConnectionStatusCallback = (status: 'disconnected' | 'connecting' | 'connected') => void;
type StatsCallback = (stats: HudStats) => void;
type TileCallback = (tile: TileData) => void;

export class NetworkManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private websocket: WebSocket | null = null;
  private parser: TileFrameParser;
  private statsCollector: StatsCollector | null = null;
  
  // Callbacks
  public onConnectionStatusChange: ConnectionStatusCallback | null = null;
  public onStatsUpdate: StatsCallback | null = null;
  public onTileReceived: TileCallback | null = null;

  private config: NetworkConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ],
    dataChannelOptions: {
      ordered: false,
      maxRetransmits: 0
    }
  };

  constructor(config?: Partial<NetworkConfig>) {
    this.config = { ...this.config, ...config };
    this.parser = new TileFrameParser();
  }

  async connect(websocketUrl: string): Promise<void> {
    try {
      this.onConnectionStatusChange?.('connecting');
      
      // Establish WebSocket for signaling
      await this.connectWebSocket(websocketUrl);
      
      // Set up WebRTC peer connection
      await this.setupPeerConnection();
      
      this.onConnectionStatusChange?.('connected');
      console.log('[NetworkManager] Connected successfully');
      
    } catch (error) {
      console.error('[NetworkManager] Connection failed:', error);
      this.onConnectionStatusChange?.('disconnected');
      throw error;
    }
  }

  private async connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(url);
      this.websocket.binaryType = 'blob'; // Ensure binary data comes as Blob
      
      this.websocket.onopen = () => {
        console.log('[NetworkManager] ✅ WebSocket connected successfully to:', url);
        resolve();
      };
      
      this.websocket.onerror = (error) => {
        console.error('[NetworkManager] ❌ WebSocket error:', error);
        reject(error);
      };
      
      this.websocket.onclose = (event) => {
        console.log('[NetworkManager] 🔌 WebSocket closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
      };
      
      this.websocket.onmessage = async (event) => {
        try {
          console.log('[NetworkManager] 📨 WEBSOCKET MESSAGE RECEIVED:', {
            dataType: typeof event.data,
            dataConstructor: event.data.constructor.name,
            isBlob: event.data instanceof Blob,
            isArrayBuffer: event.data instanceof ArrayBuffer,
            isString: typeof event.data === 'string',
            size: event.data.size || event.data.byteLength || event.data.length
          });
          
          // Check if this is binary tile data or JSON control message
          if (event.data instanceof Blob) {
            // Binary tile data
            console.log('[NetworkManager] Received binary tile data:', event.data.size, 'bytes');
            await this.handleBinaryTileData(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            // Handle ArrayBuffer binary data
            console.log('[NetworkManager] Received binary ArrayBuffer data:', event.data.byteLength, 'bytes');
            const blob = new Blob([event.data]);
            await this.handleBinaryTileData(blob);
          } else {
            // JSON control message
            const message = JSON.parse(event.data);
            await this.handleSignalingMessage(message);
          }
        } catch (error) {
          console.error('[NetworkManager] Failed to handle message:', error);
        }
      };
    });
  }

  private async setupPeerConnection(): Promise<void> {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers
    });

    // Create data channel
    this.dataChannel = this.peerConnection.createDataChannel('tiles', this.config.dataChannelOptions);
    
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.onopen = () => {
      console.log('[NetworkManager] DataChannel opened');
      this.startStatsCollection();
    };
    
    this.dataChannel.onclose = () => {
      console.log('[NetworkManager] DataChannel closed');
      this.onConnectionStatusChange?.('disconnected');
    };
    
    this.dataChannel.onerror = (error) => {
      console.error('[NetworkManager] DataChannel error:', error);
    };
    
    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event);
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.websocket?.readyState === WebSocket.OPEN) {
        this.websocket.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate
        }));
      }
    };

    // Create offer and set local description
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    // Send offer via WebSocket
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'offer',
        sdp: offer
      }));
    }
  }

  private async handleSignalingMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'handshake':
        console.log('[NetworkManager] Received server handshake:', message);
        // Server handshake received, WebRTC negotiation will begin
        break;
        
      case 'answer':
        if (this.peerConnection) {
          await this.peerConnection.setRemoteDescription(message.sdp);
        }
        break;
        
      case 'websocket_fallback':
        console.log('[NetworkManager] Server using WebSocket fallback:', message.message);
        // Server will use WebSocket for control messages instead of DataChannel
        break;
        
      case 'ice-candidate':
        if (this.peerConnection) {
          await this.peerConnection.addIceCandidate(message.candidate);
        }
        break;
        
      case 'slice_update_ack':
        console.log('[NetworkManager] Slice update acknowledged:', message);
        break;
        
      case 'view_update_ack':
        console.log('[NetworkManager] View update acknowledged:', message);
        break;
        
      case 'lut_update_ack':
        console.log('[NetworkManager] LUT update acknowledged:', message);
        break;
        
      default:
        console.log('[NetworkManager] Unknown signaling message:', message);
    }
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) {
      // Handle JSON control messages
      try {
        const message = JSON.parse(event.data);
        this.handleControlMessage(message);
      } catch (error) {
        console.error('[NetworkManager] Failed to parse control message:', error);
      }
      return;
    }

    // Handle binary tile data
    try {
      const result = this.parser.parse(event.data);
      
      if (result.success && result.data) {
        this.onTileReceived?.(result.data);
      } else {
        console.warn('[NetworkManager] Failed to parse tile:', result.error);
      }
    } catch (error) {
      console.error('[NetworkManager] Error processing binary message:', error);
    }
  }

  private handleControlMessage(message: any): void {
    switch (message.t || message.type) {
      case 'pong':
        // Handle ping response
        break;
        
      case 'server_metrics':
        // Update HUD with server metrics
        if (this.onStatsUpdate && this.statsCollector) {
          // Get current stats and merge with server metrics
          this.onStatsUpdate({
            rtt: 0, // Will be filled by stats collector
            bitrate: 0,
            tilesPerSecond: message.tiles_per_second || 0,
            droppedTiles: 0,
            rendererTier: 'webgl2' as any,
            cacheHitRatio: message.cache_hit_ratio,
            memoryUsage: message.memory_usage
          });
        }
        break;
        
      default:
        console.log('[NetworkManager] Unknown control message:', message);
    }
  }

  private startStatsCollection(): void {
    if (!this.peerConnection) return;
    
    this.statsCollector = new StatsCollector();
    this.statsCollector.setPeerConnection(this.peerConnection);
    this.statsCollector.onStatsUpdate((stats) => {
      this.onStatsUpdate?.(stats);
    });
    
    this.statsCollector.startPolling();
  }

  // Message sending methods
  sendSetSlice(inline: number, crossline: number, timeDepth: number): void {
    this.sendControlMessage({
      t: 'set_slice',
      inline,
      xline: crossline,
      z: timeDepth
    });
  }

  sendSetView(plane: string, index: number, isDragging: boolean = false): void {
    this.sendControlMessage({
      t: 'set_view',
      plane,
      index,
      drag: isDragging
    });
  }

  sendSetLut(name: string, clipPct: number, gain: number, agcWindow: number): void {
    this.sendControlMessage({
      t: 'set_lut',
      name,
      clipPct,
      gain,
      agcWindow
    });
  }

  sendQualityPreference(dtype: string, downsample: number): void {
    this.sendControlMessage({
      t: 'quality',
      prefer: { dtype, downsample }
    });
  }

  sendPing(id: number = Date.now()): void {
    this.sendControlMessage({
      t: 'ping',
      id
    });
  }

  private sendControlMessage(message: any): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    } else if (this.websocket?.readyState === WebSocket.OPEN) {
      // Fall back to WebSocket for control messages when DataChannel is not available
      console.log('[NetworkManager] Sending control message via WebSocket (DataChannel not open)');
      this.websocket.send(JSON.stringify(message));
    } else {
      console.warn('[NetworkManager] Cannot send message: Neither DataChannel nor WebSocket is open');
    }
  }

  private async handleBinaryTileData(blob: Blob): Promise<void> {
    try {
      console.log('[NetworkManager] 📦 INCOMING BINARY TILE:', {
        blobSize: blob.size,
        blobType: blob.type,
        timestamp: new Date().toISOString()
      });
      
      // Convert blob to ArrayBuffer for protocol parsing
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      console.log('[NetworkManager] 🔍 BINARY DATA ANALYSIS:', {
        totalBytes: uint8Array.length,
        firstBytes: Array.from(uint8Array.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
        expectedMinSize: 24 + 131072, // 24-byte header + 256x256x2 bytes
        isValidSize: uint8Array.length >= 24
      });
      
      // Parse TileMessage protocol (24-byte header + payload)
      if (uint8Array.length >= 24) {
        const header = uint8Array.slice(0, 24);
        const payload = uint8Array.slice(24);
        
        console.log('[NetworkManager] 📋 PARSING 24-BYTE HEADER:', {
          headerBytes: Array.from(header).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
          payloadSize: payload.length
        });
        
        // Parse the 24-byte header (simplified for now)
        const dataView = new DataView(header.buffer, header.byteOffset, 24);
        const protocolVersion = dataView.getUint8(0);
        const plane = dataView.getUint8(1);
        const tileW = dataView.getUint16(2, true); // little-endian
        const tileH = dataView.getUint16(4, true);
        const tileX = dataView.getUint32(6, true);
        const tileY = dataView.getUint32(10, true);
        const sliceIndex = dataView.getUint32(14, true);
        
        // Analyze payload seismic data
        const expectedPayloadSize = tileW * tileH * 2; // 16-bit samples
        const actualPayloadSize = payload.length;
        let firstSeismicSamples = [];
        
        // Convert first few 16-bit samples for analysis
        for (let i = 0; i < Math.min(10, payload.length / 2); i++) {
          const byte1 = payload[i * 2];
          const byte2 = payload[i * 2 + 1];
          const sample16 = byte1 | (byte2 << 8);
          const signedSample = sample16 > 32767 ? sample16 - 65536 : sample16;
          firstSeismicSamples.push(signedSample);
        }
        
        // Count non-zero samples
        let nonZeroCount = 0;
        for (let i = 0; i < payload.length; i += 2) {
          if (i + 1 < payload.length) {
            const sample = payload[i] | (payload[i + 1] << 8);
            if (sample !== 0) nonZeroCount++;
          }
        }
        
        console.log('[NetworkManager] 🎯 TILE PARSING RESULTS:', {
          header: {
            protocolVersion,
            plane,
            dimensions: [tileW, tileH],
            position: [tileX, tileY],
            sliceIndex
          },
          payload: {
            expectedSize: expectedPayloadSize,
            actualSize: actualPayloadSize,
            sizeMatch: expectedPayloadSize === actualPayloadSize,
            nonZeroSamples: nonZeroCount,
            totalSamples: Math.floor(payload.length / 2),
            dataIntegrity: nonZeroCount > 0 ? 'HAS_DATA' : 'ALL_ZEROS'
          },
          seismicData: {
            firstSamples: firstSeismicSamples,
            firstBytes: Array.from(payload.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
          }
        });
        
        // Create a simple tile object for rendering
        const tileData = {
          plane,
          sliceIndex,
          x: tileX,
          y: tileY,
          width: tileW,
          height: tileH,
          data: payload
        };
        
        console.log('[NetworkManager] 🚀 DISPATCHING VDS-TILE-RECEIVED EVENT:', {
          plane: tileData.plane,
          slice: tileData.sliceIndex,
          dimensions: [tileData.width, tileData.height],
          position: [tileData.x, tileData.y],
          dataSize: tileData.data.length
        });
        
        // Trigger a custom event with the real VDS tile data
        // This allows other components to listen for tiles
        const tileEvent = new CustomEvent('vds-tile-received', { 
          detail: tileData 
        });
        window.dispatchEvent(tileEvent);
        
        console.log('[NetworkManager] ✅ TILE PROCESSING COMPLETE - Event dispatched to window!');
        
      } else {
        console.error('[NetworkManager] ❌ INVALID BINARY DATA:', {
          receivedBytes: uint8Array.length,
          minimumRequired: 24,
          shortfall: 24 - uint8Array.length
        });
      }
      
    } catch (error) {
      console.error('[NetworkManager] 💥 EXCEPTION processing binary tile data:', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  disconnect(): void {
    this.onConnectionStatusChange?.('disconnected');
    
    this.statsCollector?.stopPolling();
    this.statsCollector = null;
    
    this.dataChannel?.close();
    this.dataChannel = null;
    
    this.peerConnection?.close();
    this.peerConnection = null;
    
    this.websocket?.close();
    this.websocket = null;
    
    console.log('[NetworkManager] Disconnected');
  }

  isConnected(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  getConnectionState(): RTCPeerConnectionState | 'disconnected' {
    return this.peerConnection?.connectionState || 'disconnected';
  }
}