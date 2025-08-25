/**
 * RemoteView Event Hygiene Controller
 * 
 * Provides debounced event handling for UI interactions, specifically:
 * - Debounce slider drags with light set_view messages (drag:true + motion vector)
 * - On release, send full-res set_slice message
 * - Prevents excessive network traffic during user interactions
 */

export interface ViewMessage {
  type: 'set_view';
  drag: boolean;
  motionVector?: { dx: number; dy: number };
  timestamp: number;
  // Optional view parameters
  zoom?: number;
  pan?: { x: number; y: number };
  window?: { width: number; center: number };
}

export interface SliceMessage {
  type: 'set_slice';
  slice: number;
  timestamp: number;
  fullResolution: boolean;
}

type MessageCallback = (message: ViewMessage | SliceMessage) => void;

interface DragState {
  isDragging: boolean;
  startPosition: { x: number; y: number };
  lastPosition: { x: number; y: number };
  startTime: number;
  motionVector: { dx: number; dy: number };
}

export class EventHygieneController {
  private sendMessage: MessageCallback;
  private debounceTimeouts = new Map<string, number>();
  private dragStates = new Map<string, DragState>();
  
  // Debounce configuration
  private readonly config = {
    sliderDrag: {
      debounceMs: 50,     // Send updates every 50ms during drag
      releaseDelayMs: 100  // Wait 100ms after release before full-res
    },
    panDrag: {
      debounceMs: 16,     // ~60fps for smooth panning
      releaseDelayMs: 50
    },
    zoomDrag: {
      debounceMs: 30,     // Balanced for zoom interactions
      releaseDelayMs: 75
    },
    windowLevel: {
      debounceMs: 50,
      releaseDelayMs: 100
    }
  };

  constructor(sendMessage: MessageCallback) {
    this.sendMessage = sendMessage;
  }

  /**
   * Handle slider drag events with debouncing
   */
  onSliderDrag(
    sliderId: string,
    value: number,
    isDragging: boolean,
    clientX?: number,
    clientY?: number
  ): void {
    const configKey = 'sliderDrag';
    
    if (isDragging) {
      this.startDrag(sliderId, clientX || 0, clientY || 0);
      this.debouncedSliderUpdate(sliderId, value, configKey);
    } else {
      this.endDrag(sliderId);
      this.sendFullResolutionSlice(sliderId, value, configKey);
    }
  }

  /**
   * Handle pan/zoom drag events
   */
  onViewDrag(
    interactionId: string,
    type: 'pan' | 'zoom',
    params: { zoom?: number; pan?: { x: number; y: number } },
    isDragging: boolean,
    clientX: number,
    clientY: number
  ): void {
    const configKey = type === 'pan' ? 'panDrag' : 'zoomDrag';
    
    if (isDragging) {
      this.startDrag(interactionId, clientX, clientY);
      this.debouncedViewUpdate(interactionId, params, configKey);
    } else {
      this.endDrag(interactionId);
      this.sendFullResolutionView(interactionId, params, configKey);
    }
  }

  /**
   * Handle window/level adjustments
   */
  onWindowLevelDrag(
    windowId: string,
    window: { width: number; center: number },
    isDragging: boolean,
    clientX?: number,
    clientY?: number
  ): void {
    const configKey = 'windowLevel';
    
    if (isDragging) {
      this.startDrag(windowId, clientX || 0, clientY || 0);
      this.debouncedWindowLevelUpdate(windowId, window, configKey);
    } else {
      this.endDrag(windowId);
      this.sendFullResolutionWindowLevel(windowId, window, configKey);
    }
  }

  private startDrag(id: string, clientX: number, clientY: number): void {
    const now = performance.now();
    const position = { x: clientX, y: clientY };
    
    this.dragStates.set(id, {
      isDragging: true,
      startPosition: position,
      lastPosition: position,
      startTime: now,
      motionVector: { dx: 0, dy: 0 }
    });
  }

  private endDrag(id: string): void {
    const dragState = this.dragStates.get(id);
    if (dragState) {
      dragState.isDragging = false;
    }
  }

  private updateMotionVector(id: string, clientX: number, clientY: number): void {
    const dragState = this.dragStates.get(id);
    if (!dragState) return;

    const dx = clientX - dragState.lastPosition.x;
    const dy = clientY - dragState.lastPosition.y;
    
    dragState.motionVector = { dx, dy };
    dragState.lastPosition = { x: clientX, y: clientY };
  }

  private debouncedSliderUpdate(
    sliderId: string,
    value: number,
    configKey: keyof typeof this.config
  ): void {
    this.debounce(`slider_${sliderId}`, () => {
      const dragState = this.dragStates.get(sliderId);
      const motionVector = dragState?.motionVector;

      const message: SliceMessage = {
        type: 'set_slice',
        slice: value,
        timestamp: Date.now(),
        fullResolution: false
      };

      this.sendMessage(message);
    }, this.config[configKey].debounceMs);
  }

  private debouncedViewUpdate(
    interactionId: string,
    params: { zoom?: number; pan?: { x: number; y: number } },
    configKey: keyof typeof this.config
  ): void {
    this.debounce(`view_${interactionId}`, () => {
      const dragState = this.dragStates.get(interactionId);
      const motionVector = dragState?.motionVector;

      const message: ViewMessage = {
        type: 'set_view',
        drag: true,
        motionVector,
        timestamp: Date.now(),
        ...params
      };

      this.sendMessage(message);
    }, this.config[configKey].debounceMs);
  }

  private debouncedWindowLevelUpdate(
    windowId: string,
    window: { width: number; center: number },
    configKey: keyof typeof this.config
  ): void {
    this.debounce(`window_${windowId}`, () => {
      const dragState = this.dragStates.get(windowId);
      const motionVector = dragState?.motionVector;

      const message: ViewMessage = {
        type: 'set_view',
        drag: true,
        motionVector,
        timestamp: Date.now(),
        window
      };

      this.sendMessage(message);
    }, this.config[configKey].debounceMs);
  }

  private sendFullResolutionSlice(
    sliderId: string,
    value: number,
    configKey: keyof typeof this.config
  ): void {
    this.debounce(`slider_release_${sliderId}`, () => {
      const message: SliceMessage = {
        type: 'set_slice',
        slice: value,
        timestamp: Date.now(),
        fullResolution: true
      };

      this.sendMessage(message);
      this.dragStates.delete(sliderId);
    }, this.config[configKey].releaseDelayMs);
  }

  private sendFullResolutionView(
    interactionId: string,
    params: { zoom?: number; pan?: { x: number; y: number } },
    configKey: keyof typeof this.config
  ): void {
    this.debounce(`view_release_${interactionId}`, () => {
      const message: ViewMessage = {
        type: 'set_view',
        drag: false,
        timestamp: Date.now(),
        ...params
      };

      this.sendMessage(message);
      this.dragStates.delete(interactionId);
    }, this.config[configKey].releaseDelayMs);
  }

  private sendFullResolutionWindowLevel(
    windowId: string,
    window: { width: number; center: number },
    configKey: keyof typeof this.config
  ): void {
    this.debounce(`window_release_${windowId}`, () => {
      const message: ViewMessage = {
        type: 'set_view',
        drag: false,
        timestamp: Date.now(),
        window
      };

      this.sendMessage(message);
      this.dragStates.delete(windowId);
    }, this.config[configKey].releaseDelayMs);
  }

  private debounce(key: string, callback: () => void, delay: number): void {
    // Clear existing timeout
    const existingTimeout = this.debounceTimeouts.get(key);
    if (existingTimeout !== undefined) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeoutId = window.setTimeout(() => {
      callback();
      this.debounceTimeouts.delete(key);
    }, delay);

    this.debounceTimeouts.set(key, timeoutId);
  }

  /**
   * Cancel all pending debounced actions
   */
  cancelAll(): void {
    for (const timeoutId of this.debounceTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.debounceTimeouts.clear();
    this.dragStates.clear();
  }

  /**
   * Cancel debounced actions for a specific ID
   */
  cancel(id: string): void {
    const keysToCancel = Array.from(this.debounceTimeouts.keys())
      .filter(key => key.includes(id));

    for (const key of keysToCancel) {
      const timeoutId = this.debounceTimeouts.get(key);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        this.debounceTimeouts.delete(key);
      }
    }

    this.dragStates.delete(id);
  }

  /**
   * Get current drag state for debugging
   */
  getDragState(id: string): DragState | undefined {
    return this.dragStates.get(id);
  }

  /**
   * Check if any interactions are currently being debounced
   */
  hasPendingActions(): boolean {
    return this.debounceTimeouts.size > 0;
  }

  /**
   * Get count of pending debounced actions
   */
  getPendingActionCount(): number {
    return this.debounceTimeouts.size;
  }

  /**
   * Update configuration for specific interaction types
   */
  updateConfig(
    type: keyof typeof this.config,
    config: Partial<typeof this.config.sliderDrag>
  ): void {
    this.config[type] = { ...this.config[type], ...config };
  }
}