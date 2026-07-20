// =========================================================
// THORACIC EXTENSION CONTROLLER MODULE
// =========================================================

import { state, getCanvasX } from './helpers.js';
import { autoSyncToActiveProfile } from './profileManager.js';

const thoracicLiveAngle = document.getElementById('thoracic-live-angle');
const thoracicPeakAngle = document.getElementById('thoracic-peak-angle');
const thoracicStatusVal = document.getElementById('thoracic-status-val');
const btnResetThoracic = document.getElementById('btn-reset-thoracic');

let drawFrameCallback = null;

// Callbacks to prevent circular imports
let startVideoRecordingFn = null;
let stopVideoRecordingFn = null;

export function registerThoracicCallbacks(config) {
  startVideoRecordingFn = config.startVideoRecording;
  stopVideoRecordingFn = config.stopVideoRecording;
}

export function registerThoracicDrawCallback(callback) {
  drawFrameCallback = callback;
}

export function calculateThoracicExtensionAngle(landmarks) {
  if (!landmarks) return null;

  const shoulderL = landmarks[11];
  const shoulderR = landmarks[12];
  const hipL = landmarks[23];
  const hipR = landmarks[24];

  if (!shoulderL || !shoulderR || !hipL || !hipR) return null;

  const height = state.canvasHeight || 480;
  const shoulderX = (getCanvasX(shoulderL.x) + getCanvasX(shoulderR.x)) / 2;
  const shoulderY = ((shoulderL.y + shoulderR.y) / 2) * height;
  const hipX = (getCanvasX(hipL.x) + getCanvasX(hipR.x)) / 2;
  const hipY = ((hipL.y + hipR.y) / 2) * height;

  const dx = shoulderX - hipX;
  const dy = shoulderY - hipY;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;

  // Use arc cosine to find the exact deviation from the "Up" vector (0, -1)
  // This guarantees a smooth 0 to 180 range without coordinate wrapping.
  const angleDeg = Math.acos(-dy / len) * (180 / Math.PI);
  
  return parseFloat(angleDeg.toFixed(1));
}

export function processThoracicExtension(landmarks) {
  const currentAngle = calculateThoracicExtensionAngle(landmarks);
  if (currentAngle === null) return;

  // Initialize the state object if it doesn't exist yet
  if (!state.thoracicExtension) {
    state.thoracicExtension = getDefaultThoracicExtension();
  }

  // Always update the live angle
  state.thoracicExtension.liveAngle = currentAngle;

  // Save the highest recorded angle (Peak)
  if (currentAngle > state.thoracicExtension.peakAngle) {
    state.thoracicExtension.peakAngle = currentAngle;
  }

  // Push the updated numbers to the HTML
  updateThoracicExtensionSidebarUI();
}

export function getDefaultThoracicExtension(existing = null) {
  return {
    peakAngle: existing?.peakAngle ?? 0,
    liveAngle: existing?.liveAngle ?? 0,
    isRecording: existing?.isRecording ?? false
  };
}

export function setThoracicExtensionStatus(message, className = 'text-slate') {
  if (thoracicStatusVal) {
    thoracicStatusVal.textContent = message;
    thoracicStatusVal.className = className;
  }
}

export function updateThoracicExtensionSidebarUI() {
  const p = state.thoracicExtension || getDefaultThoracicExtension();
  if (thoracicLiveAngle) thoracicLiveAngle.textContent = `${Math.round(p.liveAngle || 0)}°`;
  if (thoracicPeakAngle) thoracicPeakAngle.textContent = `${Math.round(p.peakAngle || 0)}°`;

  // Update Record/Tracking Toggle button styling
  const btnRecordToggle = document.getElementById('btn-record-thoracic-toggle');
  const dotRecord = document.getElementById('dot-record-thoracic');
  const txtRecord = document.getElementById('txt-record-thoracic');

  if (btnRecordToggle && dotRecord && txtRecord) {
    if (p.isRecording) {
      btnRecordToggle.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      txtRecord.textContent = 'Stop Recording';
      dotRecord.classList.add('recording-active-dot');
      btnRecordToggle.style.boxShadow = '0 2px 10px rgba(239, 68, 68, 0.4)';
    } else {
      btnRecordToggle.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      txtRecord.textContent = 'Start Recording';
      dotRecord.classList.remove('recording-active-dot');
      btnRecordToggle.style.boxShadow = '0 2px 10px rgba(16, 185, 129, 0.3)';
    }
  }

  // Update Status Text
  if (thoracicStatusVal) {
    if (p.isRecording) {
      thoracicStatusVal.textContent = 'Recording Active';
      thoracicStatusVal.className = 'metric-val text-red';
      thoracicStatusVal.style.color = '#ef4444';
    } else if (state.latestPoseResults && state.latestPoseResults.poseLandmarks) {
      thoracicStatusVal.textContent = 'Ready to Record';
      thoracicStatusVal.className = 'metric-val text-emerald';
      thoracicStatusVal.style.color = '#10b981';
    } else {
      thoracicStatusVal.textContent = 'Awaiting Subject';
      thoracicStatusVal.className = 'metric-val text-slate';
      thoracicStatusVal.style.color = '';
    }
  }
}

export async function resetThoracicExtensionUI() {
  state.thoracicExtension = getDefaultThoracicExtension();
  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }
  updateThoracicExtensionSidebarUI();
  setThoracicExtensionStatus('Awaiting Subject');
}

export function setupThoracicExtensionListeners(onPoseResultsCallback) {
  registerThoracicDrawCallback(onPoseResultsCallback);

  const btnRecordToggle = document.getElementById('btn-record-thoracic-toggle');
  if (btnRecordToggle) {
    btnRecordToggle.addEventListener('click', () => {
      const videoElement = document.getElementById('webcam');
      const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;

      if (!state.thoracicExtension) {
        state.thoracicExtension = getDefaultThoracicExtension();
      }

      state.thoracicExtension.isRecording = !state.thoracicExtension.isRecording;

      if (state.thoracicExtension.isRecording) {
        if (isWebcamLive && startVideoRecordingFn) {
          startVideoRecordingFn();
        }
      } else {
        if (stopVideoRecordingFn) {
          stopVideoRecordingFn();
        }
      }

      updateThoracicExtensionSidebarUI();
    });
  }

  if (btnResetThoracic) {
    btnResetThoracic.addEventListener('click', async () => {
      await resetThoracicExtensionUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }
}
