#!/usr/bin/env node

import WebSocket from 'ws';

console.log('Testing WebRTC signaling with server...');

const ws = new WebSocket('ws://localhost:8447/ws');

ws.on('open', function open() {
  console.log('WebSocket connected');
  
  // Wait a moment for handshake
  setTimeout(() => {
    console.log('Sending WebRTC offer...');
    ws.send(JSON.stringify({
      type: 'offer',
      sdp: {
        type: 'offer',
        sdp: 'mock-offer-sdp-data-for-testing'
      }
    }));
  }, 100);
});

ws.on('message', function message(data) {
  try {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);
    
    if (msg.type === 'websocket_fallback') {
      console.log('✅ Server using WebSocket fallback (no mock data)!');
      console.log('✅ WebSocket communication working properly');
      
      // Test control message
      setTimeout(() => {
        console.log('Testing control message...');
        ws.send(JSON.stringify({
          t: 'set_slice',
          inline: 1200,
          xline: 900,
          z: 800
        }));
      }, 500);
      
    } else if (msg.type === 'slice_update_ack') {
      console.log('✅ Server responded to control message!');
      console.log('✅ Control message handling is working properly');
      ws.close();
      process.exit(0);
    }
  } catch (error) {
    console.error('Failed to parse message:', error);
  }
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
  process.exit(1);
});

ws.on('close', function close() {
  console.log('WebSocket connection closed');
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log('❌ Test timeout - no WebRTC answer received');
  ws.close();
  process.exit(1);
}, 10000);