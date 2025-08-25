/**
 * RemoteView E2E Tests
 * 
 * Playwright tests that mock DataChannel or target dev server via SSH
 * and assert tiles render + HUD updates correctly.
 */

import { test, expect, Page } from '@playwright/test';
import { DataType, TileHeader } from '../../src/types';

// Mock data for testing
const mockTileHeader: TileHeader = {
  tileW: 256,
  tileH: 256,
  tileX: 0,
  tileY: 0,
  slice: 1,
  dtype: DataType.U8,
  timestamp: Date.now()
};

const mockTileData = new Uint8Array(256 * 256).fill(128); // Gray tile

class MockDataChannel {
  private page: Page;
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  async setupMockDataChannel(): Promise<void> {
    // Inject mock DataChannel into the page
    await this.page.addInitScript(() => {
      // Mock RTCDataChannel
      (window as any).mockDataChannel = {
        readyState: 'open',
        onmessage: null,
        send: (data: string | ArrayBuffer) => {
          console.log('[MockDataChannel] Sending:', data);
        },
        close: () => console.log('[MockDataChannel] Closed')
      };

      // Mock RTCPeerConnection
      (window as any).MockRTCPeerConnection = class {
        private dataChannel: any;

        constructor() {
          this.dataChannel = (window as any).mockDataChannel;
        }

        createDataChannel(label: string) {
          return this.dataChannel;
        }

        async getStats() {
          return new Map([
            ['transport', {
              type: 'transport',
              bytesReceived: 1024 * 100,
              currentRoundTripTime: 0.05,
              availableIncomingBitrate: 1000000
            }],
            ['data-channel', {
              type: 'data-channel',
              messagesReceived: 50,
              bytesReceived: 1024 * 50
            }]
          ]);
        }

        setLocalDescription() { return Promise.resolve(); }
        setRemoteDescription() { return Promise.resolve(); }
        createOffer() { return Promise.resolve({ type: 'offer', sdp: 'mock-sdp' }); }
        createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'mock-sdp' }); }
        addIceCandidate() { return Promise.resolve(); }
      };

      // Replace native RTCPeerConnection with mock
      (window as any).RTCPeerConnection = (window as any).MockRTCPeerConnection;
    });
  }

  async sendTileData(header: TileHeader, payload: Uint8Array): Promise<void> {
    // Create binary message matching the protocol
    const headerSize = 32; // Assuming 32-byte header
    const totalSize = headerSize + payload.length;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // Pack header (simplified version)
    view.setUint32(0, header.tileW, true);
    view.setUint32(4, header.tileH, true);
    view.setUint32(8, header.tileX, true);
    view.setUint32(12, header.tileY, true);
    view.setUint32(16, header.slice, true);
    view.setUint8(20, header.dtype);
    view.setBigUint64(24, BigInt(header.timestamp), true);

    // Copy payload
    const payloadView = new Uint8Array(buffer, headerSize);
    payloadView.set(payload);

    // Send via mock data channel
    await this.page.evaluate((bufferData) => {
      const dataChannel = (window as any).mockDataChannel;
      if (dataChannel && dataChannel.onmessage) {
        const event = new MessageEvent('message', {
          data: bufferData
        });
        dataChannel.onmessage(event);
      }
    }, buffer);
  }
}

test.describe('RemoteView E2E Tests', () => {
  let mockDataChannel: MockDataChannel;

  test.beforeEach(async ({ page }) => {
    mockDataChannel = new MockDataChannel(page);
    await mockDataChannel.setupMockDataChannel();
    
    // Navigate to the app (adjust URL as needed)
    await page.goto('/');
    
    // Wait for app initialization
    await page.waitForSelector('[data-testid="remoteview-canvas"]', { timeout: 10000 });
  });

  test('renders canvas and initializes renderer', async ({ page }) => {
    // Check that canvas is present
    const canvas = page.locator('[data-testid="remoteview-canvas"]');
    await expect(canvas).toBeVisible();

    // Check canvas dimensions
    const canvasElement = await canvas.elementHandle();
    const boundingBox = await canvasElement?.boundingBox();
    expect(boundingBox?.width).toBeGreaterThan(0);
    expect(boundingBox?.height).toBeGreaterThan(0);

    // Check for renderer initialization log
    const logs = await page.evaluate(() => {
      return (window as any).testLogs || [];
    });
    expect(logs.some((log: string) => log.includes('Renderer') && log.includes('initialized'))).toBe(true);
  });

  test('displays HUD with stats', async ({ page }) => {
    // Wait for HUD to appear
    const hud = page.locator('[data-testid="remoteview-hud"]');
    await expect(hud).toBeVisible({ timeout: 5000 });

    // Check HUD header
    await expect(hud.locator('text=RemoteView HUD')).toBeVisible();

    // Check connection indicator
    const connectionIndicator = hud.locator('[data-testid="connection-indicator"]');
    await expect(connectionIndicator).toBeVisible();

    // Check stats display
    await expect(hud.locator('text=RTT:')).toBeVisible();
    await expect(hud.locator('text=Bitrate:')).toBeVisible();
    await expect(hud.locator('text=Tiles/sec:')).toBeVisible();
  });

  test('processes tile data and renders', async ({ page }) => {
    // Send mock tile data
    await mockDataChannel.sendTileData(mockTileHeader, mockTileData);

    // Wait for tile processing
    await page.waitForTimeout(100);

    // Check that tile was processed
    const tileCount = await page.evaluate(() => {
      return (window as any).processedTileCount || 0;
    });
    expect(tileCount).toBeGreaterThan(0);

    // Check canvas was updated (by checking if draw calls occurred)
    const drawCalls = await page.evaluate(() => {
      return (window as any).canvasDrawCalls || 0;
    });
    expect(drawCalls).toBeGreaterThan(0);
  });

  test('updates HUD stats over time', async ({ page }) => {
    const hud = page.locator('[data-testid="remoteview-hud"]');
    await expect(hud).toBeVisible();

    // Get initial RTT value
    const initialRtt = await hud.locator('[data-testid="rtt-value"]').textContent();

    // Send multiple tiles to trigger stats updates
    for (let i = 0; i < 5; i++) {
      await mockDataChannel.sendTileData({
        ...mockTileHeader,
        tileX: i * 256,
        timestamp: Date.now() + i * 100
      }, mockTileData);
      await page.waitForTimeout(50);
    }

    // Wait for stats to update
    await page.waitForTimeout(1000);

    // Check that tiles/sec counter updated
    const tilesPerSec = await hud.locator('[data-testid="tiles-per-sec"]').textContent();
    expect(parseInt(tilesPerSec || '0')).toBeGreaterThan(0);

    // Check that update counter increased
    const updateCount = await hud.locator('text=/Updates: \\d+/').textContent();
    expect(updateCount).toMatch(/Updates: [1-9]\d*/);
  });

  test('handles renderer fallback gracefully', async ({ page }) => {
    // Disable WebGPU and WebGL2 to force CPU fallback
    await page.addInitScript(() => {
      (window as any).navigator.gpu = undefined;
      HTMLCanvasElement.prototype.getContext = function(type: string) {
        if (type === 'webgl2' || type === 'webgpu') return null;
        return CanvasRenderingContext2D.prototype;
      };
    });

    await page.reload();
    await page.waitForSelector('[data-testid="remoteview-canvas"]');

    // Check that CPU renderer was selected
    const rendererTier = await page.evaluate(() => {
      return (window as any).currentRendererTier;
    });
    expect(rendererTier).toBe('CPU');

    // Verify HUD shows CPU renderer
    const hud = page.locator('[data-testid="remoteview-hud"]');
    await expect(hud.locator('text=CPU')).toBeVisible();
  });

  test('handles protocol parsing errors', async ({ page }) => {
    // Send malformed tile data
    const malformedData = new ArrayBuffer(16); // Too small
    await page.evaluate((bufferData) => {
      const dataChannel = (window as any).mockDataChannel;
      if (dataChannel && dataChannel.onmessage) {
        const event = new MessageEvent('message', { data: bufferData });
        dataChannel.onmessage(event);
      }
    }, malformedData);

    // Check error handling
    const errorLogs = await page.evaluate(() => {
      return (window as any).protocolErrors || [];
    });
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0]).toContain('Invalid header size');
  });

  test('responds to quality degradation', async ({ page }) => {
    // Simulate poor performance conditions
    await page.evaluate(() => {
      // Mock performance issues
      (window as any).simulatePerformanceIssues = true;
      if ((window as any).adaptiveQuality) {
        (window as any).adaptiveQuality.updateMetrics({
          fps: 10,
          avgFrameTime: 100,
          droppedFrames: 20,
          uploadLatency: 500
        });
      }
    });

    // Wait for quality adaptation
    await page.waitForTimeout(2000);

    // Check that quality was degraded
    const qualitySettings = await page.evaluate(() => {
      return (window as any).currentQualitySettings;
    });
    expect(qualitySettings.dtype).not.toBe('f32'); // Should have downgraded from F32
  });

  test('debounces slider interactions', async ({ page }) => {
    const slider = page.locator('[data-testid="slice-slider"]');
    await expect(slider).toBeVisible();

    // Rapid slider movements
    const startTime = Date.now();
    for (let i = 0; i < 10; i++) {
      await slider.fill((i * 10).toString());
      await page.waitForTimeout(10);
    }

    // Check that messages were debounced
    const messageCount = await page.evaluate(() => {
      return (window as any).sliderMessageCount || 0;
    });
    
    // Should be fewer messages than slider movements due to debouncing
    expect(messageCount).toBeLessThan(10);
    expect(messageCount).toBeGreaterThan(0);
  });

  test('handles connection quality changes', async ({ page }) => {
    const hud = page.locator('[data-testid="remoteview-hud"]');
    await expect(hud).toBeVisible();

    // Simulate good connection
    await page.evaluate(() => {
      if ((window as any).statsCollector) {
        (window as any).statsCollector.simulateStats({
          rtt: 20,
          bitrate: 2000000,
          tilesPerSecond: 30
        });
      }
    });

    await page.waitForTimeout(500);
    
    // Check good connection indicator
    const goodIndicator = hud.locator('[data-testid="connection-indicator"].bg-green-400');
    await expect(goodIndicator).toBeVisible();

    // Simulate poor connection
    await page.evaluate(() => {
      if ((window as any).statsCollector) {
        (window as any).statsCollector.simulateStats({
          rtt: 300,
          bitrate: 50000,
          tilesPerSecond: 5
        });
      }
    });

    await page.waitForTimeout(500);

    // Check poor connection indicator
    const poorIndicator = hud.locator('[data-testid="connection-indicator"].bg-red-400');
    await expect(poorIndicator).toBeVisible();
  });
});

// SSH-based testing (requires dev server)
test.describe('RemoteView SSH E2E Tests', () => {
  test.skip('connects to real server via SSH tunnel', async ({ page }) => {
    // This test would connect to actual dev server via SSH
    // Requires SSH tunnel: ssh -L 8081:localhost:8081 rocky@10.7.4.116
    
    await page.goto('http://localhost:8081');
    
    // Wait for real WebRTC connection
    await page.waitForSelector('[data-testid="connection-status"][data-connected="true"]', {
      timeout: 30000
    });

    // Test real tile rendering
    await page.waitForTimeout(5000);
    
    const tileCount = await page.evaluate(() => {
      return (window as any).renderedTileCount || 0;
    });
    expect(tileCount).toBeGreaterThan(0);

    // Test HUD with real stats
    const hud = page.locator('[data-testid="remoteview-hud"]');
    const rttText = await hud.locator('[data-testid="rtt-value"]').textContent();
    expect(parseFloat(rttText || '0')).toBeGreaterThan(0);
  });
});