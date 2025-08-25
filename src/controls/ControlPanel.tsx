/**
 * RemoteView Control Panel Component
 * 
 * Main UI controls for the RemoteView client including sliders for navigation,
 * LUT selection, and connection controls.
 */

import React from 'react';
import type { ViewState } from '../types';

interface ControlPanelProps {
  viewState: ViewState;
  onViewStateChange: (updates: Partial<ViewState>) => void;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: () => void;
  onDisconnect: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  viewState,
  onViewStateChange,
  connectionStatus,
  onConnect,
  onDisconnect
}) => {
  const planeNames = ['Inline', 'Crossline', 'Time/Depth'];
  const lutOptions = [
    'SeismicRWB',
    'Grayscale', 
    'Seismic',
    'Rainbow',
    'BlueWhiteRed',
    'RedWhiteBlue'
  ];

  const handleSliderChange = (
    key: keyof ViewState['sliceIndices'], 
    value: number
  ) => {
    onViewStateChange({
      sliceIndices: {
        ...viewState.sliceIndices,
        [key]: value
      }
    });
  };

  return (
    <div className="control-group">
      <h3>RemoteView Controls</h3>
      
      {/* Connection Status */}
      <div className="control-row">
        <span className="control-label">Status:</span>
        <span className={`status-${connectionStatus}`}>
          {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
        </span>
        {connectionStatus === 'disconnected' && (
          <button className="btn btn-primary" onClick={onConnect}>
            Connect
          </button>
        )}
        {connectionStatus === 'connected' && (
          <button className="btn btn-secondary" onClick={onDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      {/* Plane Selection */}
      <div className="control-row">
        <span className="control-label">Plane:</span>
        <select 
          className="select"
          value={viewState.currentPlane}
          onChange={(e) => onViewStateChange({ currentPlane: parseInt(e.target.value) })}
        >
          {planeNames.map((name, index) => (
            <option key={index} value={index}>{name}</option>
          ))}
        </select>
      </div>

      {/* Slice Navigation */}
      <div className="control-row">
        <span className="control-label">Inline:</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={2000}
          value={viewState.sliceIndices.inline}
          onChange={(e) => handleSliderChange('inline', parseInt(e.target.value))}
          onMouseDown={() => onViewStateChange({ isDragging: true })}
          onMouseUp={() => onViewStateChange({ isDragging: false })}
        />
        <input
          type="number"
          className="input-number"
          value={viewState.sliceIndices.inline}
          onChange={(e) => handleSliderChange('inline', parseInt(e.target.value))}
        />
      </div>

      <div className="control-row">
        <span className="control-label">Crossline:</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={1500}
          value={viewState.sliceIndices.crossline}
          onChange={(e) => handleSliderChange('crossline', parseInt(e.target.value))}
          onMouseDown={() => onViewStateChange({ isDragging: true })}
          onMouseUp={() => onViewStateChange({ isDragging: false })}
        />
        <input
          type="number"
          className="input-number"
          value={viewState.sliceIndices.crossline}
          onChange={(e) => handleSliderChange('crossline', parseInt(e.target.value))}
        />
      </div>

      <div className="control-row">
        <span className="control-label">Time:</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={1000}
          value={viewState.sliceIndices.timeDepth}
          onChange={(e) => handleSliderChange('timeDepth', parseInt(e.target.value))}
          onMouseDown={() => onViewStateChange({ isDragging: true })}
          onMouseUp={() => onViewStateChange({ isDragging: false })}
        />
        <input
          type="number"
          className="input-number"
          value={viewState.sliceIndices.timeDepth}
          onChange={(e) => handleSliderChange('timeDepth', parseInt(e.target.value))}
        />
      </div>

      {/* LUT Selection */}
      <div className="control-row">
        <span className="control-label">Color Map:</span>
        <select 
          className="select"
          value={viewState.lut}
          onChange={(e) => onViewStateChange({ lut: e.target.value })}
        >
          {lutOptions.map((lut) => (
            <option key={lut} value={lut}>{lut}</option>
          ))}
        </select>
      </div>

      {/* Display Controls */}
      <div className="control-row">
        <span className="control-label">Clip %:</span>
        <input
          type="range"
          className="slider"
          min={90}
          max={100}
          step={0.1}
          value={viewState.clipPercent}
          onChange={(e) => onViewStateChange({ clipPercent: parseFloat(e.target.value) })}
        />
        <input
          type="number"
          className="input-number"
          step={0.1}
          value={viewState.clipPercent}
          onChange={(e) => onViewStateChange({ clipPercent: parseFloat(e.target.value) })}
        />
      </div>

      <div className="control-row">
        <span className="control-label">Gain:</span>
        <input
          type="range"
          className="slider"
          min={0.1}
          max={5.0}
          step={0.1}
          value={viewState.gain}
          onChange={(e) => onViewStateChange({ gain: parseFloat(e.target.value) })}
        />
        <input
          type="number"
          className="input-number"
          step={0.1}
          value={viewState.gain}
          onChange={(e) => onViewStateChange({ gain: parseFloat(e.target.value) })}
        />
      </div>

      <div className="control-row">
        <span className="control-label">AGC Window:</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          value={viewState.agcWindow}
          onChange={(e) => onViewStateChange({ agcWindow: parseInt(e.target.value) })}
        />
        <input
          type="number"
          className="input-number"
          value={viewState.agcWindow}
          onChange={(e) => onViewStateChange({ agcWindow: parseInt(e.target.value) })}
        />
      </div>
    </div>
  );
};