/**
 * Playwright Global Setup
 * 
 * Sets up test environment for RemoteView E2E tests including
 * SSH tunnel configuration for dev server testing.
 */

import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('[E2E Setup] Starting RemoteView test environment...');

  // Set up test data directories
  const testDataDir = './test-data';
  const { mkdirSync, existsSync } = await import('fs');
  
  if (!existsSync(testDataDir)) {
    mkdirSync(testDataDir, { recursive: true });
  }

  // Create mock server data if needed
  await setupMockData();

  // Check SSH tunnel availability for dev server tests
  await checkSshTunnel();

  console.log('[E2E Setup] Environment ready for testing');
}

async function setupMockData() {
  const fs = await import('fs/promises');
  const path = await import('path');

  const mockDataPath = path.join('./test-data', 'mock-tiles.json');
  
  // Create sample tile data for testing
  const mockTiles = [
    {
      header: {
        tileW: 256,
        tileH: 256,
        tileX: 0,
        tileY: 0,
        slice: 1,
        dtype: 0, // U8
        timestamp: Date.now()
      },
      payload: Array.from({ length: 256 * 256 }, (_, i) => i % 256)
    },
    {
      header: {
        tileW: 256,
        tileH: 256,
        tileX: 256,
        tileY: 0,
        slice: 1,
        dtype: 0, // U8
        timestamp: Date.now()
      },
      payload: Array.from({ length: 256 * 256 }, (_, i) => (i * 2) % 256)
    }
  ];

  await fs.writeFile(mockDataPath, JSON.stringify(mockTiles, null, 2));
  console.log('[E2E Setup] Created mock tile data');
}

async function checkSshTunnel() {
  const { spawn } = await import('child_process');
  
  return new Promise<void>((resolve) => {
    // Check if SSH tunnel is available on port 8081
    const testConnection = spawn('curl', [
      '-s',
      '--connect-timeout', '2',
      'http://localhost:8081/health'
    ]);

    let sshAvailable = false;

    testConnection.on('close', (code) => {
      if (code === 0) {
        sshAvailable = true;
        console.log('[E2E Setup] SSH tunnel detected on port 8081 - enabling dev server tests');
      } else {
        console.log('[E2E Setup] No SSH tunnel detected - skipping dev server tests');
        console.log('[E2E Setup] To enable dev server tests, run: ssh -L 8081:localhost:8081 rocky@10.7.4.116');
      }

      // Set environment variable for conditional test execution
      process.env.SSH_TUNNEL_AVAILABLE = sshAvailable ? 'true' : 'false';
      resolve();
    });

    testConnection.on('error', () => {
      console.log('[E2E Setup] curl not available - assuming no SSH tunnel');
      process.env.SSH_TUNNEL_AVAILABLE = 'false';
      resolve();
    });
  });
}

export default globalSetup;