/**
 * Playwright Global Teardown
 * 
 * Cleans up test environment after RemoteView E2E tests complete.
 */

import { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig) {
  console.log('[E2E Teardown] Cleaning up RemoteView test environment...');

  // Clean up test data
  await cleanupTestData();

  // Clean up any background processes
  await cleanupProcesses();

  console.log('[E2E Teardown] Cleanup complete');
}

async function cleanupTestData() {
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    // Remove test data directory if it exists
    const testDataDir = './test-data';
    await fs.rm(testDataDir, { recursive: true, force: true });
    console.log('[E2E Teardown] Removed test data directory');
  } catch (error) {
    console.warn('[E2E Teardown] Failed to clean up test data:', error);
  }
}

async function cleanupProcesses() {
  // Kill any lingering mock server processes
  const { spawn } = await import('child_process');
  
  return new Promise<void>((resolve) => {
    const cleanup = spawn('pkill', ['-f', 'mock-server']);
    
    cleanup.on('close', (code) => {
      if (code === 0) {
        console.log('[E2E Teardown] Stopped mock server processes');
      }
      resolve();
    });

    cleanup.on('error', () => {
      // Ignore errors - processes might not exist
      resolve();
    });

    // Force resolve after 5 seconds
    setTimeout(resolve, 5000);
  });
}

export default globalTeardown;