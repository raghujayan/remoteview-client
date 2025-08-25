/**
 * RemoteView Adaptive Quality Controller
 * 
 * Monitors performance metrics and automatically adjusts quality settings
 * when uploads stutter or FPS drops. Sends quality messages requesting
 * lower data types and downsampling, then reverts on steady state.
 */

import { DataType } from '../types';

export interface QualitySettings {
  dtype: DataType;
  downsample: number;
  reason?: string;
}

export interface PerformanceMetrics {
  fps: number;
  avgFrameTime: number;
  droppedFrames: number;
  uploadLatency: number;
  bandwidthUtilization: number;
  memoryPressure: number;
}

interface QualityMessage {
  type: 'quality';
  dtype: string;
  downsample: number;
  timestamp: number;
}

type QualityCallback = (settings: QualitySettings) => void;

export class AdaptiveQualityController {
  private currentSettings: QualitySettings = {
    dtype: DataType.F32,
    downsample: 1
  };

  private baselineSettings: QualitySettings = {
    dtype: DataType.F32,
    downsample: 1
  };

  private metrics: PerformanceMetrics = {
    fps: 60,
    avgFrameTime: 16.67,
    droppedFrames: 0,
    uploadLatency: 0,
    bandwidthUtilization: 0,
    memoryPressure: 0
  };

  private callbacks: QualityCallback[] = [];
  private degradationLevel: number = 0; // 0 = full quality, 3 = max degradation
  private steadyStateFrames: number = 0;
  private isMonitoring: boolean = false;
  private monitoringInterval: number | null = null;

  // Thresholds for quality degradation
  private readonly thresholds = {
    fps: {
      good: 45,      // Above this = good performance
      fair: 25,      // Below this = start degradation
      poor: 15       // Below this = aggressive degradation
    },
    frameTime: {
      good: 22,      // Below this = good (< 22ms for 45fps)
      fair: 40,      // Above this = start degradation
      poor: 67       // Above this = aggressive degradation (15fps)
    },
    droppedFrames: {
      acceptable: 5,  // Per 100 frames
      concerning: 15,
      critical: 30
    },
    uploadLatency: {
      good: 50,      // Below this = good
      fair: 150,     // Above this = start degradation
      poor: 300      // Above this = aggressive degradation
    },
    steadyStateFrames: 60 // Frames to wait before reverting quality
  };

  // Quality degradation levels
  private readonly qualityLevels: QualitySettings[] = [
    { dtype: DataType.F32, downsample: 1, reason: 'Full quality' },
    { dtype: DataType.U16, downsample: 1, reason: 'Reduced precision' },
    { dtype: DataType.U8, downsample: 1, reason: 'Low precision' },
    { dtype: DataType.U8, downsample: 2, reason: 'Low precision + downsampling' }
  ];

  constructor(private sendMessage?: (message: QualityMessage) => void) {}

  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = window.setInterval(() => {
      this.evaluatePerformance();
    }, 1000); // Check every second

    console.log('[AdaptiveQuality] Started monitoring performance');
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.monitoringInterval !== null) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('[AdaptiveQuality] Stopped monitoring performance');
  }

  updateMetrics(newMetrics: Partial<PerformanceMetrics>): void {
    this.metrics = { ...this.metrics, ...newMetrics };
  }

  onQualityChange(callback: QualityCallback): void {
    this.callbacks.push(callback);
  }

  removeQualityCallback(callback: QualityCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  getCurrentSettings(): QualitySettings {
    return { ...this.currentSettings };
  }

  setBaselineSettings(settings: QualitySettings): void {
    this.baselineSettings = { ...settings };
    console.log('[AdaptiveQuality] Updated baseline settings:', settings);
  }

  private evaluatePerformance(): void {
    const performanceScore = this.calculatePerformanceScore();
    const targetDegradation = this.getTargetDegradation(performanceScore);

    if (targetDegradation > this.degradationLevel) {
      // Performance is poor, increase degradation
      this.applyDegradation(targetDegradation);
      this.steadyStateFrames = 0;
    } else if (targetDegradation < this.degradationLevel) {
      // Performance is improving, but wait for steady state
      this.steadyStateFrames++;
      
      if (this.steadyStateFrames >= this.thresholds.steadyStateFrames) {
        this.applyDegradation(targetDegradation);
        this.steadyStateFrames = 0;
      }
    } else {
      // Performance is stable at current level
      this.steadyStateFrames = Math.min(this.steadyStateFrames + 1, 10);
    }
  }

  private calculatePerformanceScore(): number {
    let score = 0;
    let factors = 0;

    // FPS score (0-3, higher is worse performance)
    if (this.metrics.fps < this.thresholds.fps.poor) {
      score += 3;
    } else if (this.metrics.fps < this.thresholds.fps.fair) {
      score += 2;
    } else if (this.metrics.fps < this.thresholds.fps.good) {
      score += 1;
    }
    factors++;

    // Frame time score
    if (this.metrics.avgFrameTime > this.thresholds.frameTime.poor) {
      score += 3;
    } else if (this.metrics.avgFrameTime > this.thresholds.frameTime.fair) {
      score += 2;
    } else if (this.metrics.avgFrameTime > this.thresholds.frameTime.good) {
      score += 1;
    }
    factors++;

    // Dropped frames score (per 100 frames)
    const droppedFramesRate = this.metrics.droppedFrames;
    if (droppedFramesRate > this.thresholds.droppedFrames.critical) {
      score += 3;
    } else if (droppedFramesRate > this.thresholds.droppedFrames.concerning) {
      score += 2;
    } else if (droppedFramesRate > this.thresholds.droppedFrames.acceptable) {
      score += 1;
    }
    factors++;

    // Upload latency score
    if (this.metrics.uploadLatency > this.thresholds.uploadLatency.poor) {
      score += 3;
    } else if (this.metrics.uploadLatency > this.thresholds.uploadLatency.fair) {
      score += 2;
    } else if (this.metrics.uploadLatency > this.thresholds.uploadLatency.good) {
      score += 1;
    }
    factors++;

    return factors > 0 ? score / factors : 0;
  }

  private getTargetDegradation(performanceScore: number): number {
    // Map performance score to degradation level
    if (performanceScore >= 2.5) return 3; // Max degradation
    if (performanceScore >= 1.5) return 2; // High degradation
    if (performanceScore >= 0.8) return 1; // Light degradation
    return 0; // Full quality
  }

  private applyDegradation(level: number): void {
    const clampedLevel = Math.max(0, Math.min(level, this.qualityLevels.length - 1));
    
    if (clampedLevel === this.degradationLevel) return;

    const previousLevel = this.degradationLevel;
    this.degradationLevel = clampedLevel;
    
    // Choose settings based on degradation level, falling back to baseline
    let newSettings: QualitySettings;
    if (clampedLevel === 0) {
      newSettings = { ...this.baselineSettings };
    } else {
      newSettings = { ...this.qualityLevels[clampedLevel] };
    }

    // Only update if settings actually changed
    if (this.settingsChanged(newSettings)) {
      const oldSettings = { ...this.currentSettings };
      this.currentSettings = newSettings;

      // Send quality message to server
      if (this.sendMessage) {
        const message: QualityMessage = {
          type: 'quality',
          dtype: this.getDataTypeString(newSettings.dtype),
          downsample: newSettings.downsample,
          timestamp: Date.now()
        };
        this.sendMessage(message);
      }

      // Notify callbacks
      this.callbacks.forEach(callback => callback(newSettings));

      console.log(
        `[AdaptiveQuality] Quality changed from level ${previousLevel} to ${clampedLevel}:`,
        `${this.getDataTypeString(oldSettings.dtype)}/${oldSettings.downsample}x`,
        '→',
        `${this.getDataTypeString(newSettings.dtype)}/${newSettings.downsample}x`,
        `(${newSettings.reason})`
      );
    }
  }

  private settingsChanged(newSettings: QualitySettings): boolean {
    return (
      this.currentSettings.dtype !== newSettings.dtype ||
      this.currentSettings.downsample !== newSettings.downsample
    );
  }

  private getDataTypeString(dtype: DataType): string {
    switch (dtype) {
      case DataType.U8: return 'u8';
      case DataType.U16: return 'u16';
      case DataType.F32: return 'f32';
      case DataType.MuLawU8: return 'mulaw';
      default: return 'unknown';
    }
  }

  // Manual quality control methods
  forceQuality(settings: QualitySettings): void {
    this.applyDegradation(0); // Reset to baseline
    this.currentSettings = { ...settings };
    this.baselineSettings = { ...settings };
    
    if (this.sendMessage) {
      const message: QualityMessage = {
        type: 'quality',
        dtype: this.getDataTypeString(settings.dtype),
        downsample: settings.downsample,
        timestamp: Date.now()
      };
      this.sendMessage(message);
    }

    this.callbacks.forEach(callback => callback(settings));
    console.log('[AdaptiveQuality] Forced quality settings:', settings);
  }

  resetToBaseline(): void {
    this.forceQuality(this.baselineSettings);
    this.degradationLevel = 0;
    this.steadyStateFrames = 0;
  }

  getPerformanceReport(): {
    currentMetrics: PerformanceMetrics;
    degradationLevel: number;
    currentSettings: QualitySettings;
    steadyStateFrames: number;
    isMonitoring: boolean;
  } {
    return {
      currentMetrics: { ...this.metrics },
      degradationLevel: this.degradationLevel,
      currentSettings: { ...this.currentSettings },
      steadyStateFrames: this.steadyStateFrames,
      isMonitoring: this.isMonitoring
    };
  }
}