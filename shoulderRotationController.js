// =========================================================
// SHOULDER INTERNAL/EXTERNAL ROTATION CONTROLLER MODULE
// =========================================================

import { state, getROMThresholds, updateShoulderRotationGrades } from './helpers.js';
import { autoSyncToActiveProfile, openProfileDetailsModal } from './profileManager.js';

// Callbacks to prevent circular imports
let startVideoRecordingFn = null;
let stopVideoRecordingFn = null;

export function registerShoulderRotationCallbacks(config) {
  startVideoRecordingFn = config.startVideoRecording;
  stopVideoRecordingFn = config.stopVideoRecording;
}

/**
 * Class for measuring shoulder internal and external rotation from a sagittal-view video.
 * Assumes the starting position (0°) has the upper arm vertical, the elbow bent at 90°,
 * and the forearm parallel to the ground, pointing forward.
 */
export class ShoulderRotationMeasurer {
  constructor() {
    this.reset();
  }

  /**
   * Resets all internal buffers and recorded peaks.
   */
  reset() {
    this.baselineVector = null;
    this.baselineAngle = null;
    this.facingDirection = null; // 'left' or 'right'
    this.maxExternalRotation = 0; // Positive degrees (rotated backwards/towards head)
    this.maxInternalRotation = 0; // Negative degrees (rotated forwards/towards stomach)
    this.timeSeries = []; // List of { time: number, angle: number }
  }

  /**
   * Initializes or overrides the baseline using the current frame's landmarks.
   * @param {Array} landmarks MediaPipe pose landmarks (33 points)
   * @param {string} side 'left' or 'right'
   * @returns {boolean} True if baseline was successfully set
   */
  setBaselineFrame(landmarks, side) {
    if (!landmarks) return false;
    const shoulderIdx = side === 'left' ? 11 : 12;
    const elbowIdx = side === 'left' ? 13 : 14;
    const wristIdx = side === 'left' ? 15 : 16;

    const shoulder = landmarks[shoulderIdx];
    const elbow = landmarks[elbowIdx];
    const wrist = landmarks[wristIdx];

    if (!shoulder || !elbow || !wrist) return false;

    // Determine facing direction dynamically based on starting forearm position.
    // If the wrist is to the right of the elbow (greater x coordinate), the user is facing right.
    this.facingDirection = (wrist.x > elbow.x) ? 'right' : 'left';
    const sign = this.facingDirection === 'right' ? 1 : -1;

    // Forearm vector: elbow -> wrist
    const v_x = wrist.x - elbow.x;
    const v_y = wrist.y - elbow.y;

    // Angle relative to horizontal ground line in standard Cartesian plane (positive standard y is up, forward is positive x)
    this.baselineAngle = Math.atan2(-v_y, sign * v_x);
    this.baselineVector = { x: v_x, y: v_y };
    return true;
  }

  /**
   * Process a single frame and calculate the signed rotation angle relative to baseline 0°.
   * Positive angles represent external rotation (backwards).
   * Negative angles represent internal rotation (forwards).
   * @param {Array} landmarks MediaPipe pose landmarks (33 points)
   * @param {string} side 'left' or 'right'
   * @param {number} timestamp Current playhead timestamp in seconds
   * @returns {number|null} Signed rotation angle in degrees, or null if landmarks are missing
   */
  processFrame(landmarks, side, timestamp, recordPeaks = true) {
    if (!landmarks) return null;
    const shoulderIdx = side === 'left' ? 11 : 12;
    const elbowIdx = side === 'left' ? 13 : 14;
    const wristIdx = side === 'left' ? 15 : 16;

    const shoulder = landmarks[shoulderIdx];
    const elbow = landmarks[elbowIdx];
    const wrist = landmarks[wristIdx];

    if (!shoulder || !elbow || !wrist) return null;

    // Establish baseline dynamically on first valid frame if not set
    if (!this.baselineVector) {
      const ok = this.setBaselineFrame(landmarks, side);
      if (!ok) return null;
    }

    const sign = this.facingDirection === 'right' ? 1 : -1;

    // Current forearm vector: elbow -> wrist
    const v_x = wrist.x - elbow.x;
    const v_y = wrist.y - elbow.y;

    // Angle of current forearm in Cartesian plane (invert y component due to canvas space)
    const currentAngle = Math.atan2(-v_y, sign * v_x);

    // Compute the signed angular difference relative to 0° baseline
    let diffRad = currentAngle - this.baselineAngle;

    // Handle wrapping bounds correctly to stay within [-PI, PI] range
    while (diffRad > Math.PI) diffRad -= 2 * Math.PI;
    while (diffRad < -Math.PI) diffRad += 2 * Math.PI;

    const angleDeg = diffRad * (180 / Math.PI);

    // Track peak internal and external rotation angles (internal peaks are tracked as positive values)
    if (recordPeaks) {
      if (angleDeg > 0) {
        if (angleDeg > this.maxExternalRotation) {
          this.maxExternalRotation = angleDeg;
        }
      } else {
        const absAngle = Math.abs(angleDeg);
        if (absAngle > this.maxInternalRotation) {
          this.maxInternalRotation = absAngle;
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
      timeSeries: this.timeSeries
    };
  }
}

/**
 * Returns default/empty rotation metrics structure.
 * @param {Object|null} existing Pre-existing metrics to merge
 * @returns {Object}
 */
export function getDefaultShoulderRotation(existing = null) {
  return {
    maxExternalRotationL: existing?.maxExternalRotationL ?? 0,
    maxInternalRotationL: existing?.maxInternalRotationL ?? 0,
    maxExternalRotationR: existing?.maxExternalRotationR ?? 0,
    maxInternalRotationR: existing?.maxInternalRotationR ?? 0,
    timeSeriesL: existing?.timeSeriesL ?? [],
    timeSeriesR: existing?.timeSeriesR ?? []
  };
}

// DOM Elements for Shoulder Rotation
const shoulderRotationPeakExternalL = document.getElementById('shoulder-rotation-peak-external-l');
const shoulderRotationLiveAngleL = document.getElementById('shoulder-rotation-live-angle-l');
const shoulderRotationPeakExternalR = document.getElementById('shoulder-rotation-peak-external-r');
const shoulderRotationLiveAngleR = document.getElementById('shoulder-rotation-live-angle-r');

const shoulderRotationPeakInternalL = document.getElementById('shoulder-rotation-peak-internal-l');
const shoulderRotationPeakInternalR = document.getElementById('shoulder-rotation-peak-internal-r');

const shoulderRotationStatusVal = document.getElementById('shoulder-rotation-status-val');

const btnShoulderRotationSideLeft = document.getElementById('btn-shoulder-rotation-side-left');
const btnShoulderRotationSideRight = document.getElementById('btn-shoulder-rotation-side-right');
const btnSaveShoulderRotationPeaks = document.getElementById('btn-save-shoulder-rotation-peaks');

// Active drawing callback placeholder
let drawFrameCallback = null;

export function registerShoulderRotationDrawCallback(callback) {
  drawFrameCallback = callback;
}

export function updateShoulderRotationSideUI() {
  const side = state.shoulderRotationTestingSide || 'left';
  if (btnShoulderRotationSideLeft && btnShoulderRotationSideRight) {
    if (side === 'left') {
      btnShoulderRotationSideLeft.classList.add('active-left');
      btnShoulderRotationSideLeft.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnShoulderRotationSideLeft.style.color = 'white';
      btnShoulderRotationSideRight.classList.remove('active-right');
      btnShoulderRotationSideRight.style.background = 'transparent';
      btnShoulderRotationSideRight.style.color = '#a7b1b7';
    } else if (side === 'right') {
      btnShoulderRotationSideRight.classList.add('active-right');
      btnShoulderRotationSideRight.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnShoulderRotationSideRight.style.color = 'white';
      btnShoulderRotationSideLeft.classList.remove('active-left');
      btnShoulderRotationSideLeft.style.background = 'transparent';
      btnShoulderRotationSideLeft.style.color = '#a7b1b7';
    }
  }

  const angleBoxes = document.querySelectorAll('#shoulder-rotation-sidebar-content .angle-box');
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

export function updateShoulderRotationSidebarUI() {
  const p = state.shoulderRotation || getDefaultShoulderRotation();
  if (shoulderRotationPeakExternalL) shoulderRotationPeakExternalL.textContent = `${p.maxExternalRotationL ? Math.round(p.maxExternalRotationL) : 0}°`;
  if (shoulderRotationPeakExternalR) shoulderRotationPeakExternalR.textContent = `${p.maxExternalRotationR ? Math.round(p.maxExternalRotationR) : 0}°`;
  if (shoulderRotationPeakInternalL) shoulderRotationPeakInternalL.textContent = `${p.maxInternalRotationL ? Math.round(p.maxInternalRotationL) : 0}°`;
  if (shoulderRotationPeakInternalR) shoulderRotationPeakInternalR.textContent = `${p.maxInternalRotationR ? Math.round(p.maxInternalRotationR) : 0}°`;
}

export async function resetShoulderRotationPeaksUI() {
  if (!state.shoulderRotation) {
    state.shoulderRotation = getDefaultShoulderRotation();
  }
  const side = state.shoulderRotationTestingSide || 'left';
  if (side === 'left') {
    state.shoulderRotation.maxExternalRotationL = 0;
    state.shoulderRotation.maxInternalRotationL = 0;
    state.shoulderRotation.timeSeriesL = [];
    state.imageShoulderRotationL = null;
  } else {
    state.shoulderRotation.maxExternalRotationR = 0;
    state.shoulderRotation.maxInternalRotationR = 0;
    state.shoulderRotation.timeSeriesR = [];
    state.imageShoulderRotationR = null;
  }
  state.isShoulderRotationRecording = false;

  if (btnSaveShoulderRotationPeaks) {
    btnSaveShoulderRotationPeaks.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
      Record Movement
    `;
    btnSaveShoulderRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  }

  if (state.liveShoulderRotationMeasurer) {
    state.liveShoulderRotationMeasurer.reset();
  }

  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }

  if (shoulderRotationLiveAngleL) shoulderRotationLiveAngleL.textContent = '--°';
  if (shoulderRotationLiveAngleR) shoulderRotationLiveAngleR.textContent = '--°';

  if (shoulderRotationStatusVal) {
    shoulderRotationStatusVal.textContent = 'Awaiting Subject';
    shoulderRotationStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    shoulderRotationStatusVal.classList.add('text-slate');
  }
  updateShoulderRotationSidebarUI();
}

export async function processShoulderRotationFromPreprocessedFrames() {
  if (!state.exportFramesData || state.exportFramesData.length === 0) return;
  const side = state.shoulderRotationTestingSide || 'left';
  console.log(`[ShoulderRotationProcessing] Processing shoulder rotation from ${state.exportFramesData.length} frames for side: ${side}`);

  // Create a measurer instance
  const measurer = new ShoulderRotationMeasurer();

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
    console.warn("[ShoulderRotationProcessing] No valid landmarks found in preprocessed frames.");
    return;
  }

  const results = measurer.getResults();

  if (!state.shoulderRotation) {
    state.shoulderRotation = getDefaultShoulderRotation();
  }

  if (side === 'left') {
    state.shoulderRotation.maxExternalRotationL = results.maxExternalRotation;
    state.shoulderRotation.maxInternalRotationL = results.maxInternalRotation;
    state.shoulderRotation.timeSeriesL = results.timeSeries;
  } else {
    state.shoulderRotation.maxExternalRotationR = results.maxExternalRotation;
    state.shoulderRotation.maxInternalRotationR = results.maxInternalRotation;
    state.shoulderRotation.timeSeriesR = results.timeSeries;
  }

  // Update Status Text
  if (shoulderRotationStatusVal) {
    shoulderRotationStatusVal.textContent = 'Analysis Complete';
    shoulderRotationStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    shoulderRotationStatusVal.classList.add('text-emerald');
  }

  // Save/Sync state and refresh sidebar display
  updateShoulderRotationSidebarUI();

  if (state.activeProfileId) {
    const thresholds = await getROMThresholds();
    updateShoulderRotationGrades(state.shoulderRotation, thresholds);
    await autoSyncToActiveProfile(true);
  }
}

// Bind shoulder rotation button event listeners
export function setupShoulderRotationListeners(onPoseResultsCallback) {
  registerShoulderRotationDrawCallback(onPoseResultsCallback);

  if (btnShoulderRotationSideLeft) {
    btnShoulderRotationSideLeft.addEventListener('click', () => {
      state.shoulderRotationTestingSide = 'left';
      state.isShoulderRotationRecording = false; // Stop recording on side change!
      if (btnSaveShoulderRotationPeaks) {
        btnSaveShoulderRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Record Movement
        `;
        btnSaveShoulderRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      }
      if (state.liveShoulderRotationMeasurer) {
        state.liveShoulderRotationMeasurer.reset();
      }
      updateShoulderRotationSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnShoulderRotationSideRight) {
    btnShoulderRotationSideRight.addEventListener('click', () => {
      state.shoulderRotationTestingSide = 'right';
      state.isShoulderRotationRecording = false; // Stop recording on side change!
      if (btnSaveShoulderRotationPeaks) {
        btnSaveShoulderRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Record Movement
        `;
        btnSaveShoulderRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      }
      if (state.liveShoulderRotationMeasurer) {
        state.liveShoulderRotationMeasurer.reset();
      }
      updateShoulderRotationSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  const btnResetShoulderRotationPeaks = document.getElementById('btn-reset-shoulder-rotation-peaks');
  if (btnResetShoulderRotationPeaks) {
    btnResetShoulderRotationPeaks.addEventListener('click', () => {
      if (confirm("Are you sure you want to reset shoulder rotation peak data?")) {
        resetShoulderRotationPeaksUI();
      }
    });
  }

  if (btnSaveShoulderRotationPeaks) {
    btnSaveShoulderRotationPeaks.addEventListener('click', async () => {
      if (!state.activeProfileId) {
        alert("Please select or load an active athlete profile first.");
        return;
      }

      const videoElement = document.getElementById('webcam');
      const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;

      // Check current recording state
      if (!state.isShoulderRotationRecording) {
        // --- START RECORDING ---
        state.isShoulderRotationRecording = true;
        
        // Reset metrics for a clean new live recording
        if (state.liveShoulderRotationMeasurer) {
          state.liveShoulderRotationMeasurer.reset();
        }
        if (!state.shoulderRotation) {
          state.shoulderRotation = getDefaultShoulderRotation();
        }
        const side = state.shoulderRotationTestingSide || 'left';
        if (side === 'left') {
          state.shoulderRotation.maxExternalRotationL = 0;
          state.shoulderRotation.maxInternalRotationL = 0;
          state.shoulderRotation.timeSeriesL = [];
        } else {
          state.shoulderRotation.maxExternalRotationR = 0;
          state.shoulderRotation.maxInternalRotationR = 0;
          state.shoulderRotation.timeSeriesR = [];
        }
        updateShoulderRotationSidebarUI();

        if (startVideoRecordingFn) {
          startVideoRecordingFn();
        }

        // Update button UI to recording style (red stop indicator)
        btnSaveShoulderRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg>
          Stop Capture & Save
        `;
        btnSaveShoulderRotationPeaks.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';

        // Update status text
        if (shoulderRotationStatusVal) {
          shoulderRotationStatusVal.textContent = 'Recording Peak Angles...';
          shoulderRotationStatusVal.classList.remove('text-slate', 'text-emerald');
          shoulderRotationStatusVal.classList.add('text-amber');
        }
      } else {
        // --- STOP RECORDING & SAVE ---
        state.isShoulderRotationRecording = false;

        const side = state.shoulderRotationTestingSide || 'left';
        if (side === 'left') {
          state.imageShoulderRotationL = null;
        } else {
          state.imageShoulderRotationR = null;
        }

        if (stopVideoRecordingFn) {
          stopVideoRecordingFn();
        }

        // Restore button style
        btnSaveShoulderRotationPeaks.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Record Movement
        `;
        btnSaveShoulderRotationPeaks.style.background = 'linear-gradient(135deg, #10b981, #059669)';

        // Update status text
        if (shoulderRotationStatusVal) {
          shoulderRotationStatusVal.textContent = 'Analysis Complete';
          shoulderRotationStatusVal.classList.remove('text-slate', 'text-amber');
          shoulderRotationStatusVal.classList.add('text-emerald');
        }

        try {
          const thresholds = await getROMThresholds();
          updateShoulderRotationGrades(state.shoulderRotation, thresholds);
          await autoSyncToActiveProfile(true);
          alert("Shoulder rotation peak data saved successfully!");
          // openProfileDetailsModal(state.activeProfileId);
        } catch (err) {
          alert("Failed to save shoulder rotation data: " + err.message);
        }
      }
    });
  }
}
