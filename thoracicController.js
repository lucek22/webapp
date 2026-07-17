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
    liveAngle: existing?.liveAngle ?? 0
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

  if (btnResetThoracic) {
    btnResetThoracic.addEventListener('click', async () => {
      await resetThoracicExtensionUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }
}
