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
   * Resets all internal buffers, recorded peaks, and cheating tracking flags.
   */
  reset() {
    this.baselineVector = null;
    this.baselineAngle = null;
    this.baselineInfo = null;
    this.facingDirection = null; // 'left' or 'right'
    this.baselineFrames = []; // Buffer to accumulate first 10 valid frames for smooth baseline
    this.maxBaselineFrames = 10;

    this.consecutiveCheatingFramesER = 0;
    this.consecutiveCheatingFramesIR = 0;
    this.CHEATING_CONFIRMATION_FRAMES = 5; // Must persist for at least 5 consecutive frames (~166ms) to avoid noise triggers
    this.MIN_CHEATING_ANGLE_DEG = 12.0; // Ignore cheating detection at neutral start position (< 12°)

    this.maxExternalRotation = 0; // Positive degrees (rotated backwards/towards head)
    this.maxInternalRotation = 0; // Positive magnitude degrees (rotated forwards/towards stomach)
    this.uncappedMaxExternalRotation = 0;
    this.uncappedMaxInternalRotation = 0;
    this.isCurrentlyCheatingER = false;
    this.isCurrentlyCheatingIR = false;
    this.currentERCheating = [];
    this.currentIRCheating = [];
    this.hasCheatedER = false;
    this.hasCheatedIR = false;
    this.allCheatingReasonsER = new Set();
    this.allCheatingReasonsIR = new Set();
    
    // Cheating timestamp tracking
    this.erCheatingStartSec = null;
    this.erCheatingEndSec = null;
    this.irCheatingStartSec = null;
    this.irCheatingEndSec = null;
    this.erCheatingRanges = [];
    this.irCheatingRanges = [];

    this.timeSeries = []; // List of { time: number, angle: number, isCheating: boolean, cheatingReasons: Array }
  }

  /**
   * Initializes or updates baseline using multi-frame accumulation for noise-free stability.
   * @param {Array} landmarks MediaPipe pose landmarks (33 points)
   * @param {string} side 'left' or 'right'
   * @returns {boolean} True if baseline was successfully set
   */
  setBaselineFrame(landmarks, side) {
    if (!landmarks) return false;
    const shoulderIdx = side === 'left' ? 11 : 12;
    const oppShoulderIdx = side === 'left' ? 12 : 11;
    const elbowIdx = side === 'left' ? 13 : 14;
    const wristIdx = side === 'left' ? 15 : 16;
    const hipIdx = side === 'left' ? 23 : 24;
    const earIdx = side === 'left' ? 7 : 8;
    const noseIdx = 0;

    const shoulder = landmarks[shoulderIdx];
    const oppShoulder = landmarks[oppShoulderIdx];
    const elbow = landmarks[elbowIdx];
    const wrist = landmarks[wristIdx];
    const hip = landmarks[hipIdx];
    const ear = landmarks[earIdx] || landmarks[noseIdx];

    if (!shoulder || !elbow || !wrist) return false;

    // Accumulate landmark frames into baseline buffer
    this.baselineFrames.push({
      shoulder: { x: shoulder.x, y: shoulder.y },
      oppShoulder: oppShoulder ? { x: oppShoulder.x, y: oppShoulder.y } : null,
      elbow: { x: elbow.x, y: elbow.y },
      wrist: { x: wrist.x, y: wrist.y },
      hip: hip ? { x: hip.x, y: hip.y } : null,
      ear: ear ? { x: ear.x, y: ear.y } : null
    });

    if (this.baselineFrames.length > this.maxBaselineFrames) {
      this.baselineFrames.shift();
    }

    // Compute averaged positions across collected baseline frames
    const count = this.baselineFrames.length;
    let avgS = { x: 0, y: 0 }, avgE = { x: 0, y: 0 }, avgW = { x: 0, y: 0 }, avgH = { x: 0, y: 0 }, avgOppS = { x: 0, y: 0 }, avgEar = { x: 0, y: 0 };
    let hipCount = 0, oppCount = 0, earCount = 0;

    this.baselineFrames.forEach(f => {
      avgS.x += f.shoulder.x; avgS.y += f.shoulder.y;
      avgE.x += f.elbow.x;    avgE.y += f.elbow.y;
      avgW.x += f.wrist.x;    avgW.y += f.wrist.y;
      if (f.hip) { avgH.x += f.hip.x; avgH.y += f.hip.y; hipCount++; }
      if (f.oppShoulder) { avgOppS.x += f.oppShoulder.x; avgOppS.y += f.oppShoulder.y; oppCount++; }
      if (f.ear) { avgEar.x += f.ear.x; avgEar.y += f.ear.y; earCount++; }
    });

    avgS = { x: avgS.x / count, y: avgS.y / count };
    avgE = { x: avgE.x / count, y: avgE.y / count };
    avgW = { x: avgW.x / count, y: avgW.y / count };
    const finalHip = hipCount > 0 ? { x: avgH.x / hipCount, y: avgH.y / hipCount } : { x: avgS.x, y: avgS.y + 0.4 };
    const finalOppS = oppCount > 0 ? { x: avgOppS.x / oppCount, y: avgOppS.y / oppCount } : null;
    const finalEar = earCount > 0 ? { x: avgEar.x / earCount, y: avgEar.y / earCount } : null;

    this.facingDirection = (avgW.x > avgE.x) ? 'right' : 'left';
    const sign = this.facingDirection === 'right' ? 1 : -1;

    const v_x = avgW.x - avgE.x;
    const v_y = avgW.y - avgE.y;

    this.baselineAngle = Math.atan2(-v_y, sign * v_x);
    this.baselineVector = { x: v_x, y: v_y };

    const upperArmLength = Math.hypot(avgE.x - avgS.x, avgE.y - avgS.y) || 0.2;
    const torsoLength = Math.hypot(finalHip.x - avgS.x, finalHip.y - avgS.y) || 0.4;
    const shoulderToEarDist = finalEar ? Math.hypot(avgS.x - finalEar.x, avgS.y - finalEar.y) : 0.15;

    let elbowToTorsoDist = 0.05;
    if (finalHip) {
      const num = Math.abs((avgS.y - finalHip.y) * avgE.x - (avgS.x - finalHip.x) * avgE.y + avgS.x * finalHip.y - avgS.y * finalHip.x);
      const den = Math.hypot(avgS.y - finalHip.y, avgS.x - finalHip.x) || 1;
      elbowToTorsoDist = num / den;
    }

    const shoulderSpanX = finalOppS ? Math.abs(avgS.x - finalOppS.x) : 0.05;

    this.baselineInfo = {
      shoulder: avgS,
      elbow: avgE,
      wrist: avgW,
      hip: finalHip,
      earRef: finalEar,
      upperArmLength,
      torsoLength,
      shoulderToEarDist,
      elbowToTorsoDist,
      shoulderSpanX,
      elbowOffsetFromShoulder: { x: avgE.x - avgS.x, y: avgE.y - avgS.y },
      facingSign: sign
    };

    return true;
  }

  /**
   * Detects External Rotation (ER) cheating indicators:
   * 1. Shoulder Abduction Drift
   * 2. Scapular Elevation (Shrugging)
   * 3. Torso Rotation
   * 4. Wrist Compensation
   * 5. Elbow Migration
   */
  detectCheatingER(landmarks, side, currentAngleDeg = 0) {
    if (!landmarks || !this.baselineInfo) return { isCheating: false, reasons: [] };
    if (Math.abs(currentAngleDeg) < this.MIN_CHEATING_ANGLE_DEG) {
      return { isCheating: false, reasons: [] };
    }

    const reasons = [];

    const shoulderIdx = side === 'left' ? 11 : 12;
    const oppShoulderIdx = side === 'left' ? 12 : 11;
    const elbowIdx = side === 'left' ? 13 : 14;
    const wristIdx = side === 'left' ? 15 : 16;
    const hipIdx = side === 'left' ? 23 : 24;
    const earIdx = side === 'left' ? 7 : 8;
    const handIdx = side === 'left' ? 19 : 20;
    const noseIdx = 0;

    const shoulder = landmarks[shoulderIdx];
    const oppShoulder = landmarks[oppShoulderIdx];
    const elbow = landmarks[elbowIdx];
    const wrist = landmarks[wristIdx];
    const hip = landmarks[hipIdx] || { x: shoulder.x, y: shoulder.y + this.baselineInfo.torsoLength };
    const ear = landmarks[earIdx] || landmarks[noseIdx];
    const hand = landmarks[handIdx];

    if (!shoulder || !elbow || !wrist) return { isCheating: false, reasons: [] };

    const b = this.baselineInfo;

    // 1. Shoulder Abduction Drift (Elbow lifts significantly away from torso)
    const num = Math.abs((shoulder.y - hip.y) * elbow.x - (shoulder.x - hip.x) * elbow.y + shoulder.x * hip.y - shoulder.y * hip.x);
    const den = Math.hypot(shoulder.y - hip.y, shoulder.x - hip.x) || 1;
    const currentElbowDist = num / den;
    const distIncrease = currentElbowDist - b.elbowToTorsoDist;
    if (distIncrease > 0.28 * b.upperArmLength) {
      reasons.push("Shoulder Abduction Drift");
    }

    // 2. Scapular Elevation (Shrugging - shoulder rises toward ear)
    if (ear && (ear.visibility === undefined || ear.visibility > 0.5)) {
      const currentEarDist = Math.hypot(shoulder.x - ear.x, shoulder.y - ear.y);
      if (b.shoulderToEarDist > 0.03 && (b.shoulderToEarDist - currentEarDist) / b.shoulderToEarDist > 0.25) {
        reasons.push("Scapular Elevation (Shrugging)");
      }
    } else if ((b.shoulder.y - shoulder.y) > 0.08 * b.torsoLength) {
      reasons.push("Scapular Elevation (Shrugging)");
    }

    // 3. Torso Rotation (Chest turns toward working arm)
    if (oppShoulder && (oppShoulder.visibility === undefined || oppShoulder.visibility > 0.5)) {
      const currentSpanX = Math.abs(shoulder.x - oppShoulder.x);
      if (currentSpanX - b.shoulderSpanX > 0.18 * b.torsoLength) {
        reasons.push("Torso Rotation");
      }
    }

    // 4. Wrist Compensation (Wrist bends/flexes to fake ER - check hand visibility)
    if (hand && (hand.visibility === undefined || hand.visibility > 0.5)) {
      const vForearm = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
      const vHand = { x: hand.x - wrist.x, y: hand.y - wrist.y };
      const dot = vForearm.x * vHand.x + vForearm.y * vHand.y;
      const magF = Math.hypot(vForearm.x, vForearm.y) || 1;
      const magH = Math.hypot(vHand.x, vHand.y) || 1;
      const cosAngle = Math.max(-1, Math.min(1, dot / (magF * magH)));
      const wristDevDeg = Math.acos(cosAngle) * (180 / Math.PI);
      if (wristDevDeg > 30) {
        reasons.push("Wrist Compensation");
      }
    }

    return {
      isCheating: reasons.length > 0,
      reasons
    };
  }

  /**
   * Detects Internal Rotation (IR) cheating indicators:
   * 1. Shoulder Protraction (Forward Roll)
   * 2. Torso Lean
   * 3. Elbow Sliding Back
   * 4. Scapular Tilt
   * 5. Lat Dominance
   */
  detectCheatingIR(landmarks, side, currentAngleDeg = 0) {
    if (!landmarks || !this.baselineInfo) return { isCheating: false, reasons: [] };
    if (Math.abs(currentAngleDeg) < this.MIN_CHEATING_ANGLE_DEG) {
      return { isCheating: false, reasons: [] };
    }

    const reasons = [];

    const shoulderIdx = side === 'left' ? 11 : 12;
    const elbowIdx = side === 'left' ? 13 : 14;
    const wristIdx = side === 'left' ? 15 : 16;
    const hipIdx = side === 'left' ? 23 : 24;
    const earIdx = side === 'left' ? 7 : 8;
    const noseIdx = 0;

    const shoulder = landmarks[shoulderIdx];
    const elbow = landmarks[elbowIdx];
    const wrist = landmarks[wristIdx];
    const hip = landmarks[hipIdx] || { x: shoulder.x, y: shoulder.y + this.baselineInfo.torsoLength };
    const ear = landmarks[earIdx] || landmarks[noseIdx];

    if (!shoulder || !elbow || !wrist) return { isCheating: false, reasons: [] };

    const b = this.baselineInfo;
    const sign = b.facingSign;

    // 1. Shoulder Protraction (Forward Roll)
    const currentForwardShift = (shoulder.x - hip.x) * sign;
    const baselineForwardShift = (b.shoulder.x - b.hip.x) * sign;
    if (currentForwardShift - baselineForwardShift > 0.14 * b.torsoLength) {
      reasons.push("Shoulder Protraction (Forward Roll)");
    }

    // 2. Torso Lean (Spine angle changes)
    const currentTorsoAngle = Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * (180 / Math.PI);
    const baselineTorsoAngle = Math.atan2(b.shoulder.x - b.hip.x, b.hip.y - b.shoulder.y) * (180 / Math.PI);
    if (Math.abs(currentTorsoAngle - baselineTorsoAngle) > 16) {
      reasons.push("Torso Lean");
    }

    // 3. Elbow Sliding Back (Elbow pulls behind rib cage)
    const currentElbowBehind = (shoulder.x - elbow.x) * sign;
    const baselineElbowBehind = (b.shoulder.x - b.elbow.x) * sign;
    if (currentElbowBehind - baselineElbowBehind > 0.18 * b.upperArmLength) {
      reasons.push("Elbow Sliding Back");
    }

    // 4. Scapular Tilt (Scapula anterior tilt & upper back arching)
    if (ear && (ear.visibility === undefined || ear.visibility > 0.5) && currentForwardShift - baselineForwardShift > 0.08 * b.torsoLength) {
      const earTorsoAngle = Math.atan2(ear.x - shoulder.x, shoulder.y - ear.y) * (180 / Math.PI);
      if (Math.abs(earTorsoAngle) > 20) {
        reasons.push("Scapular Tilt");
      }
    }

    // 5. Lat Dominance (Lats depress shoulder downward)
    const shoulderDepression = (shoulder.y - b.shoulder.y);
    if (shoulderDepression > 0.10 * b.torsoLength) {
      reasons.push("Lat Dominance");
    }

    return {
      isCheating: reasons.length > 0,
      reasons
    };
  }

  /**
   * Process a single frame and calculate the signed rotation angle relative to baseline 0°.
   * Evaluates cheating indicators with multi-frame debouncing and neutral start exemptions.
   * @param {Array} landmarks MediaPipe pose landmarks (33 points)
   * @param {string} side 'left' or 'right'
   * @param {number} timestamp Current playhead timestamp in seconds
   * @param {boolean} recordPeaks Whether to record peak values and timeseries
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

    // Establish baseline dynamically using initial frames
    if (!this.baselineVector || this.baselineFrames.length < this.maxBaselineFrames) {
      this.setBaselineFrame(landmarks, side);
      if (!this.baselineVector) return null;
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

    // Evaluate cheating indicators with multi-frame debouncing filter
    if (angleDeg > 0) {
      // External Rotation
      const erCheck = this.detectCheatingER(landmarks, side, angleDeg);
      if (erCheck.isCheating) {
        this.consecutiveCheatingFramesER++;
      } else {
        this.consecutiveCheatingFramesER = 0;
      }

      const isConfirmedCheating = this.consecutiveCheatingFramesER >= this.CHEATING_CONFIRMATION_FRAMES;
      this.isCurrentlyCheatingER = isConfirmedCheating;
      this.currentERCheating = isConfirmedCheating ? erCheck.reasons : [];
      this.isCurrentlyCheatingIR = false;
      this.currentIRCheating = [];

      this.uncappedMaxExternalRotation = Math.max(this.uncappedMaxExternalRotation, angleDeg);

      if (isConfirmedCheating) {
        this.hasCheatedER = true;
        erCheck.reasons.forEach(r => this.allCheatingReasonsER.add(r));
        if (this.erCheatingStartSec === null) {
          this.erCheatingStartSec = timestamp;
        }
        this.erCheatingEndSec = timestamp;
        // DO NOT update maxExternalRotation! Mark value where we last saw no cheating!
      } else {
        if (this.erCheatingStartSec !== null) {
          this.erCheatingRanges.push({ start: this.erCheatingStartSec, end: this.erCheatingEndSec });
          this.erCheatingStartSec = null;
        }
        if (recordPeaks) {
          if (angleDeg > this.maxExternalRotation) {
            this.maxExternalRotation = angleDeg;
          }
        }
      }
    } else {
      // Internal Rotation (angleDeg <= 0)
      const absAngle = Math.abs(angleDeg);
      const irCheck = this.detectCheatingIR(landmarks, side, angleDeg);
      if (irCheck.isCheating) {
        this.consecutiveCheatingFramesIR++;
      } else {
        this.consecutiveCheatingFramesIR = 0;
      }

      const isConfirmedCheating = this.consecutiveCheatingFramesIR >= this.CHEATING_CONFIRMATION_FRAMES;
      this.isCurrentlyCheatingIR = isConfirmedCheating;
      this.currentIRCheating = isConfirmedCheating ? irCheck.reasons : [];
      this.isCurrentlyCheatingER = false;
      this.currentERCheating = [];

      this.uncappedMaxInternalRotation = Math.max(this.uncappedMaxInternalRotation, absAngle);

      if (isConfirmedCheating) {
        this.hasCheatedIR = true;
        irCheck.reasons.forEach(r => this.allCheatingReasonsIR.add(r));
        if (this.irCheatingStartSec === null) {
          this.irCheatingStartSec = timestamp;
        }
        this.irCheatingEndSec = timestamp;
        // DO NOT update maxInternalRotation! Mark value where we last saw no cheating!
      } else {
        if (this.irCheatingStartSec !== null) {
          this.irCheatingRanges.push({ start: this.irCheatingStartSec, end: this.irCheatingEndSec });
          this.irCheatingStartSec = null;
        }
        if (recordPeaks) {
          if (absAngle > this.maxInternalRotation) {
            this.maxInternalRotation = absAngle;
          }
        }
      }
    }

    if (recordPeaks) {
      this.timeSeries.push({
        time: parseFloat(timestamp.toFixed(3)),
        angle: parseFloat(angleDeg.toFixed(1)),
        isCheating: this.isCurrentlyCheatingER || this.isCurrentlyCheatingIR,
        cheatingReasons: this.isCurrentlyCheatingER ? [...this.currentERCheating] : [...this.currentIRCheating]
      });
    }

    return parseFloat(angleDeg.toFixed(1));
  }

  getCurrentCheatingRangeER() {
    let ranges = [...this.erCheatingRanges];
    if (this.erCheatingStartSec !== null) {
      ranges.push({ start: this.erCheatingStartSec, end: this.erCheatingEndSec || this.erCheatingStartSec });
    }
    if (ranges.length === 0) return null;
    const minStart = Math.min(...ranges.map(r => r.start));
    const maxEnd = Math.max(...ranges.map(r => r.end));
    return formatRange(minStart, maxEnd);
  }

  getCurrentCheatingRangeIR() {
    let ranges = [...this.irCheatingRanges];
    if (this.irCheatingStartSec !== null) {
      ranges.push({ start: this.irCheatingStartSec, end: this.irCheatingEndSec || this.irCheatingStartSec });
    }
    if (ranges.length === 0) return null;
    const minStart = Math.min(...ranges.map(r => r.start));
    const maxEnd = Math.max(...ranges.map(r => r.end));
    return formatRange(minStart, maxEnd);
  }

  /**
   * Fetches the analyzed peaks, cheating records, and timeseries results.
   * @returns {Object}
   */
  getResults() {
    return {
      maxExternalRotation: parseFloat(this.maxExternalRotation.toFixed(1)),
      maxInternalRotation: parseFloat(this.maxInternalRotation.toFixed(1)),
      uncappedMaxExternalRotation: parseFloat(this.uncappedMaxExternalRotation.toFixed(1)),
      uncappedMaxInternalRotation: parseFloat(this.uncappedMaxInternalRotation.toFixed(1)),
      hasCheatedER: this.hasCheatedER,
      hasCheatedIR: this.hasCheatedIR,
      cheatingReasonsER: Array.from(this.allCheatingReasonsER),
      cheatingReasonsIR: Array.from(this.allCheatingReasonsIR),
      cheatingRangeER: this.getCurrentCheatingRangeER(),
      cheatingRangeIR: this.getCurrentCheatingRangeIR(),
      timeSeries: this.timeSeries
    };
  }
}

function formatTime(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRange(startSec, endSec) {
  return `${formatTime(startSec)} - ${formatTime(endSec)}`;
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
    cheatingL: existing?.cheatingL ?? { hasCheatedER: false, hasCheatedIR: false, reasonsER: [], reasonsIR: [], rangeER: null, rangeIR: null },
    cheatingR: existing?.cheatingR ?? { hasCheatedER: false, hasCheatedIR: false, reasonsER: [], reasonsIR: [], rangeER: null, rangeIR: null },
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

  // Update cheating alert box in sidebar
  const alertBox = document.getElementById('shoulder-rotation-cheating-alert');
  const alertReasons = document.getElementById('shoulder-rotation-cheating-reasons');
  const alertTypeBadge = document.getElementById('shoulder-rotation-cheating-type-badge');
  const alertTimestamp = document.getElementById('shoulder-rotation-cheating-timestamp');
  const alertCappedNote = document.getElementById('shoulder-rotation-capped-note');

  const side = state.shoulderRotationTestingSide || 'left';
  const cheatingInfo = side === 'left' ? p.cheatingL : p.cheatingR;

  const liveM = state.liveShoulderRotationMeasurer;
  const isLiveCheating = liveM && (liveM.isCurrentlyCheatingER || liveM.isCurrentlyCheatingIR);

  if (isLiveCheating) {
    if (alertBox) alertBox.classList.remove('hidden');
    const reasons = liveM.isCurrentlyCheatingER ? liveM.currentERCheating : liveM.currentIRCheating;
    const typeStr = liveM.isCurrentlyCheatingER ? 'External Rotation' : 'Internal Rotation';
    const rangeStr = liveM.isCurrentlyCheatingER ? liveM.getCurrentCheatingRangeER() : liveM.getCurrentCheatingRangeIR();
    const validPeak = liveM.isCurrentlyCheatingER ? liveM.maxExternalRotation : liveM.maxInternalRotation;

    if (alertTypeBadge) alertTypeBadge.textContent = typeStr;
    if (alertTimestamp) alertTimestamp.textContent = rangeStr ? `@ ${rangeStr}` : '';
    if (alertReasons) alertReasons.innerHTML = reasons.map(r => `• ${r}`).join('<br>');
    if (alertCappedNote) alertCappedNote.textContent = `Peak marked at last uncheated angle: ${Math.round(validPeak)}°`;
  } else if (cheatingInfo && (cheatingInfo.hasCheatedER || cheatingInfo.hasCheatedIR)) {
    if (alertBox) alertBox.classList.remove('hidden');
    const allReasons = [];
    const dirParts = [];
    let rangeStr = '';

    if (cheatingInfo.hasCheatedER) {
      dirParts.push('External Rotation');
      allReasons.push(...(cheatingInfo.reasonsER || []));
      if (cheatingInfo.rangeER) rangeStr = cheatingInfo.rangeER;
    }
    if (cheatingInfo.hasCheatedIR) {
      dirParts.push('Internal Rotation');
      allReasons.push(...(cheatingInfo.reasonsIR || []));
      if (cheatingInfo.rangeIR) {
        rangeStr = rangeStr ? `${rangeStr}, ${cheatingInfo.rangeIR}` : cheatingInfo.rangeIR;
      }
    }

    if (alertTypeBadge) alertTypeBadge.textContent = dirParts.join(' & ');
    if (alertTimestamp) alertTimestamp.textContent = rangeStr ? `@ ${rangeStr}` : '';
    if (alertReasons) alertReasons.innerHTML = [...new Set(allReasons)].map(r => `• ${r}`).join('<br>');
    if (alertCappedNote) alertCappedNote.textContent = `Recorded peaks reflect maximum uncheated angles.`;
  } else {
    if (alertBox) alertBox.classList.add('hidden');
  }
}

export async function resetShoulderRotationPeaksUI() {
  if (!state.shoulderRotation) {
    state.shoulderRotation = getDefaultShoulderRotation();
  }
  const side = state.shoulderRotationTestingSide || 'left';
  if (side === 'left') {
    state.shoulderRotation.maxExternalRotationL = 0;
    state.shoulderRotation.maxInternalRotationL = 0;
    state.shoulderRotation.cheatingL = { hasCheatedER: false, hasCheatedIR: false, reasonsER: [], reasonsIR: [] };
    state.shoulderRotation.timeSeriesL = [];
    state.imageShoulderRotationL = null;
  } else {
    state.shoulderRotation.maxExternalRotationR = 0;
    state.shoulderRotation.maxInternalRotationR = 0;
    state.shoulderRotation.cheatingR = { hasCheatedER: false, hasCheatedIR: false, reasonsER: [], reasonsIR: [] };
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
    state.shoulderRotation.cheatingL = {
      hasCheatedER: results.hasCheatedER,
      hasCheatedIR: results.hasCheatedIR,
      reasonsER: results.cheatingReasonsER,
      reasonsIR: results.cheatingReasonsIR,
      rangeER: results.cheatingRangeER,
      rangeIR: results.cheatingRangeIR,
      uncappedER: results.uncappedMaxExternalRotation,
      uncappedIR: results.uncappedMaxInternalRotation
    };
    state.shoulderRotation.timeSeriesL = results.timeSeries;
  } else {
    state.shoulderRotation.maxExternalRotationR = results.maxExternalRotation;
    state.shoulderRotation.maxInternalRotationR = results.maxInternalRotation;
    state.shoulderRotation.cheatingR = {
      hasCheatedER: results.hasCheatedER,
      hasCheatedIR: results.hasCheatedIR,
      reasonsER: results.cheatingReasonsER,
      reasonsIR: results.cheatingReasonsIR,
      rangeER: results.cheatingRangeER,
      rangeIR: results.cheatingRangeIR,
      uncappedER: results.uncappedMaxExternalRotation,
      uncappedIR: results.uncappedMaxInternalRotation
    };
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
