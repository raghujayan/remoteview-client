/**
 * RemoteView Decompression Worker Pool
 * 
 * Manages a pool of decompression workers to handle tile decompression
 * off the main thread. Implements queue back-pressure to prevent memory issues.
 */

import { CompressionType } from '../types';

interface DecompressionTask {
  id: number;
  data: Uint8Array;
  compression: CompressionType;
  uncompressedSize: number;
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

interface DecompressionStats {
  totalTasks: number;
  completedTasks: number;
  averageTimeMs: number;
  queueLength: number;
  activeWorkers: number;
  droppedTasks: number;
}

export class DecompressionPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private busyWorkers: Set<Worker> = new Set();
  private taskQueue: DecompressionTask[] = [];
  private pendingTasks: Map<number, DecompressionTask> = new Map();
  
  private nextTaskId = 1;
  private poolSize: number;
  private maxQueueSize: number;
  private stats: DecompressionStats = {
    totalTasks: 0,
    completedTasks: 0,
    averageTimeMs: 0,
    queueLength: 0,
    activeWorkers: 0,
    droppedTasks: 0
  };

  constructor(poolSize = 4, maxQueueSize = 50) {
    this.poolSize = Math.min(poolSize, navigator.hardwareConcurrency || 4);
    this.maxQueueSize = maxQueueSize;
    this.initializeWorkers();
  }

  private initializeWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(
        new URL('./decompressionWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      worker.onmessage = this.handleWorkerMessage.bind(this);
      worker.onerror = this.handleWorkerError.bind(this);
      
      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
    
    console.log(`[DecompressionPool] Initialized with ${this.poolSize} workers`);
  }

  private handleWorkerMessage(event: MessageEvent) {
    const worker = event.target as Worker;
    const response = event.data;
    
    // Find and complete the pending task
    const task = this.pendingTasks.get(response.id);
    if (!task) {
      console.warn('[DecompressionPool] Received response for unknown task:', response.id);
      return;
    }
    
    this.pendingTasks.delete(response.id);
    this.busyWorkers.delete(worker);
    this.availableWorkers.push(worker);
    
    // Update stats
    this.stats.completedTasks++;
    if (response.timing) {
      this.updateAverageTime(response.timing);
    }
    
    if (response.success) {
      task.resolve(response.data);
    } else {
      task.reject(new Error(response.error || 'Decompression failed'));
    }
    
    // Process next task in queue
    this.processNextTask();
  }

  private handleWorkerError(event: ErrorEvent) {
    const worker = event.target as Worker;
    console.error('[DecompressionPool] Worker error:', event);
    
    // Find tasks assigned to this worker and reject them
    for (const [taskId, task] of this.pendingTasks.entries()) {
      if (this.busyWorkers.has(worker)) {
        this.pendingTasks.delete(taskId);
        task.reject(new Error(`Worker error: ${event.message}`));
      }
    }
    
    this.busyWorkers.delete(worker);
    // Don't add back to available - worker is corrupted
  }

  private updateAverageTime(newTime: number) {
    const oldAvg = this.stats.averageTimeMs;
    const count = this.stats.completedTasks;
    this.stats.averageTimeMs = (oldAvg * (count - 1) + newTime) / count;
  }

  private processNextTask() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }
    
    const task = this.taskQueue.shift()!;
    const worker = this.availableWorkers.shift()!;
    
    this.busyWorkers.add(worker);
    this.pendingTasks.set(task.id, task);
    
    worker.postMessage({
      id: task.id,
      data: task.data,
      compression: task.compression,
      uncompressedSize: task.uncompressedSize
    });
    
    this.updateStats();
  }

  private updateStats() {
    this.stats.queueLength = this.taskQueue.length;
    this.stats.activeWorkers = this.busyWorkers.size;
  }

  async decompress(
    data: Uint8Array, 
    compression: CompressionType, 
    uncompressedSize: number
  ): Promise<Uint8Array> {
    // If no compression, return immediately
    if (compression === CompressionType.None) {
      return data;
    }

    // Check queue back-pressure
    if (this.taskQueue.length >= this.maxQueueSize) {
      // Drop oldest task to make room
      const droppedTask = this.taskQueue.shift();
      if (droppedTask) {
        droppedTask.reject(new Error('Task dropped due to queue back-pressure'));
        this.stats.droppedTasks++;
        console.warn('[DecompressionPool] Dropped task due to queue back-pressure');
      }
    }

    return new Promise((resolve, reject) => {
      const task: DecompressionTask = {
        id: this.nextTaskId++,
        data,
        compression,
        uncompressedSize,
        resolve,
        reject,
        timestamp: performance.now()
      };

      this.stats.totalTasks++;
      this.taskQueue.push(task);
      this.processNextTask();
    });
  }

  getStats(): DecompressionStats {
    this.updateStats();
    return { ...this.stats };
  }

  getQueuePressure(): number {
    return this.taskQueue.length / this.maxQueueSize;
  }

  shouldBackOff(): boolean {
    return this.getQueuePressure() > 0.8; // Back off at 80% queue capacity
  }

  async dispose() {
    // Reject all pending tasks
    for (const task of this.pendingTasks.values()) {
      task.reject(new Error('DecompressionPool disposed'));
    }
    for (const task of this.taskQueue) {
      task.reject(new Error('DecompressionPool disposed'));
    }
    
    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    this.workers.length = 0;
    this.availableWorkers.length = 0;
    this.busyWorkers.clear();
    this.taskQueue.length = 0;
    this.pendingTasks.clear();
    
    console.log('[DecompressionPool] Disposed');
  }
}

// Global singleton instance
let globalPool: DecompressionPool | null = null;

export function getDecompressionPool(): DecompressionPool {
  if (!globalPool) {
    globalPool = new DecompressionPool();
  }
  return globalPool;
}

export function disposeDecompressionPool() {
  if (globalPool) {
    globalPool.dispose();
    globalPool = null;
  }
}