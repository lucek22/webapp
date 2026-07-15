// =========================================================
// HIP INTERNAL/EXTERNAL ROTATION CONTROLLER MODULE
// =========================================================

import { state, getROMThresholds } from './helpers.js';
import { autoSyncToActiveProfile, openProfileDetailsModal } from './profileManager.js';

// Callbacks to prevent circular imports
let startVideoRecordingFn = null;
let stopVideoRecordingFn = null;

export function registerHipRotationCallbacks(config) {
  startVideoRecordingFn = config.startVideoRecording;
  stopVideoRecordingFn = config.stopVideoRecording;
}

/**
 * Class for measuring hip internal and external rotation.
 */
export class HipRotationMeasurer {
  constructor() {
    this.reset();
  }

  reset() {
    this.baselineVector = null;
    this.baselineAngle = null;
    this.maxExternalRotation = 0;
    this.maxInternalRotation = 0;
    this.maxExternalRotationTime = 0;
    this.maxInternalRotationTime = 0;
    this.timeSeries = [];
  }

  /**
   * Initializes or overrides the baseline using the current frame's landmarks.
   * @param {Array} landmarks MediaPipe pose landmarks (33 points)
   * @param {string} side 'left' or 'right'
   * @returns {boolean} True if baseline was successfully set
   */
  setBaselineFrame(landmarks, side) {
    if (!landmarks) return false;
    const kneeIdx = side === 'left' ? 25 : 26;
    const ankleIdx = side === 'left' ? 27 : 28;

    const knee = landmarks[kneeIdx];
    const ankle = landmarks[ankleIdx];

    if (!knee || !ankle) return false;

    // In neutral position, the tibia vector goes from knee straight down.
    // We record the current tibia vector as the baseline starting position.
    const dx = ankle.x - knee.x;
    const dy = ankle.y - knee.y; // note screen coordinates: down is positive y
    
    this.baselineAngle = Math.atan2(dx, dy);
    this.baselineVector = { x: dx, y: dy };
    return true;
  }

  /**
   * Process a single frame and calculate the signed rotation angle relative to baseline 0°.
   * Positive angles represent external rotation (outward).
   * Negative angles represent internal rotation (inward).
   * @param {Array} landmarks MediaPipe pose landmarks (33 points)
   * @param {string} side 'left' or 'right'
   * @param {number} timestamp Current playhead timestamp in seconds
   * @param {boolean} recordPeaks True if we should track maximums and timeseries
   * @returns {number|null} Signed rotation angle in degrees, or null if landmarks are missing
   */
  processFrame(landmarks, side, timestamp, recordPeaks = true) {
    if (!landmarks) return null;
    const kneeIdx = side === 'left' ? 25 : 26;
    const ankleIdx = side === 'left' ? 27 : 28;

    const knee = landmarks[kneeIdx];
    const ankle = landmarks[ankleIdx];

    if (!knee || !ankle) return null;

    // Establish baseline dynamically on first valid frame if not set
    if (!this.baselineVector) {
      const ok = this.setBaselineFrame(landmarks, side);
      if (!ok) return null;
    }

    // Calculate current tibia vector components
    const dx = ankle.x - knee.x;
    const dy = ankle.y - knee.y;

    // Current angle relative to screen vertical
    const currentAngleRad = Math.atan2(dx, dy);
    
    // Signed angular difference relative to 0° baseline
    let diffRad = currentAngleRad - this.baselineAngle;

    // Handle wrapping bounds correctly to stay within [-PI, PI] range
    while (diffRad > Math.PI) diffRad -= 2 * Math.PI;
    while (diffRad < -Math.PI) diffRad += 2 * Math.PI;

    let angleDeg = diffRad * (180 / Math.PI);

    // If testing side is right, we flip the sign so that outward (smaller x) is positive, inward (larger x) is negative
    if (side === 'right') {
      angleDeg = -angleDeg;
    }

    // Biomechanically, hip external rotation is when the ankle goes inwards (positive angle),
    // and hip internal rotation is when the ankle goes outwards (negative angle).
    // Since this is opposite to pure outward/inward lateral displacement sign, we invert the final sign.
    angleDeg = -angleDeg;

    // Track peak internal and external rotation angles (internal peaks are tracked as positive values)
    if (recordPeaks) {
      if (angleDeg > 0) {
        if (angleDeg > this.maxExternalRotation) {
          this.maxExternalRotation = angleDeg;
          this.maxExternalRotationTime = parseFloat(timestamp.toFixed(3));
        }
      } else {
        const absAngle = Math.abs(angleDeg);
        if (absAngle > this.maxInternalRotation) {
          this.maxInternalRotation = absAngle;
          this.maxInternalRotationTime = parseFloat(timestamp.toFixed(3));
        }
      }

      // Append to continuous timeseries
      this.timeSeries.push({
        time: parseFloat(timestamp.toFixed(3)),
        angle: parseFloat(angleDeg.toFixed(1))
      });
    }

    return parseFloat(angleDeg.toFixed(1));
  }

  /**
   * Fetches the analyzed peaks and timeseries results.
   * @returns {Object}
   */
  getResults() {
    return {
      maxExternalRotation: parseFloat(this.maxExternalRotation.toFixed(1)),
      maxInternalRotation: parseFloat(this.maxInternalRotation.toFixed(1)),
      timeSeries: this.timeSeries,
      maxExternalRotationTime: this.maxExternalRotationTime,
      maxInternalRotationTime: this.maxInternalRotationTime
    };
  }
}

/**
 * Returns default/empty hip rotation metrics structure.
 */
export function getDefaultHipRotation(existing = null) {
  return {
    maxExternalRotationL: existing?.maxExternalRotationL ?? 0,
    maxInternalRotationL: existing?.maxInternalRotationL ?? 0,
    maxExternalRotationR: existing?.maxExternalRotationR ?? 0,
    maxInternalRotationR: existing?.maxInternalRotationR ?? 0,
    maxExternalRotationTimeL: existing?.maxExternalRotationTimeL ?? 0,
    maxInternalRotationTimeL: existing?.maxInternalRotationTimeL ?? 0,
    maxExternalRotationTimeR: existing?.maxExternalRotationTimeR ?? 0,
    maxInternalRotationTimeR: existing?.maxInternalRotationTimeR ?? 0,
    timeSeriesL: existing?.timeSeriesL ?? [],
    timeSeriesR: existing?.timeSeriesR ?? []
  };
}

// DOM Elements for Hip Rotation
const hipRotationPeakExternalL = document.getElementById('hip-rotation-peak-external-l');
const hipRotationLiveAngleL = document.getElementById('hip-rotation-live-angle-l');
const hipRotationPeakExternalR = document.getElementById('hip-rotation-peak-external-r');
const hipRotationLiveAngleR = document.getElementById('hip-rotation-live-angle-r');

const hipRotationPeakInternalL = document.getElementById('hip-rotation-peak-internal-l');
const hipRotationPeakInternalR = document.getElementById('hip-rotation-peak-internal-r');

const hipRotationStatusVal = document.getElementById('hip-rotation-status-val');

const btnHipRotationSideLeft = document.getElementById('btn-hip-rotation-side-left');
const btnHipRotationSideRight = document.getElementById('btn-hip-rotation-side-right');
const btnSaveHipRotationPeaks = document.getElementById('btn-save-hip-rotation-peaks');

let drawFrameCallback = null;

export function registerHipRotationDrawCallback(callback) {
  drawFrameCallback = callback;
}

export function updateHipRotationSideUI() {
  const side = state.hipRotationTestingSide || 'left';
  if (btnHipRotationSideLeft && btnHipRotationSideRight) {
    if (side === 'left') {
      btnHipRotationSideLeft.classList.add('active-left');
      btnHipRotationSideLeft.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnHipRotationSideLeft.style.color = 'white';
      btnHipRotationSideRight.classList.remove('active-right');
      btnHipRotationSideRight.style.background = 'transparent';
      btnHipRotationSideRight.style.color = '#a7b1b7';
    } else if (side === 'right') {
      btnHipRotationSideRight.classList.add('active-right');
      btnHipRotationSideRight.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnHipRotationSideRight.style.color = 'white';
      btnHipRotationSideLeft.classList.remove('active-left');
      btnHipRotationSideLeft.style.background = 'transparent';
      btnHipRotationSideLeft.style.color = '#a7b1b7';
    }
  }

  const angleBoxes = document.querySelectorAll('#hip-rotation-sidebar-content .angle-box');
  angleBoxes.forEach(box => {
    if (side === 'left') {
      if (box.classList.contains('left-border')) {
        box.classList.add('active-left');
        box.classList.remove('inactive-side');
      } else if (box.classList.contains('right-border')) {
        box.classList.add('inactive-side');
        box.classList.remove('active-right');
      }
    } else if (side === 'right') {
      if (box.classList.contains('right-border')) {
        box.classList.add('active-right');
        box.classList.remove('inactive-side');
      } else if (box.classList.contains('left-border')) {
        box.classList.add('inactive-side');
        box.classList.remove('active-left');
      }
    }
  });
}

export function updateHipRotationSidebarUI() {
  const p = state.hipRotation || getDefaultHipRotation();
  if (hipRotationPeakExternalL) hipRotationPeakExternalL.textContent = `${p.maxExternalRotationL ? Math.round(p.maxExternalRotationL) : 0}°`;
  if (hipRotationPeakExternalR) hipRotationPeakExternalR.textContent = `${p.maxExternalRotationR ? Math.round(p.maxExternalRotationR) : 0}°`;
  if (hipRotationPeakInternalL) hipRotationPeakInternalL.textContent = `${p.maxInternalRotationL ? Math.round(p.maxInternalRotationL) : 0}°`;
  if (hipRotationPeakInternalR) hipRotationPeakInternalR.textContent = `${p.maxInternalRotationR ? Math.round(p.maxInternalRotationR) : 0}°`;
}

export async function resetHipRotationPeaksUI() {
  if (!state.hipRotation) {
    state.hipRotation = getDefaultHipRotation();
  }
  const side = state.hipRotationTestingSide || 'left';
  if (side === 'left') {
    state.hipRotation.maxExternalRotationL = 0;
    state.hipRotation.maxInternalRotationL = 0;
    state.hipRotation.maxExternalRotationTimeL = 0;
    state.hipRotation.maxInternalRotationTimeL = 0;
    state.hipRotation.timeSeriesL = [];
    state.imageHipRotationL = null;
  } else {
    state.hipRotation.maxExternalRotationR = 0;
    state.hipRotation.maxInternalRotationR = 0;
    state.hipRotation.maxExternalRotationTimeR = 0;
    state.hipRotation.maxInternalRotationTimeR = 0;
    state.hipRotation.timeSeriesR = [];
    state.imageHipRotationR = null;
  }
  state.isHipRotationRecording = false;

  if (btnSaveHipRotationPeaks) {
    btnSaveHipRotationPeaks.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
      Capture Rotation Snapshot
    `;
    btnSaveHipRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  }

  if (state.liveHipRotationMeasurer) {
    state.liveHipRotationMeasurer.reset();
  }

  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }

  if (hipRotationLiveAngleL) hipRotationLiveAngleL.textContent = '--°';
  if (hipRotationLiveAngleR) hipRotationLiveAngleR.textContent = '--°';

  if (hipRotationStatusVal) {
    hipRotationStatusVal.textContent = 'Awaiting Subject';
    hipRotationStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    hipRotationStatusVal.classList.add('text-slate');
  }
  updateHipRotationSidebarUI();
}

export async function processHipRotationFromPreprocessedFrames() {
  if (!state.exportFramesData || state.exportFramesData.length === 0) return;
  const side = state.hipRotationTestingSide || 'left';
  console.log(`[HipRotationProcessing] Processing hip rotation from ${state.exportFramesData.length} frames for side: ${side}`);

  // Create a measurer instance
  const measurer = new HipRotationMeasurer();

  // Process all preprocessed frame pose landmarks
  let hasValid = false;

  for (let i = 0; i < state.exportFramesData.length; i++) {
    const frame = state.exportFramesData[i];
    if (frame.poseLandmarks) {
      const ts = frame.time || (i / 30);
      const angle = measurer.processFrame(frame.poseLandmarks, side, ts);
      if (angle !== null) {
        hasValid = true;
      }
    }
  }

  if (!hasValid) {
    console.warn("[HipRotationProcessing] No valid landmarks found in preprocessed frames.");
    return;
  }

  const results = measurer.getResults();

  if (!state.hipRotation) {
    state.hipRotation = getDefaultHipRotation();
  }

  if (side === 'left') {
    state.hipRotation.maxExternalRotationL = results.maxExternalRotation;
    state.hipRotation.maxInternalRotationL = results.maxInternalRotation;
    state.hipRotation.maxExternalRotationTimeL = results.maxExternalRotationTime;
    state.hipRotation.maxInternalRotationTimeL = results.maxInternalRotationTime;
    state.hipRotation.timeSeriesL = results.timeSeries;
  } else {
    state.hipRotation.maxExternalRotationR = results.maxExternalRotation;
    state.hipRotation.maxInternalRotationR = results.maxInternalRotation;
    state.hipRotation.maxExternalRotationTimeR = results.maxExternalRotationTime;
    state.hipRotation.maxInternalRotationTimeR = results.maxInternalRotationTime;
    state.hipRotation.timeSeriesR = results.timeSeries;
  }

  // Update Status Text
  if (hipRotationStatusVal) {
    hipRotationStatusVal.textContent = 'Analysis Complete';
    hipRotationStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    hipRotationStatusVal.classList.add('text-emerald');
  }

  // Save/Sync state and refresh display
  updateHipRotationSidebarUI();

  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }
}

// Bind hip rotation button event listeners
export function setupHipRotationListeners(onPoseResultsCallback) {
  registerHipRotationDrawCallback(onPoseResultsCallback);

  if (btnHipRotationSideLeft) {
    btnHipRotationSideLeft.addEventListener('click', () => {
      state.hipRotationTestingSide = 'left';
      state.isHipRotationRecording = false;
      if (btnSaveHipRotationPeaks) {
        btnSaveHipRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Capture Rotation Snapshot
        `;
        btnSaveHipRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      }
      if (state.liveHipRotationMeasurer) {
        state.liveHipRotationMeasurer.reset();
      }
      updateHipRotationSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnHipRotationSideRight) {
    btnHipRotationSideRight.addEventListener('click', () => {
      state.hipRotationTestingSide = 'right';
      state.isHipRotationRecording = false;
      if (btnSaveHipRotationPeaks) {
        btnSaveHipRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Capture Rotation Snapshot
        `;
        btnSaveHipRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      }
      if (state.liveHipRotationMeasurer) {
        state.liveHipRotationMeasurer.reset();
      }
      updateHipRotationSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  const btnResetHipRotationPeaks = document.getElementById('btn-reset-hip-rotation-peaks');
  if (btnResetHipRotationPeaks) {
    btnResetHipRotationPeaks.addEventListener('click', () => {
      if (confirm("Are you sure you want to reset hip rotation peak data?")) {
        resetHipRotationPeaksUI();
      }
    });
  }

  if (btnSaveHipRotationPeaks) {
    btnSaveHipRotationPeaks.addEventListener('click', async () => {
      if (!state.activeProfileId) {
        alert("Please select or load an active athlete profile first.");
        return;
      }

      const videoElement = document.getElementById('webcam');
      const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;

      if (!state.isHipRotationRecording) {
        // --- START RECORDING ---
        state.isHipRotationRecording = true;
        
        if (state.liveHipRotationMeasurer) {
          state.liveHipRotationMeasurer.reset();
        }
        if (!state.hipRotation) {
          state.hipRotation = getDefaultHipRotation();
        }
        const side = state.hipRotationTestingSide || 'left';
        if (side === 'left') {
          state.hipRotation.maxExternalRotationL = 0;
          state.hipRotation.maxInternalRotationL = 0;
          state.hipRotation.maxExternalRotationTimeL = 0;
          state.hipRotation.maxInternalRotationTimeL = 0;
          state.hipRotation.timeSeriesL = [];
        } else {
          state.hipRotation.maxExternalRotationR = 0;
          state.hipRotation.maxInternalRotationR = 0;
          state.hipRotation.maxExternalRotationTimeR = 0;
          state.hipRotation.maxInternalRotationTimeR = 0;
          state.hipRotation.timeSeriesR = [];
        }
        updateHipRotationSidebarUI();

        if (isWebcamLive && startVideoRecordingFn) {
          startVideoRecordingFn();
        }

        // Update button UI
        btnSaveHipRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg>
          Stop Capture & Save
        `;
        btnSaveHipRotationPeaks.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';

        if (hipRotationStatusVal) {
          hipRotationStatusVal.textContent = 'Recording Peak Angles...';
          hipRotationStatusVal.classList.remove('text-slate', 'text-emerald');
          hipRotationStatusVal.classList.add('text-amber');
        }
      } else {
        // --- STOP RECORDING & SAVE ---
        state.isHipRotationRecording = false;

        if (isWebcamLive && stopVideoRecordingFn) {
          stopVideoRecordingFn();
        }

        btnSaveHipRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Capture Rotation Snapshot
        `;
        btnSaveHipRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';

        if (hipRotationStatusVal) {
          hipRotationStatusVal.textContent = 'Analysis Complete';
          hipRotationStatusVal.classList.remove('text-slate', 'text-amber');
          hipRotationStatusVal.classList.add('text-emerald');
        }

        try {
          await autoSyncToActiveProfile(true);
          alert("Hip rotation peak data saved successfully!");
          // openProfileDetailsModal(state.activeProfileId);
        } catch (err) {
          alert("Failed to save hip rotation data: " + err.message);
        }
      }
    });
  }
}
