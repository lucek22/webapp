// ==========================================
// USER CONTROLLER: CANVAS DRAWS & EVENT LISTENERS
// ==========================================

import {
  state,
  snapshotStore,
  LANDMARK_NAMES,
  POSE_CONNECTIONS,
  FINGER_COLORS,
  MARKER_PHYSICAL_SIZE_CM,
  smooth,
  getCanvasX,
  formatLength,
  updateHeightInputUnit,
  formatSkeletalHeight,
  triggerFlashEffect,
  drawRoundedRect,
  getDomMeasurementCm
} from './helpers.js';

import { detectArucoMarker } from './arucoDetector.js';
import { pose, hands, calculatePoseMetrics } from './mediapipeLogic.js';
import { downloadSnapshotImage, compileAndDownloadCombinedSession } from './reportCompiler.js';

export const videoElement = document.getElementById('webcam');
export const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('start-btn');
const yoloToggleBtn = document.getElementById('yolo-toggle-btn');
const captureBtn = document.getElementById('capture-btn');
export const statusElement = document.getElementById('status');

// Helper canvas for caching frozen frames
export const frozenFrameCanvas = document.createElement('canvas');
frozenFrameCanvas.width = 640;
frozenFrameCanvas.height = 480;
const frozenFrameCtx = frozenFrameCanvas.getContext('2d');

const slider = document.getElementById('box-slider');
const sliderValDisplay = document.getElementById('slider-val');
const lockCalButton = document.getElementById('lock-cal-btn');
const landmarkDirectory = document.getElementById('landmark-directory');

canvasElement.width = 640;
canvasElement.height = 480;

// Initialize Landmark Directory (33 Pose Landmarks + 10 Hand Fingertips) on load
if (landmarkDirectory) {
  LANDMARK_NAMES.forEach((name, idx) => {
    const item = document.createElement('div');
    item.className = 'landmark-directory-item';
    
    let colorClass = 'gray'; // default face/neutral
    if (idx <= 10) {
      colorClass = 'pink'; // face
    } else if (idx === 11 || idx === 13 || idx === 15 || idx === 17 || idx === 19 || idx === 21) {
      colorClass = 'cyan'; // left arm
    } else if (idx === 12 || idx === 14 || idx === 16 || idx === 18 || idx === 20 || idx === 22) {
      colorClass = 'gold'; // right arm
    } else if (idx === 23 || idx === 25 || idx === 27 || idx === 29 || idx === 31) {
      colorClass = 'emerald'; // left leg
    } else if (idx === 24 || idx === 26 || idx === 28 || idx === 30 || idx === 32) {
      colorClass = 'amber'; // right leg
    }
    item.classList.add(colorClass);

    item.innerHTML = `
      <span class="landmark-name">#${idx} ${name}</span>
      <span id="lm-status-${idx}" class="landmark-status-offline">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });

  // Append Left Hand Fingertips
  const handFingersL = [
    { name: 'Thumb Tip', colorClass: 'pink', id: 'val-fingertip-l-0' },
    { name: 'Index Tip', colorClass: 'cyan', id: 'val-fingertip-l-1' },
    { name: 'Middle Tip', colorClass: 'gold', id: 'val-fingertip-l-2' },
    { name: 'Ring Tip', colorClass: 'emerald', id: 'val-fingertip-l-3' },
    { name: 'Pinky Tip', colorClass: 'amber', id: 'val-fingertip-l-4' }
  ];

  handFingersL.forEach(f => {
    const item = document.createElement('div');
    item.className = `landmark-directory-item ${f.colorClass}`;
    
    item.innerHTML = `
      <span class="landmark-name">Left ${f.name}</span>
      <span id="${f.id}" class="landmark-status-offline">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });

  // Append Right Hand Fingertips
  const handFingersR = [
    { name: 'Thumb Tip', colorClass: 'pink', id: 'val-fingertip-r-0' },
    { name: 'Index Tip', colorClass: 'cyan', id: 'val-fingertip-r-1' },
    { name: 'Middle Tip', colorClass: 'gold', id: 'val-fingertip-r-2' },
    { name: 'Ring Tip', colorClass: 'emerald', id: 'val-fingertip-r-3' },
    { name: 'Pinky Tip', colorClass: 'amber', id: 'val-fingertip-r-4' }
  ];

  handFingersR.forEach(f => {
    const item = document.createElement('div');
    item.className = `landmark-directory-item ${f.colorClass}`;
    
    item.innerHTML = `
      <span class="landmark-name">Right ${f.name}</span>
      <span id="${f.id}" class="landmark-status-offline">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });
}

// UI Metric Elements (LEFT)
const thighLDisp = document.getElementById('val-thigh-l');
const shinLDisp = document.getElementById('val-shin-l');
const footLDisp = document.getElementById('val-foot-l');
const torsoLDisp = document.getElementById('val-torso-l');
const upperarmLDisp = document.getElementById('val-upperarm-l');
const forearmLDisp = document.getElementById('val-forearm-l');

// UI Metric Elements (RIGHT)
const thighRDisp = document.getElementById('val-thigh-r');
const shinRDisp = document.getElementById('val-shin-r');
const footRDisp = document.getElementById('val-foot-r');
const torsoRDisp = document.getElementById('val-torso-r');
const upperarmRDisp = document.getElementById('val-upperarm-r');
const forearmRDisp = document.getElementById('val-forearm-r');

// Widths & Other
const fingerToToeDisp = document.getElementById('val-finger-to-toe');
const hipWDisp = document.getElementById('val-hip-w');
const wingspanDisp = document.getElementById('val-wingspan');
const heightCmDisp = document.getElementById('val-height-cm');
const heightFtDisp = document.getElementById('val-height-ft');

// UI Angle Elements (Left vs Right)
const kneeAngleLDisp = document.getElementById('angle-knee-l');
const kneeAngleRDisp = document.getElementById('angle-knee-r');
const hipAngleLDisp = document.getElementById('angle-hip-l');
const hipAngleRDisp = document.getElementById('angle-hip-r');
const elbowAngleLDisp = document.getElementById('angle-elbow-l');
const elbowAngleRDisp = document.getElementById('angle-elbow-r');

// UI Calibration Toggles & Panels
const tabArucoBtn = document.getElementById('tab-aruco-btn');
const tabHeightBtn = document.getElementById('tab-height-btn');
const tabValidationBtn = document.getElementById('tab-validation-btn');

const panelAruco = document.getElementById('panel-aruco');
const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const panelValidation = document.getElementById('panel-validation');

const arucoStatusText = document.getElementById('aruco-status-text');
const validationStatusText = document.getElementById('validation-status-text');
const validationFeedbackBox = document.getElementById('validation-feedback-box');
const validationHeightLabel = document.getElementById('validation-height-label');
const inputValidationHeight = document.getElementById('input-validation-height');

// ==========================================
// CANVAS DRAWING COMPONENT UTILITIES
// ==========================================

function drawJoint(point, color) {
  canvasCtx.beginPath();
  canvasCtx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
  canvasCtx.fillStyle = color;
  canvasCtx.fill();
  canvasCtx.strokeStyle = 'white';
  canvasCtx.lineWidth = 1.5;
  canvasCtx.stroke();
}

function drawBone(p1, p2, color) {
  canvasCtx.beginPath();
  canvasCtx.moveTo(p1.x, p1.y);
  canvasCtx.lineTo(p2.x, p2.y);
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 3.5;
  canvasCtx.stroke();
}

export function drawFullSkeletalMesh(landmarks) {
  if (!landmarks || landmarks.length < 33) return;

  // 1. Draw thin, semi-transparent skeletal mesh connections
  canvasCtx.beginPath();
  POSE_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2) {
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(p2.x, p2.y);
    }
  });
  canvasCtx.strokeStyle = 'rgba(99, 102, 241, 0.45)'; // Sleek translucent indigo vector line
  canvasCtx.lineWidth = 1.5;
  canvasCtx.stroke();

  // 2. Draw all 33 pose landmark nodes with color-coded glowing aesthetics
  landmarks.forEach((p, idx) => {
    if (!p) return;
    
    let color = '#6366f1'; // Default Indigo
    if (idx <= 10) {
      color = '#ec4899'; // Head/Face landmarks: Bright Pink
    } else if (idx === 11 || idx === 13 || idx === 15 || idx === 17 || idx === 19 || idx === 21) {
      color = '#06b6d4'; // Left Arm: Neon Cyan
    } else if (idx === 12 || idx === 14 || idx === 16 || idx === 18 || idx === 20 || idx === 22) {
      color = '#d4a017'; // Right Arm: Neon Warm Gold
    } else if (idx === 23 || idx === 25 || idx === 27 || idx === 29 || idx === 31) {
      color = '#10b981'; // Left Leg/Foot: Neon Emerald
    } else if (idx === 24 || idx === 26 || idx === 28 || idx === 30 || idx === 32) {
      color = '#f59e0b'; // Right Leg/Foot: Neon Amber
    }

    // Render glowing nodes
    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
    canvasCtx.fillStyle = color;
    canvasCtx.fill();
    canvasCtx.strokeStyle = '#ffffff';
    canvasCtx.lineWidth = 1.0;
    canvasCtx.stroke();
  });
}

export function drawHandMesh(multiHandLandmarks, multiHandedness) {
  if (!multiHandLandmarks) return;

  multiHandLandmarks.forEach((landmarks, handIdx) => {
    const handedness = multiHandedness ? multiHandedness[handIdx] : null;
    const isLeft = handedness ? handedness.label === 'Left' : true;
    const sidePrefix = isLeft ? 'L' : 'R';

    const height = state.canvasHeight || 480;
    const pts = landmarks.map(lm => ({ x: getCanvasX(lm.x), y: lm.y * height }));

    canvasCtx.beginPath();
    canvasCtx.moveTo(pts[0].x, pts[0].y);
    canvasCtx.lineTo(pts[1].x, pts[1].y);
    canvasCtx.lineTo(pts[5].x, pts[5].y);
    canvasCtx.lineTo(pts[9].x, pts[9].y);
    canvasCtx.lineTo(pts[13].x, pts[13].y);
    canvasCtx.lineTo(pts[17].x, pts[17].y);
    canvasCtx.closePath();
    canvasCtx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.stroke();
    canvasCtx.fillStyle = 'rgba(99, 102, 241, 0.05)';
    canvasCtx.fill();

    const drawFingerBones = (indices, color) => {
      canvasCtx.beginPath();
      canvasCtx.moveTo(pts[indices[0]].x, pts[indices[0]].y);
      for (let i = 1; i < indices.length; i++) {
        canvasCtx.lineTo(pts[indices[i]].x, pts[indices[i]].y);
      }
      canvasCtx.strokeStyle = color + '80';
      canvasCtx.lineWidth = 2.0;
      canvasCtx.stroke();
    };

    drawFingerBones([1, 2, 3, 4], FINGER_COLORS.thumb);
    drawFingerBones([5, 6, 7, 8], FINGER_COLORS.index);
    drawFingerBones([9, 10, 11, 12], FINGER_COLORS.middle);
    drawFingerBones([13, 14, 15, 16], FINGER_COLORS.ring);
    drawFingerBones([17, 18, 19, 20], FINGER_COLORS.pinky);

    pts.forEach((pt, idx) => {
      if ([4, 8, 12, 16, 20].includes(idx)) return;
      if (idx === 0) {
        canvasCtx.beginPath();
        canvasCtx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#6366f1';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ffffff';
        canvasCtx.lineWidth = 1.0;
        canvasCtx.stroke();
        return;
      }

      let color = '#6366f1';
      if (idx >= 1 && idx <= 3) color = FINGER_COLORS.thumb;
      else if (idx >= 5 && idx <= 7) color = FINGER_COLORS.index;
      else if (idx >= 9 && idx <= 11) color = FINGER_COLORS.middle;
      else if (idx >= 13 && idx <= 15) color = FINGER_COLORS.ring;
      else if (idx >= 17 && idx <= 19) color = FINGER_COLORS.pinky;

      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 2.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = color;
      canvasCtx.fill();
    });

    const tips = [
      { idx: 4, color: FINGER_COLORS.thumb, label: sidePrefix + ' Thumb' },
      { idx: 8, color: FINGER_COLORS.index, label: sidePrefix + ' Index' },
      { idx: 12, color: FINGER_COLORS.middle, label: sidePrefix + ' Middle' },
      { idx: 16, color: FINGER_COLORS.ring, label: sidePrefix + ' Ring' },
      { idx: 20, color: FINGER_COLORS.pinky, label: sidePrefix + ' Pinky' }
    ];

    tips.forEach(tip => {
      const pt = pts[tip.idx];
      
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 7, 0, 2 * Math.PI);
      canvasCtx.fillStyle = tip.color + '40';
      canvasCtx.fill();

      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = tip.color;
      canvasCtx.fill();
      canvasCtx.strokeStyle = '#ffffff';
      canvasCtx.lineWidth = 1.0;
      canvasCtx.stroke();
    });
  });
}

function drawRulerGraphics(ruler_x, head_top, ground_y, live_height, live_feet_inches_str, heel_l, heel_r) {
  // Vertical indicator line
  canvasCtx.beginPath();
  canvasCtx.moveTo(ruler_x, head_top.y);
  canvasCtx.lineTo(ruler_x, ground_y);
  canvasCtx.strokeStyle = '#06b6d4';
  canvasCtx.lineWidth = 2.5;
  canvasCtx.stroke();

  // Top bracket
  canvasCtx.beginPath();
  canvasCtx.moveTo(ruler_x - 10, head_top.y);
  canvasCtx.lineTo(ruler_x + 10, head_top.y);
  canvasCtx.stroke();

  // Bottom bracket
  canvasCtx.beginPath();
  canvasCtx.moveTo(ruler_x - 10, ground_y);
  canvasCtx.lineTo(ruler_x + 10, ground_y);
  canvasCtx.stroke();

  // Text labels along ruler
  canvasCtx.fillStyle = '#06b6d4';
  canvasCtx.font = 'bold 11px sans-serif';
  const rulerLabel = state.useInches ? live_feet_inches_str : `${live_height.toFixed(1)} cm`;
  canvasCtx.fillText(`Live: ${rulerLabel}`, ruler_x > 320 ? ruler_x + 15 : ruler_x - (state.useInches ? 95 : 80), (head_top.y + ground_y) / 2);

  // Connecting indicator line from head to ruler
  canvasCtx.beginPath();
  canvasCtx.moveTo(head_top.x, head_top.y);
  canvasCtx.lineTo(ruler_x, head_top.y);
  canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);

  // Connecting indicator line from ground contact center to ruler
  canvasCtx.beginPath();
  canvasCtx.moveTo((heel_l.x + heel_r.x)/2, ground_y);
  canvasCtx.lineTo(ruler_x, ground_y);
  canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);
}

function drawPoseBadge(poseName) {
  canvasCtx.save();
  canvasCtx.translate(20, 20);
  canvasCtx.fillStyle = 'rgba(15, 22, 38, 0.75)';
  let accentColor = '#818cf8'; // Default A-Pose: Violet
  if (poseName === "T-Pose") accentColor = '#06b6d4'; // Cyan
  if (poseName === "Overhead Reach") accentColor = '#10b981'; // Emerald
  
  canvasCtx.strokeStyle = accentColor;
  canvasCtx.lineWidth = 1.5;
  drawRoundedRect(canvasCtx, 0, 0, 160, 38, 6);
  canvasCtx.fill();
  canvasCtx.stroke();

  // Pulsating status dot
  const radius = 3.5;
  const pulse = radius + 1.0 * Math.sin(Date.now() / 250);
  canvasCtx.beginPath();
  canvasCtx.arc(18, 19, pulse, 0, 2 * Math.PI);
  canvasCtx.fillStyle = accentColor + '40';
  canvasCtx.fill();

  canvasCtx.beginPath();
  canvasCtx.arc(18, 19, 2.5, 0, 2 * Math.PI);
  canvasCtx.fillStyle = accentColor;
  canvasCtx.fill();

  canvasCtx.fillStyle = '#ffffff';
  canvasCtx.font = 'bold 9px sans-serif';
  canvasCtx.textAlign = 'left';
  canvasCtx.textBaseline = 'middle';
  canvasCtx.fillText("DETECTED POSE:", 32, 13);

  canvasCtx.fillStyle = accentColor;
  canvasCtx.font = 'bold 11px sans-serif';
  canvasCtx.fillText(poseName.toUpperCase(), 32, 25);
  canvasCtx.restore();
}

export function renderDashboard(metrics) {
  if (!metrics) return;

  // Render Left/Right segment lengths
  thighLDisp.textContent = formatLength(metrics.thigh_l);
  thighRDisp.textContent = formatLength(metrics.thigh_r);
  shinLDisp.textContent = formatLength(metrics.shin_l);
  shinRDisp.textContent = formatLength(metrics.shin_r);
  footLDisp.textContent = formatLength(metrics.foot_l);
  footRDisp.textContent = formatLength(metrics.foot_r);
  
  torsoLDisp.textContent = formatLength(metrics.torso_l);
  torsoRDisp.textContent = formatLength(metrics.torso_r);
  upperarmLDisp.textContent = formatLength(metrics.upperarm_l);
  upperarmRDisp.textContent = formatLength(metrics.upperarm_r);
  forearmLDisp.textContent = formatLength(metrics.forearm_l);
  forearmRDisp.textContent = formatLength(metrics.forearm_r);

  if (fingerToToeDisp) {
    fingerToToeDisp.textContent = `L: ${formatLength(metrics.fingerToToeL)} / R: ${formatLength(metrics.fingerToToeR)}`;
  }
  hipWDisp.textContent = formatLength(metrics.hipW);
  if (wingspanDisp) {
    wingspanDisp.textContent = metrics.wingspan ? formatLength(metrics.wingspan) : "--.- cm";
  }

  // Render active pose
  const activePoseDisp = document.getElementById('val-active-pose');
  if (activePoseDisp) {
    activePoseDisp.textContent = metrics.pose || "A-Pose";
    activePoseDisp.classList.remove('text-cyan', 'text-emerald', 'text-violet');
    if (metrics.pose === "T-Pose") {
      activePoseDisp.classList.add('text-cyan');
    } else if (metrics.pose === "Overhead Reach") {
      activePoseDisp.classList.add('text-emerald');
    } else {
      activePoseDisp.classList.add('text-violet');
    }
  }

  // Render height
  const skeletal_inches = metrics.skeletal_height / 2.54;
  const skeletal_feet = Math.floor(skeletal_inches / 12);
  const skeletal_inches_left = skeletal_inches % 12;
  const skeletal_feet_inches_str = `${skeletal_feet}' ${skeletal_inches_left.toFixed(1)}"`;

  if (state.useInches) {
    heightCmDisp.textContent = skeletal_feet_inches_str;
    heightFtDisp.textContent = `${metrics.skeletal_height.toFixed(1)} cm (Stature)`;
  } else {
    heightCmDisp.textContent = `${metrics.skeletal_height.toFixed(1)} cm`;
    heightFtDisp.textContent = `${skeletal_feet_inches_str} (Stature)`;
  }

  // Render angles
  kneeAngleLDisp.textContent = `${metrics.kneeAngleL}°`;
  kneeAngleRDisp.textContent = `${metrics.kneeAngleR}°`;
  hipAngleLDisp.textContent = `${metrics.hipAngleL}°`;
  hipAngleRDisp.textContent = `${metrics.hipAngleR}°`;
  elbowAngleLDisp.textContent = `${metrics.elbowAngleL}°`;
  elbowAngleRDisp.textContent = `${metrics.elbowAngleR}°`;
}

// ==========================================
// POSE EVENT DISPATCH COORDINATOR
// ==========================================

export function onPoseResults(results) {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  const now = Date.now();
  const dt = now - state.lastFrameTime;
  state.lastFrameTime = now;

  if (state.autoActive && state.lockoutTimerMs > 0) {
    state.lockoutTimerMs -= dt;
    if (state.lockoutTimerMs < 0) state.lockoutTimerMs = 0;
    
    // Draw the frozen snapshot
    const tempJoints = state.frozenJoints;
    const tempMetrics = state.frozenMetrics;
    state.frozenJoints = state.frozenAutoJoints;
    state.frozenMetrics = state.frozenAutoMetrics;
    drawFrozenSnapshot();
    state.frozenJoints = tempJoints; // restore
    state.frozenMetrics = tempMetrics;
    
    // Draw transition instruction text & progress bar
    drawLockoutTransitionOverlay();
    
    canvasCtx.restore();
    
    // Transition state once lockout ends
    if (state.lockoutTimerMs === 0) {
      if (state.autoState === 'WAITING_A') {
        state.autoState = 'WAITING_T';
        state.holdTimerMs = 0;
        statusElement.textContent = "A-Pose captured! Please stand in T-Pose (arms extended horizontally at shoulder level).";
      } else if (state.autoState === 'WAITING_T') {
        state.autoState = 'WAITING_OVERHEAD';
        state.holdTimerMs = 0;
        statusElement.textContent = "T-Pose captured! Please stand in Overhead Reach (arms extended straight up above your head).";
      } else if (state.autoState === 'WAITING_OVERHEAD') {
        state.autoState = 'COMPLETE';
        statusElement.textContent = "All poses captured! Compiling session report...";
        
        // Compile and download consolidated session report JSON
        compileAndDownloadCombinedSession();
        
        // Save the consolidated report to local IndexedDB gallery
        saveCombinedSessionSnapshot();
        
        // End flow after 3 seconds
        setTimeout(() => {
          cancelAutoSequence();
        }, 3000);
      }
    }
    return;
  }

  // YOLO-style Background Masking
  if (results.segmentationMask && state.yoloModeActive) {
    canvasCtx.save();
    if (state.currentFacingMode === "user") {
      canvasCtx.translate(canvasElement.width, 0);
      canvasCtx.scale(-1, 1);
    }
    canvasCtx.drawImage(results.segmentationMask, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.globalCompositeOperation = 'source-in';
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.globalCompositeOperation = 'source-over';
    canvasCtx.restore();
  }

  if (state.latestArucoMarker && (state.activeCalMethod === 'aruco' || state.activeCalMethod === 'validation')) {
    const width = state.canvasWidth || 640;
    const corners = state.latestArucoMarker.corners.map(c => ({
      x: state.currentFacingMode === "user" ? width - c.x : c.x,
      y: c.y
    }));
    canvasCtx.beginPath();
    canvasCtx.moveTo(corners[0].x, corners[0].y);
    canvasCtx.lineTo(corners[1].x, corners[1].y);
    canvasCtx.lineTo(corners[2].x, corners[2].y);
    canvasCtx.lineTo(corners[3].x, corners[3].y);
    canvasCtx.closePath();
    canvasCtx.strokeStyle = '#10b981';
    canvasCtx.lineWidth = 3.5;
    canvasCtx.stroke();

    canvasCtx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    canvasCtx.fill();

    canvasCtx.fillStyle = '#10b981';
    canvasCtx.font = 'bold 11px sans-serif';
    canvasCtx.fillText(`ARUCO ID 0 DETECTED (${formatLength(20.0)})`, corners[0].x, corners[0].y - 8);
  }

  // 1. Draw Direct Card Calibration Guide Box (only if state.activeCalMethod is 'card')
  if (state.activeCalMethod === 'card') {
    const x1 = state.calBoxX - state.calBoxSize / 2;
    const y1 = state.calBoxY - state.calBoxSize / 2;
    
    canvasCtx.beginPath();
    canvasCtx.rect(x1, y1, state.calBoxSize, state.calBoxSize);
    canvasCtx.strokeStyle = state.calLocked ? '#10b981' : '#ec4899'; 
    canvasCtx.lineWidth = 3;
    if (!state.calLocked) canvasCtx.setLineDash([6, 4]);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]); 

    // Calibration box label
    canvasCtx.fillStyle = state.calLocked ? '#10b981' : '#ec4899';
    canvasCtx.font = 'bold 11px sans-serif';
    canvasCtx.fillText(state.calLocked ? "SCARLET CALIBRATION LOCKED" : "ALIGN PRINTED 200mm SQUARE IN BOX", x1 + 5, y1 - 8);
  }

  // 2. Perform Biomechanical mathematical updates
  if (typeof calculatePoseMetrics === 'function') {
    const calculated = calculatePoseMetrics(results);

    if (calculated) {
      const {
        shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
        shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
        head_top, ground_y, all_landmarks,
        kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
        liveMetrics
      } = calculated;

      // Update Landmark Directory status in a throttled way
      state.frameCount++;
      if (state.frameCount % 10 === 0) {
        LANDMARK_NAMES.forEach((name, idx) => {
          const statusSpan = document.getElementById(`lm-status-${idx}`);
          if (statusSpan) {
            const landmark = results.poseLandmarks[idx];
            statusSpan.classList.remove('text-emerald', 'text-amber', 'text-slate');
            if (landmark && landmark.visibility > 0.5) {
              statusSpan.textContent = "Online";
              statusSpan.classList.add('text-emerald');
            } else if (landmark) {
              statusSpan.textContent = "Low Vis";
              statusSpan.classList.add('text-amber');
            } else {
              statusSpan.textContent = "Offline";
              statusSpan.classList.add('text-slate');
            }
          }
        });
      }

      // Draw standard skeletal mesh elements
      drawFullSkeletalMesh(all_landmarks);

      // --- DRAW NEON SKELETAL MARKERS ---
      // Shoulder and Hip spans
      drawBone(shoulder_l, shoulder_r, '#d4a017'); 
      drawBone(hip_l, hip_r, '#d4a017'); 
      
      // Torso Lines
      drawBone(shoulder_l, hip_l, '#38bdf8'); 
      drawBone(shoulder_r, hip_r, '#38bdf8'); 

      // Left Arm & Leg
      drawBone(shoulder_l, elbow_l, '#ec4899'); 
      drawBone(elbow_l, wrist_l, '#f43f5e'); 
      drawBone(hip_l, knee_l, '#d4a017'); 
      drawBone(knee_l, ankle_l, '#06b6d4'); 
      drawBone(ankle_l, heel_l, '#10b981'); 
      drawBone(heel_l, toe_l, '#10b981'); 

      // Right Arm & Leg
      drawBone(shoulder_r, elbow_r, '#ec4899'); 
      drawBone(elbow_r, wrist_r, '#f43f5e'); 
      drawBone(hip_r, knee_r, '#d4a017'); 
      drawBone(knee_r, ankle_r, '#06b6d4'); 
      drawBone(ankle_r, heel_r, '#10b981'); 
      drawBone(heel_r, toe_r, '#10b981'); 

      // Joint Nodes
      drawJoint(shoulder_l, '#d4a017');
      drawJoint(shoulder_r, '#d4a017');
      drawJoint(elbow_l, '#d946ef');
      drawJoint(elbow_r, '#d946ef');
      drawJoint(wrist_l, '#f43f5e');
      drawJoint(wrist_r, '#f43f5e');
      drawJoint(hip_l, '#d4a017');
      drawJoint(hip_r, '#d4a017');
      drawJoint(knee_l, '#10b981');
      drawJoint(knee_r, '#10b981');
      drawJoint(ankle_l, '#06b6d4');
      drawJoint(ankle_r, '#06b6d4');
      drawJoint(toe_l, '#10b981');
      drawJoint(toe_r, '#10b981');

      // Update real-time measurements display
      kneeAngleLDisp.textContent = `${kneeAngleL}°`;
      kneeAngleRDisp.textContent = `${kneeAngleR}°`;
      hipAngleLDisp.textContent = `${hipAngleL}°`;
      hipAngleRDisp.textContent = `${hipAngleR}°`;
      elbowAngleLDisp.textContent = `${elbowAngleL}°`;
      elbowAngleRDisp.textContent = `${elbowAngleR}°`;

      // Draw real-time biometrics to dashboard and ruler if calibrated
      if (state.pixelsPerCm && liveMetrics) {
        renderDashboard(liveMetrics);

        // Position ruler on whichever side has more margin
        const body_xs = [shoulder_l.x, shoulder_r.x, hip_l.x, hip_r.x, knee_l.x, knee_r.x, ankle_l.x, ankle_r.x];
        const min_x = Math.min(...body_xs);
        const max_x = Math.max(...body_xs);
        const ruler_x = max_x + 40 < 620 ? max_x + 40 : min_x - 40 > 20 ? min_x - 40 : 50;

        // Compute feet & inches string for ruler label
        const live_inches = liveMetrics.live_height / 2.54;
        const live_feet = Math.floor(live_inches / 12);
        const live_inches_left = live_inches % 12;
        const live_feet_inches_str = `${live_feet}' ${live_inches_left.toFixed(1)}"`;

        // Draw head top indicator node
        drawJoint(head_top, '#06b6d4');

        // Draw the live ruler graphics
        drawRulerGraphics(ruler_x, head_top, ground_y, liveMetrics.live_height, live_feet_inches_str, heel_l, heel_r);

        // Draw active pose badge
        if (liveMetrics.pose) {
          drawPoseBadge(liveMetrics.pose);
        }

        // Active Sequential Pose hold tracking
        if (state.autoActive && state.lockoutTimerMs === 0) {
          const detectedPose = liveMetrics.pose;
          let isPoseMatched = false;
          if (state.autoState === 'WAITING_A' && detectedPose === 'A-Pose') {
            isPoseMatched = true;
          } else if (state.autoState === 'WAITING_T' && detectedPose === 'T-Pose') {
            isPoseMatched = true;
          } else if (state.autoState === 'WAITING_OVERHEAD' && detectedPose === 'Overhead Reach') {
            isPoseMatched = true;
          }

          if (isPoseMatched) {
            state.holdTimerMs += dt;
            const progress = Math.min(state.holdTimerMs / state.REQ_HOLD_MS, 1.0);
            
            // Draw glassmorphic holding progress bar
            canvasCtx.save();
            const barWidth = 320;
            const barHeight = 16;
            const barX = (canvasElement.width - barWidth) / 2;
            const barY = canvasElement.height - 75;
            
            // Glassmorphic styling
            canvasCtx.fillStyle = 'rgba(15, 22, 38, 0.7)';
            canvasCtx.strokeStyle = 'rgba(212, 160, 23, 0.4)';
            canvasCtx.lineWidth = 1.5;
            drawRoundedRect(canvasCtx, barX, barY, barWidth, barHeight, 8);
            canvasCtx.fill();
            canvasCtx.stroke();
            
            if (progress > 0) {
              canvasCtx.save();
              const fillWidth = barWidth * progress;
              const grad = canvasCtx.createLinearGradient(barX, 0, barX + barWidth, 0);
              grad.addColorStop(0, '#d4a017');
              grad.addColorStop(1, '#d4a017');
              canvasCtx.fillStyle = grad;
              canvasCtx.beginPath();
              drawRoundedRect(canvasCtx, barX, barY, fillWidth, barHeight, 8);
              canvasCtx.clip();
              canvasCtx.fillRect(barX, barY, fillWidth, barHeight);
              canvasCtx.restore();
            }
            
            // Hold Progress Text with pulsing glow
            const pulse = 1 + 0.02 * Math.sin(Date.now() / 150);
            canvasCtx.save();
            canvasCtx.translate(canvasElement.width / 2, barY - 15);
            canvasCtx.scale(pulse, pulse);
            canvasCtx.fillStyle = '#ffffff';
            canvasCtx.font = 'bold 12px sans-serif';
            canvasCtx.textAlign = 'center';
            canvasCtx.shadowColor = '#d4a017';
            canvasCtx.shadowBlur = 6;
            const percentage = Math.floor(progress * 100);
            canvasCtx.fillText(`HOLDING ${detectedPose.toUpperCase()}: ${percentage}%`, 0, 0);
            canvasCtx.restore();
            
            canvasCtx.restore();

            if (state.holdTimerMs >= state.REQ_HOLD_MS) {
              triggerFlashEffect();
              
              // Cache current frame image on frozenFrameCanvas (raw picture with YOLO cutout if active, raw video if not)
              const w = state.canvasWidth || 640;
              const h = state.canvasHeight || 480;
              frozenFrameCtx.clearRect(0, 0, w, h);
              frozenFrameCtx.save();
              if (state.currentFacingMode === "user") {
                frozenFrameCtx.translate(w, 0);
                frozenFrameCtx.scale(-1, 1);
              }
              if (results.segmentationMask && state.yoloModeActive) {
                frozenFrameCtx.drawImage(results.segmentationMask, 0, 0, w, h);
                frozenFrameCtx.globalCompositeOperation = 'source-in';
                frozenFrameCtx.drawImage(results.image, 0, 0, w, h);
              } else {
                frozenFrameCtx.drawImage(results.image, 0, 0, w, h);
              }
              frozenFrameCtx.restore();
              
              // Cache joints & metrics for lockout screen and consolidation
              state.frozenAutoJoints = JSON.parse(JSON.stringify({
                shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
                shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
                head_top, ground_y, ruler_x, live_feet_inches_str,
                smoothed_live_height: liveMetrics.live_height,
                kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
                all_landmarks: all_landmarks
              }));
              state.frozenAutoMetrics = JSON.parse(JSON.stringify(liveMetrics));
              
              // Capture and store specific frame image and metrics for combined report
              const capturedImage = frozenFrameCanvas.toDataURL('image/png');
              if (state.autoState === 'WAITING_A') {
                state.imageA = capturedImage;
                state.metricsA = JSON.parse(JSON.stringify(liveMetrics));
              } else if (state.autoState === 'WAITING_T') {
                state.imageT = capturedImage;
                state.metricsT = JSON.parse(JSON.stringify(liveMetrics));
              } else if (state.autoState === 'WAITING_OVERHEAD') {
                state.imageOverhead = capturedImage;
                state.metricsOverhead = JSON.parse(JSON.stringify(liveMetrics));
              }

              // Trigger visual feedback lockout period
              state.lockoutTimerMs = state.LOCKOUT_MS;
            }
          } else {
            state.holdTimerMs = 0;
          }
        }

        // Capture freeze frame hook
        if (state.isCaptureCountingDown && state.captureCountdownValue === 0) {
          captureSnapshot({
            shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
            shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
            head_top, ground_y, ruler_x, live_feet_inches_str,
            smoothed_live_height: liveMetrics.live_height,
            kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
            all_landmarks: all_landmarks
          }, liveMetrics, results);
        }

        statusElement.textContent = `✅ Calibrated Tracking active. Real-time biometrics rendering.`;
      } else {
        statusElement.textContent = "⚠️ Scale not calibrated yet. Lock your 200mm marker calibration first.";
      }
    } else {
      statusElement.textContent = "🔍 Scanning for a person... Align your printed marker first.";
    }
  }

  // --- 5-SECOND CAPTURE COUNTDOWN OVERLAY ---
  if (state.isCaptureCountingDown && state.captureCountdownValue > 0) {
    canvasCtx.fillStyle = 'rgba(9, 13, 22, 0.75)';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    // Tech borders
    canvasCtx.strokeStyle = 'rgba(212, 160, 23, 0.3)';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(20, 20, canvasElement.width - 40, canvasElement.height - 40);

    canvasCtx.fillStyle = '#d4a017'; // gold
    canvasCtx.strokeStyle = 'rgba(212, 160, 23, 0.5)';
    canvasCtx.lineWidth = 4;
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    
    // Large countdown number
    canvasCtx.font = 'bold 105px sans-serif';
    canvasCtx.fillText(state.captureCountdownValue, canvasElement.width / 2, canvasElement.height / 2 - 30);
    canvasCtx.strokeText(state.captureCountdownValue, canvasElement.width / 2, canvasElement.height / 2 - 30);

    // Instruction text
    canvasCtx.font = 'bold 20px sans-serif';
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.fillText("PREPARING SNAPSHOT", canvasElement.width / 2, canvasElement.height / 2 + 55);
    
    canvasCtx.font = '500 13px sans-serif';
    canvasCtx.fillStyle = '#cbd5e1';
    canvasCtx.fillText("Step back, stand straight, and hold your pose", canvasElement.width / 2, canvasElement.height / 2 + 85);
  }

  // --- CAMERA SNAPSHOT FLASH EFFECT ---
  if (state.flashOpacity > 0) {
    canvasCtx.fillStyle = `rgba(255, 255, 255, ${state.flashOpacity})`;
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  }

  // --- REAL-TIME CALIBRATION / VALIDATION CHECK ---
  if (state.activeCalMethod === 'validation') {
    const feedbackBox = document.getElementById('validation-feedback-box');
    const statusText = document.getElementById('validation-status-text');
    if (feedbackBox && statusText) {
      if (!state.pixelsPerCm) {
        statusText.innerHTML = `🔍 Scanning for Reference ArUco (200mm)...`;
        feedbackBox.classList.add('hidden');
      } else {
        statusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
        
        // Check if there is a person/pose detected and calculated
        const calculated = typeof calculatePoseMetrics === 'function' ? calculatePoseMetrics(results) : null;
        if (!calculated || !calculated.liveMetrics) {
          feedbackBox.classList.remove('hidden');
          feedbackBox.style.border = "1px dashed rgba(167, 177, 183, 0.4)";
          feedbackBox.style.backgroundColor = "rgba(255, 255, 255, 0.03)";
          feedbackBox.style.color = "#a7b1b7";
          feedbackBox.innerHTML = `👤 Please stand in view of the camera to perform real-time verification...`;
        } else {
          feedbackBox.classList.remove('hidden');
          const liveHeight = calculated.liveMetrics.skeletal_height;
          const targetHeight = state.validationHeightCm;
          const diffCm = Math.abs(liveHeight - targetHeight);
          
          const calculatedStr = formatSkeletalHeight(liveHeight);
          const trueStr = formatSkeletalHeight(targetHeight);
          const diffStr = state.useInches ? `${(diffCm / 2.54).toFixed(1)} in` : `${diffCm.toFixed(1)} cm`;
          
          if (diffCm <= 1.0) {
            feedbackBox.style.border = "1px solid #10b981";
            feedbackBox.style.backgroundColor = "rgba(16, 185, 129, 0.1)";
            feedbackBox.style.color = "#10b981";
            feedbackBox.innerHTML = `
              <div class="font-bold" style="font-size: 14px; margin-bottom: 6px; color: #10b981;">✅ SUCCESS: Calibrated & Positioned Properly!</div>
              <div>Calculated: <strong>${calculatedStr}</strong> | True: <strong>${trueStr}</strong></div>
              <div style="font-size: 11px; margin-top: 4px; opacity: 0.9;">Discrepancy: ${diffStr} (Within 1.0 cm limit)</div>
            `;
          } else {
            feedbackBox.style.border = "1px solid #ec4899";
            feedbackBox.style.backgroundColor = "rgba(236, 72, 153, 0.1)";
            feedbackBox.style.color = "#ec4899";
            feedbackBox.innerHTML = `
              <div class="font-bold" style="font-size: 14px; margin-bottom: 6px; color: #ec4899;">⚠️ POSITION CHECK: Discrepancy Found</div>
              <div>Calculated: <strong>${calculatedStr}</strong> | True: <strong>${trueStr}</strong></div>
              <div style="font-size: 11px; margin-top: 4px; opacity: 0.9;">Discrepancy: <strong style="color: #ec4899;">${diffStr}</strong> (Max allowed: 1.0 cm)</div>
              <div style="margin-top: 6px; font-size: 11px; color: #a7b1b7;">Please adjust your ArUco marker position or camera alignment.</div>
            `;
          }
        }
      }
    }
  }

  canvasCtx.restore();
}

// ==========================================
// CAPTURE TIMER & SNAPSHOT PROCESSING
// ==========================================

function captureSnapshot(joints, metrics, results) {
  state.isCaptureCountingDown = false;
  
  // Save deep copies of the joints coordinates and dashboard metrics
  state.frozenJoints = JSON.parse(JSON.stringify(joints));
  state.frozenMetrics = JSON.parse(JSON.stringify(metrics));
  state.frozenHandResults = state.latestHandResults ? JSON.parse(JSON.stringify(state.latestHandResults)) : null;
  
  // Save current frame image from results (or fallback to videoElement if results are not available)
  const w = state.canvasWidth || 640;
  const h = state.canvasHeight || 480;
  frozenFrameCtx.clearRect(0, 0, w, h);
  frozenFrameCtx.save();
  if (state.currentFacingMode === "user") {
    frozenFrameCtx.translate(w, 0);
    frozenFrameCtx.scale(-1, 1);
  }
  if (results && results.segmentationMask && state.yoloModeActive) {
    frozenFrameCtx.drawImage(results.segmentationMask, 0, 0, w, h);
    frozenFrameCtx.globalCompositeOperation = 'source-in';
    frozenFrameCtx.drawImage(results.image, 0, 0, w, h);
  } else if (results && results.image) {
    frozenFrameCtx.drawImage(results.image, 0, 0, w, h);
  } else {
    frozenFrameCtx.drawImage(videoElement, 0, 0, w, h);
  }
  frozenFrameCtx.restore();

  state.isSnapshotFrozen = true;
  videoElement.classList.add('video-hidden');
  videoElement.classList.remove('video-visible', 'video-dimmed'); // Completely hide live video feed under the canvas
  
  // Set capture button to reset mode
  captureBtn.textContent = "Reset & Resume Live Tracking";
  captureBtn.classList.remove('btn-capture');
  captureBtn.classList.add('btn-capture-reset');
  
  statusElement.textContent = "📸 SNAPSHOT CAPTURED! Biomechanical statistics frozen on screen.";
  
  // Set default label in input
  const nameInput = document.getElementById('snapshot-name-input');
  if (nameInput) {
    const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const dateStr = new Date().toLocaleDateString('en-US', options);
    
    // Retrieve active subject name if typed
    const subjectInput = document.getElementById('subject-name-input');
    const subjectName = subjectInput ? subjectInput.value.trim() : '';
    
    const poseName = (metrics && metrics.pose) ? metrics.pose : "Posture Scan";
    
    if (subjectName) {
      nameInput.value = `${subjectName} - ${poseName} - ${dateStr}`;
    } else {
      nameInput.value = `${poseName} - ${dateStr}`;
    }
  }

  // Show save panel
  const savePanel = document.getElementById('save-controls-panel');
  if (savePanel) {
    savePanel.classList.remove('hidden');
    savePanel.classList.add('visible-flex');
  }

  // Trigger visual flash
  triggerFlashEffect();
}

export function cancelAutoSequence() {
  state.autoActive = false;
  state.autoState = 'IDLE';
  state.holdTimerMs = 0;
  state.lockoutTimerMs = 0;
  state.currentGroupId = null;
  state.frozenAutoJoints = null;
  state.frozenAutoMetrics = null;
  state.metricsA = null;
  state.metricsT = null;
  state.metricsOverhead = null;
  state.imageA = null;
  state.imageT = null;
  state.imageOverhead = null;
  
  const autoSequenceBtn = document.getElementById('auto-sequence-btn');
  if (autoSequenceBtn) {
    autoSequenceBtn.textContent = "Hands-Free Auto Capture";
    autoSequenceBtn.classList.remove('active-cancel');
  }
  
  statusElement.textContent = "Hands-free capture cancelled.";
}

export function drawLockoutTransitionOverlay() {
  canvasCtx.save();
  
  const panelW = 460;
  const panelH = 110;
  const panelX = (canvasElement.width - panelW) / 2;
  const panelY = (canvasElement.height - panelH) / 2;
  
  canvasCtx.fillStyle = 'rgba(15, 22, 38, 0.85)';
  canvasCtx.strokeStyle = 'rgba(212, 160, 23, 0.6)';
  canvasCtx.lineWidth = 2;
  canvasCtx.shadowColor = 'rgba(212, 160, 23, 0.4)';
  canvasCtx.shadowBlur = 12;
  
  drawRoundedRect(canvasCtx, panelX, panelY, panelW, panelH, 12);
  canvasCtx.fill();
  canvasCtx.stroke();
  canvasCtx.shadowBlur = 0;
  
  canvasCtx.fillStyle = '#d4a017';
  canvasCtx.font = 'bold 15px sans-serif';
  canvasCtx.textAlign = 'center';
  canvasCtx.textBaseline = 'top';
  
  let currentCap = "";
  let nextPose = "";
  if (state.autoState === 'WAITING_A') {
    currentCap = "A-POSE";
    nextPose = "T-Pose (Arms horizontal)";
  } else if (state.autoState === 'WAITING_T') {
    currentCap = "T-POSE";
    nextPose = "Overhead Reach (Arms straight up)";
  } else if (state.autoState === 'WAITING_OVERHEAD') {
    currentCap = "OVERHEAD REACH";
    nextPose = "Generating consolidated report...";
  }
  
  canvasCtx.fillText(`✅ ${currentCap} CAPTURED!`, canvasElement.width / 2, panelY + 18);
  
  canvasCtx.fillStyle = '#e2e8f0';
  canvasCtx.font = '500 12px sans-serif';
  if (state.autoState !== 'WAITING_OVERHEAD') {
    canvasCtx.fillText(`Prepare next: ${nextPose}`, canvasElement.width / 2, panelY + 42);
  } else {
    canvasCtx.fillText(nextPose, canvasElement.width / 2, panelY + 42);
  }

  const progress = Math.max(state.lockoutTimerMs / state.LOCKOUT_MS, 0);
  const barW = 380;
  const barH = 8;
  const barX = (canvasElement.width - barW) / 2;
  const barY = panelY + panelH - 28;
  
  canvasCtx.fillStyle = 'rgba(30, 41, 59, 0.8)';
  drawRoundedRect(canvasCtx, barX, barY, barW, barH, 4);
  canvasCtx.fill();
  
  if (progress > 0) {
    canvasCtx.save();
    const fillW = barW * progress;
    const grad = canvasCtx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#d4a017');
    grad.addColorStop(1, '#d4a017');
    canvasCtx.fillStyle = grad;
    canvasCtx.beginPath();
    drawRoundedRect(canvasCtx, barX, barY, fillW, barH, 4);
    canvasCtx.clip();
    canvasCtx.fillRect(barX, barY, fillW, barH);
    canvasCtx.restore();
  }
  
  canvasCtx.fillStyle = '#94a3b8';
  canvasCtx.font = 'normal 9px sans-serif';
  const secLeft = (state.lockoutTimerMs / 1000).toFixed(1);
  if (state.autoState !== 'WAITING_OVERHEAD') {
    canvasCtx.fillText(`Lockout active: ${secLeft}s remaining`, canvasElement.width / 2, panelY + panelH - 12);
  } else {
    canvasCtx.fillText(`Consolidating in ${secLeft}s`, canvasElement.width / 2, panelY + panelH - 12);
  }

  canvasCtx.restore();
}

export function saveCombinedSessionSnapshot() {
  const subjectInput = document.getElementById('subject-name-input');
  const subjectName = subjectInput ? subjectInput.value.trim() : '';
  const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const dateStr = new Date().toLocaleDateString('en-US', options);
  
  let label = "";
  if (subjectName) {
    label = `${subjectName} - Combined Report - ${dateStr}`;
  } else {
    label = `Combined Report - ${dateStr}`;
  }

  // Retrieve active DOM pinch/span measurements in raw cm values
  const pinch_l_cm = getDomMeasurementCm('val-pinch-l');
  const pinch_r_cm = getDomMeasurementCm('val-pinch-r');
  const span_l_cm = getDomMeasurementCm('val-span-l');
  const span_r_cm = getDomMeasurementCm('val-span-r');

  const mA = state.metricsA || {};
  const mT = state.metricsT || {};
  const mO = state.metricsOverhead || {};

  const consolidatedMetrics = {
    pose: "Combined",
    isCombinedSession: true,
    skeletal_height: mA.skeletal_height,
    wingspan: mT.wingspan,
    fingerToToeL: mO.fingerToToeL,
    fingerToToeR: mO.fingerToToeR,
    hipW: mA.hipW,
    
    // Segment lengths from optimal pose (A-Pose)
    thigh_l: mA.thigh_l,
    thigh_r: mA.thigh_r,
    shin_l: mA.shin_l,
    shin_r: mA.shin_r,
    foot_l: mA.foot_l,
    foot_r: mA.foot_r,
    torso_l: mA.torso_l,
    torso_r: mA.torso_r,
    upperarm_l: mA.upperarm_l,
    upperarm_r: mA.upperarm_r,
    forearm_l: mA.forearm_l,
    forearm_r: mA.forearm_r,

    // Store joint angles for switcher display in modal
    anglesA: {
      kneeAngleL: mA.kneeAngleL,
      kneeAngleR: mA.kneeAngleR,
      hipAngleL: mA.hipAngleL,
      hipAngleR: mA.hipAngleR,
      elbowAngleL: mA.elbowAngleL,
      elbowAngleR: mA.elbowAngleR
    },
    anglesT: {
      kneeAngleL: mT.kneeAngleL,
      kneeAngleR: mT.kneeAngleR,
      hipAngleL: mT.hipAngleL,
      hipAngleR: mT.hipAngleR,
      elbowAngleL: mT.elbowAngleL,
      elbowAngleR: mT.elbowAngleR
    },
    anglesOverhead: {
      kneeAngleL: mO.kneeAngleL,
      kneeAngleR: mO.kneeAngleR,
      hipAngleL: mO.hipAngleL,
      hipAngleR: mO.hipAngleR,
      elbowAngleL: mO.elbowAngleL,
      elbowAngleR: mO.elbowAngleR
    },

    pinch_l_cm,
    pinch_r_cm,
    span_l_cm,
    span_r_cm
  };

  const snapshotRecord = {
    name: label,
    timestamp: Date.now(),
    isCombinedSession: true,
    imageA: state.imageA,
    imageT: state.imageT,
    imageOverhead: state.imageOverhead,
    image: state.imageA, // Fallback/Thumbnail image is the A-pose image
    metrics: consolidatedMetrics
  };

  if (state.dbInitialized) {
    snapshotStore.save(snapshotRecord)
      .then(() => {
        console.log(`[AutoCapture] Saved combined "${label}" session snapshot to IndexedDB gallery.`);
        renderGallery();
      })
      .catch(err => {
        console.error("[AutoCapture] Failed to save combined snapshot to IndexedDB:", err);
      });
  }
}

function drawFrozenSnapshot() {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // 1. Draw the frozen frame
  canvasCtx.drawImage(frozenFrameCanvas, 0, 0, canvasElement.width, canvasElement.height);

  // 2. Draw the frozen skeleton
  if (state.frozenJoints) {
    const {
      shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
      shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
      head_top, ground_y, ruler_x, live_feet_inches_str, smoothed_live_height,
      kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
      all_landmarks
    } = state.frozenJoints;

    // Draw the full skeletal mesh
    drawFullSkeletalMesh(all_landmarks);

    // Draw bones
    drawBone(shoulder_l, shoulder_r, '#d4a017'); 
    drawBone(hip_l, hip_r, '#d4a017'); 
    drawBone(shoulder_l, hip_l, '#38bdf8'); 
    drawBone(shoulder_r, hip_r, '#38bdf8'); 

    drawBone(shoulder_l, elbow_l, '#ec4899'); 
    drawBone(elbow_l, wrist_l, '#f43f5e'); 
    drawBone(hip_l, knee_l, '#d4a017'); 
    drawBone(knee_l, ankle_l, '#06b6d4'); 
    drawBone(ankle_l, heel_l, '#10b981'); 
    drawBone(heel_l, toe_l, '#10b981'); 

    drawBone(shoulder_r, elbow_r, '#ec4899'); 
    drawBone(elbow_r, wrist_r, '#f43f5e'); 
    drawBone(hip_r, knee_r, '#d4a017'); 
    drawBone(knee_r, ankle_r, '#06b6d4'); 
    drawBone(ankle_r, heel_r, '#10b981'); 
    drawBone(heel_r, toe_r, '#10b981'); 

    // Draw joints
    drawJoint(shoulder_l, '#6366f1');
    drawJoint(shoulder_r, '#6366f1');
    drawJoint(elbow_l, '#d946ef');
    drawJoint(elbow_r, '#d946ef');
    drawJoint(wrist_l, '#f43f5e');
    drawJoint(wrist_r, '#f43f5e');
    drawJoint(hip_l, '#d4a017');
    drawJoint(hip_r, '#d4a017');
    drawJoint(knee_l, '#10b981');
    drawJoint(knee_r, '#10b981');
    drawJoint(ankle_l, '#06b6d4');
    drawJoint(ankle_r, '#06b6d4');
    drawJoint(toe_l, '#10b981');
    drawJoint(toe_r, '#10b981');
    drawJoint(head_top, '#06b6d4');

    // Draw ruler
    canvasCtx.beginPath();
    canvasCtx.moveTo(ruler_x, head_top.y);
    canvasCtx.lineTo(ruler_x, ground_y);
    canvasCtx.strokeStyle = '#06b6d4';
    canvasCtx.lineWidth = 2.5;
    canvasCtx.stroke();

    canvasCtx.beginPath();
    canvasCtx.moveTo(ruler_x - 10, head_top.y);
    canvasCtx.lineTo(ruler_x + 10, head_top.y);
    canvasCtx.stroke();

    canvasCtx.beginPath();
    canvasCtx.moveTo(ruler_x - 10, ground_y);
    canvasCtx.lineTo(ruler_x + 10, ground_y);
    canvasCtx.stroke();

    canvasCtx.fillStyle = '#06b6d4';
    canvasCtx.font = 'bold 11px sans-serif';
    const rulerLabel = state.useInches ? live_feet_inches_str : `${smoothed_live_height.toFixed(1)} cm`;
    canvasCtx.fillText(`Captured: ${rulerLabel}`, ruler_x > 320 ? ruler_x + 15 : ruler_x - (state.useInches ? 115 : 100), (head_top.y + ground_y) / 2);

    // Connecting lines
    canvasCtx.beginPath();
    canvasCtx.moveTo(head_top.x, head_top.y);
    canvasCtx.lineTo(ruler_x, head_top.y);
    canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);

    canvasCtx.beginPath();
    canvasCtx.moveTo((heel_l.x + heel_r.x)/2, ground_y);
    canvasCtx.lineTo(ruler_x, ground_y);
    canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);
  }

  // Draw frozen hand skeletons if available
  if (state.frozenHandResults) {
    drawHandMesh(state.frozenHandResults.multiHandLandmarks, state.frozenHandResults.multiHandedness);
  }

  // Draw frozen pose badge if available
  if (state.frozenMetrics && state.frozenMetrics.pose) {
    drawPoseBadge(state.frozenMetrics.pose);
  }

  // 3. Draw pulsing SNAPSHOT FROZEN badge
  const pulse = 1 + 0.05 * Math.sin(Date.now() / 200);
  canvasCtx.save();
  canvasCtx.translate(canvasElement.width / 2, 40);
  canvasCtx.scale(pulse, pulse);
  
  canvasCtx.fillStyle = 'rgba(239, 68, 68, 0.85)'; // vibrant neon red/coral badge
  canvasCtx.strokeStyle = '#ef4444';
  canvasCtx.lineWidth = 1.5;
  
  drawRoundedRect(canvasCtx, -100, -15, 200, 30, 6);
  canvasCtx.fill();
  canvasCtx.stroke();
  
  canvasCtx.fillStyle = '#ffffff';
  canvasCtx.font = 'bold 12px sans-serif';
  canvasCtx.textAlign = 'center';
  canvasCtx.textBaseline = 'middle';
  canvasCtx.fillText('📸 SNAPSHOT FROZEN', 0, 0);
  canvasCtx.restore();

  // 4. Draw camera flash if still active
  if (state.flashOpacity > 0) {
    canvasCtx.fillStyle = `rgba(255, 255, 255, ${state.flashOpacity})`;
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  }

  canvasCtx.restore();
}

export function resetAndResume() {
  if (state.autoActive) {
    cancelAutoSequence();
  }
  state.isSnapshotFrozen = false;
  state.frozenJoints = null;
  state.frozenMetrics = null;
  state.frozenHandResults = null;
  
  // Restore standard video feed visibility
  videoElement.classList.remove('video-hidden');
  if (state.yoloModeActive) {
    videoElement.classList.add('video-dimmed');
    videoElement.classList.remove('video-visible');
  } else {
    videoElement.classList.add('video-visible');
    videoElement.classList.remove('video-dimmed');
  }
  
  // Restore capture button styling
  captureBtn.textContent = "Start 5s Capture Snapshot";
  captureBtn.classList.remove('btn-capture-reset');
  captureBtn.classList.add('btn-capture');
  
  statusElement.textContent = "Live biomechanical tracking resumed.";

  // Hide save panel
  const savePanel = document.getElementById('save-controls-panel');
  if (savePanel) {
    savePanel.classList.add('hidden');
    savePanel.classList.remove('visible-flex');
  }
}

// ==========================================
// CAMERA STREAM MANAGEMENT
// ==========================================

export async function startCamera() {
  statusElement.textContent = "Requesting webcam access...";
  startButton.classList.add('hidden');
  yoloToggleBtn.classList.remove('hidden');
  yoloToggleBtn.classList.add('visible-block');
  captureBtn.classList.remove('hidden');
  captureBtn.classList.add('visible-block');

  const autoSequenceBtn = document.getElementById('auto-sequence-btn');
  if (autoSequenceBtn) {
    autoSequenceBtn.classList.remove('hidden');
    autoSequenceBtn.classList.add('visible-block');
  }

  const subjectPanel = document.getElementById('subject-profile-panel');
  if (subjectPanel) {
    subjectPanel.classList.remove('hidden');
    subjectPanel.classList.add('visible-flex');
  }

  const cameraSwitchBtn = document.getElementById('camera-switch-btn');
  if (cameraSwitchBtn) {
    cameraSwitchBtn.classList.remove('hidden');
    cameraSwitchBtn.classList.add('visible-flex');
  }

  try {
    try {
      // Attempt HD/FHD stream for high tracking accuracy (min 720p, ideal 1080p)
      state.activeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { min: 1280, ideal: 1920 },
          height: { min: 720, ideal: 1080 },
          facingMode: state.currentFacingMode
        }
      });
    } catch (hdErr) {
      console.warn("HD/FHD camera request failed, falling back to 640x480:", hdErr);
      // Fallback to standard definition if HD is overconstrained or unsupported
      state.activeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: state.currentFacingMode
        }
      });
    }
    
    videoElement.srcObject = state.activeStream;
    // Mirror the view only for front/user camera
    videoElement.classList.toggle('mirror-x', state.currentFacingMode === "user");
    
    videoElement.onloadedmetadata = () => {
      const w = videoElement.videoWidth || 640;
      const h = videoElement.videoHeight || 480;
      
      // Dynamically adapt coordinate space and layouts to the true camera feed aspect ratio
      state.canvasWidth = w;
      state.canvasHeight = h;
      canvasElement.width = w;
      canvasElement.height = h;
      frozenFrameCanvas.width = w;
      frozenFrameCanvas.height = h;
      
      // Center manual calibration box based on true camera proportions
      state.calBoxX = w / 2;
      state.calBoxY = h / 2;
      
      const viewport = document.querySelector('.viewport');
      if (viewport) {
        viewport.style.aspectRatio = `${w} / ${h}`;
      }
      
      videoElement.play();
      statusElement.textContent = "Camera active. Syncing with computer vision models...";
    };

    // Frame loop processor
    async function processFrame() {
      if (!state.activeStream || videoElement.paused || videoElement.ended) return;
      try {
        if (state.isSnapshotFrozen) {
          // Direct high-fidelity manual rendering loop when frozen to save CPU resources
          drawFrozenSnapshot();
          requestAnimationFrame(processFrame);
          return;
        }

        // Call modular ArUco Marker Scanner helper (from arucoDetector.js)
        if (typeof detectArucoMarker === 'function') {
          const found = detectArucoMarker(videoElement);
          state.latestArucoMarker = found;

          if (found) {
            const corners = found.corners;
            const d01 = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
            const d12 = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
            const d23 = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
            const d30 = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
            const edgeLengthPx = (d01 + d12 + d23 + d30) / 4;

            // Smooth calibration scale to avoid webcam noise
            const smoothedScale = smooth('scale_factor', edgeLengthPx / MARKER_PHYSICAL_SIZE_CM);
            if (state.wallPerspectiveEnabled) {
              state.pixelsPerCm = smoothedScale * state.wallPerspectiveFactor;
            } else {
              state.pixelsPerCm = smoothedScale;
            }
            state.calLocked = true;

            if (state.activeCalMethod === 'aruco') {
              arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
            }
          } else {
            if (state.activeCalMethod === 'aruco') {
              if (state.pixelsPerCm) {
                arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
              } else {
                arucoStatusText.innerHTML = `🔍 Scanning for Reference (200mm)...`;
              }
            }
          }
        }

        // Sync with MediaPipe Pose Models (from mediapipeLogic.js)
        await pose.send({ image: videoElement });

        // Sync with MediaPipe Hands Models (from mediapipeLogic.js)
        await hands.send({ image: videoElement });
      } catch (poseErr) {
        console.error("Frame processing error:", poseErr);
      }
      requestAnimationFrame(processFrame);
    }

    // Start processing once stream is playing
    videoElement.onplay = () => {
      statusElement.textContent = "Active tracking. Present your printed ArUco marker to calibrate scale!";
      processFrame();
    };

  } catch (err) {
    console.error("Camera access failed:", err);
    startButton.classList.remove('hidden');
    if (err.name === 'NotAllowedError') {
      statusElement.innerHTML = `<span class="text-red font-bold">❌ Camera Permission Denied!</span><br>Please click the camera/lock icon in your browser address bar and change camera permissions to 'Allow'.`;
    } else if (err.name === 'NotReadableError') {
      statusElement.innerHTML = `<span class="text-red font-bold">❌ Camera in use by another app!</span><br>Another app (Zoom, Teams, FaceTime, or a terminal script) is currently locking your camera. Please close it and try again.`;
    } else {
      statusElement.innerHTML = `<span class="text-red font-bold">❌ Error: ${err.message}</span><br>Please make sure you are loading this page via 'http://localhost:8000' and not 'file://' (which blocks camera access).`;
    }
  }
}

startButton.addEventListener('click', startCamera);

// Camera switch event listener for switching between front/back cameras
const cameraSwitchBtn = document.getElementById('camera-switch-btn');
if (cameraSwitchBtn) {
  cameraSwitchBtn.addEventListener('click', async () => {
    if (!state.activeStream) return;
    
    // Stop the active stream tracks first
    state.activeStream.getTracks().forEach(track => track.stop());
    state.activeStream = null;
    
    // Toggle facing mode between user and environment
    state.currentFacingMode = (state.currentFacingMode === "user") ? "environment" : "user";
    
    // Restart camera with new facing mode
    await startCamera();
  });
}

// ==========================================
// SNAPSHOT PERSISTENCE & GALLERY INTEGRATION
// ==========================================

export function renderGallery() {
  const galleryGrid = document.getElementById('gallery-grid');
  if (!galleryGrid) return;

  snapshotStore.getAll()
    .then(snapshots => {
      galleryGrid.innerHTML = '';

      if (!snapshots || snapshots.length === 0) {
        galleryGrid.innerHTML = `
          <div class="gallery-empty">
            📸 No snapshots saved yet. Capture a snapshot above to save to your local offline library!
          </div>
        `;
        return;
      }

      // Sort chronologically (newest first)
      snapshots.sort((a, b) => b.timestamp - a.timestamp);

      snapshots.forEach(snapshot => {
        const card = document.createElement('div');
        card.className = 'snapshot-card';
        card.setAttribute('data-id', snapshot.id);

        let formattedHeight = '--.-';
        if (snapshot.metrics && snapshot.metrics.skeletal_height) {
          formattedHeight = formatSkeletalHeight(snapshot.metrics.skeletal_height);
        }

        const dateOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        const formattedDate = new Date(snapshot.timestamp).toLocaleDateString(undefined, dateOptions);

        const isCombined = snapshot.isCombinedSession || (snapshot.metrics && snapshot.metrics.isCombinedSession);

        if (isCombined) {
          card.classList.add('combined');
          card.innerHTML = `
            <button class="snapshot-card-delete" title="Delete Snapshot" data-id="${snapshot.id}">
              &times;
            </button>
            <div class="snapshot-card-img-wrapper combined-collage">
              <div class="collage-item"><img src="${snapshot.imageA || snapshot.image}" alt="A-Pose"></div>
              <div class="collage-item"><img src="${snapshot.imageT || snapshot.image}" alt="T-Pose"></div>
              <div class="collage-item"><img src="${snapshot.imageOverhead || snapshot.image}" alt="Overhead"></div>
              <div class="snapshot-card-overlay">
                <span>View Combined Report</span>
              </div>
              <span class="combined-tag">3-Pose Session</span>
            </div>
            <div class="snapshot-card-info">
              <div class="snapshot-card-title" title="${snapshot.name || 'Biomechanical Session'}">${snapshot.name || 'Biomechanical Session'}</div>
              <div class="snapshot-card-meta">
                <span class="snapshot-card-height">Height: ${formattedHeight}</span>
                <span>${formattedDate}</span>
              </div>
            </div>
          `;
        } else {
          card.innerHTML = `
            <button class="snapshot-card-delete" title="Delete Snapshot" data-id="${snapshot.id}">
              &times;
            </button>
            <div class="snapshot-card-img-wrapper">
              <img class="snapshot-card-img" src="${snapshot.image}" alt="${snapshot.name || 'Biomechanical Snapshot'}">
              <div class="snapshot-card-overlay">
                <span>View Details</span>
              </div>
            </div>
            <div class="snapshot-card-info">
              <div class="snapshot-card-title" title="${snapshot.name || 'Biomechanical Snapshot'}">${snapshot.name || 'Biomechanical Snapshot'}</div>
              <div class="snapshot-card-meta">
                <span class="snapshot-card-height">${formattedHeight}</span>
                <span>${formattedDate}</span>
              </div>
            </div>
          `;
        }

        // Card click handler opens modal
        card.addEventListener('click', (e) => {
          if (e.target.closest('.snapshot-card-delete')) return;
          openSnapshotModal(snapshot.id);
        });

        // Delete badge click handler
        const deleteBtn = card.querySelector('.snapshot-card-delete');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete "${snapshot.name || 'this snapshot'}"?`)) {
              deleteSnapshotHandler(snapshot.id);
            }
          });
        }

        galleryGrid.appendChild(card);
      });
    })
    .catch(err => {
      console.error("Failed to render snapshot gallery:", err);
    });
}

function openSnapshotModal(id) {
  snapshotStore.get(id)
    .then(snapshot => {
      if (!snapshot) {
        alert("Snapshot not found!");
        return;
      }

      const modal = document.getElementById('snapshot-modal');
      const modalImg = document.getElementById('modal-img');
      const modalTitle = document.getElementById('modal-title');
      const modalDate = document.getElementById('modal-date');
      const poseSwitcher = document.getElementById('modal-pose-switcher');
      const thumbnailsContainer = document.getElementById('modal-thumbnails-container');

      if (modalTitle) modalTitle.textContent = snapshot.name || "Snapshot Analytics";
      
      const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
      const dateStr = new Date(snapshot.timestamp).toLocaleDateString(undefined, dateOptions);
      if (modalDate) modalDate.textContent = `Captured on ${dateStr}`;

      const m = snapshot.metrics;
      const isCombined = snapshot.isCombinedSession || (m && m.isCombinedSession);
      const modalSectionWidths = document.getElementById('modal-section-widths');
      const modalSectionHandTracking = document.getElementById('modal-section-hand-tracking');

      if (isCombined) {
        // Show switcher and thumbnails containers
        if (poseSwitcher) {
          poseSwitcher.classList.remove('hidden');
          poseSwitcher.classList.add('visible-flex');
        }
        if (thumbnailsContainer) {
          thumbnailsContainer.classList.remove('hidden');
          thumbnailsContainer.classList.add('visible-flex');
        }
        if (modalSectionWidths) {
          modalSectionWidths.classList.add('hidden');
          modalSectionWidths.classList.remove('visible-flex', 'visible-block');
        }
        if (modalSectionHandTracking) {
          modalSectionHandTracking.classList.add('hidden');
          modalSectionHandTracking.classList.remove('visible-flex', 'visible-block');
        }

        // Set thumbnail sources
        const thumbA = document.getElementById('modal-thumb-a');
        const thumbT = document.getElementById('modal-thumb-t');
        const thumbOverhead = document.getElementById('modal-thumb-overhead');
        if (thumbA) thumbA.src = snapshot.imageA || snapshot.image;
        if (thumbT) thumbT.src = snapshot.imageT || snapshot.image;
        if (thumbOverhead) thumbOverhead.src = snapshot.imageOverhead || snapshot.image;

        // Reset active states for switcher buttons & thumbnail wrappers
        const btnSwitchA = document.getElementById('btn-switch-a');
        const btnSwitchT = document.getElementById('btn-switch-t');
        const btnSwitchOverhead = document.getElementById('btn-switch-overhead');
        
        let wrapperA = null, wrapperT = null, wrapperOverhead = null;
        if (thumbnailsContainer) {
          wrapperA = thumbnailsContainer.querySelector('.thumb-wrapper[data-pose="A"]');
          wrapperT = thumbnailsContainer.querySelector('.thumb-wrapper[data-pose="T"]');
          wrapperOverhead = thumbnailsContainer.querySelector('.thumb-wrapper[data-pose="Overhead"]');
        }

        const setActivePoseInModal = (poseKey) => {
          // Clear all active classes
          [btnSwitchA, btnSwitchT, btnSwitchOverhead].forEach(btn => btn?.classList.remove('active'));
          [wrapperA, wrapperT, wrapperOverhead].forEach(wr => wr?.classList.remove('active'));

          let activeImg = snapshot.image;
          let poseLabel = "A-Pose";
          let poseColor = "#818cf8"; // Violet

          if (poseKey === 'A') {
            btnSwitchA?.classList.add('active');
            wrapperA?.classList.add('active');
            activeImg = snapshot.imageA || snapshot.image;
            poseLabel = "A-Pose";
            poseColor = "#818cf8";
          } else if (poseKey === 'T') {
            btnSwitchT?.classList.add('active');
            wrapperT?.classList.add('active');
            activeImg = snapshot.imageT || snapshot.image;
            poseLabel = "T-Pose";
            poseColor = "#06b6d4"; // Cyan
          } else if (poseKey === 'Overhead') {
            btnSwitchOverhead?.classList.add('active');
            wrapperOverhead?.classList.add('active');
            activeImg = snapshot.imageOverhead || snapshot.image;
            poseLabel = "Overhead Reach";
            poseColor = "#10b981"; // Emerald
          }

          if (modalImg) modalImg.src = activeImg;
          setModalMetric('modal-val-pose', poseLabel);
          const modalPoseElem = document.getElementById('modal-val-pose');
          if (modalPoseElem) {
            modalPoseElem.classList.remove('pose-color-t', 'pose-color-overhead', 'pose-color-default');
            if (poseKey === 'T') {
              modalPoseElem.classList.add('pose-color-t');
            } else if (poseKey === 'Overhead') {
              modalPoseElem.classList.add('pose-color-overhead');
            } else {
              modalPoseElem.classList.add('pose-color-default');
            }
          }

          // Update joint angles for this specific pose
          let angles = null;
          if (poseKey === 'A') angles = m.anglesA;
          else if (poseKey === 'T') angles = m.anglesT;
          else if (poseKey === 'Overhead') angles = m.anglesOverhead;

          if (angles) {
            setModalMetric('modal-angle-knee-l', angles.kneeAngleL !== undefined && angles.kneeAngleL !== null ? `${Math.round(angles.kneeAngleL)}°` : "--°");
            setModalMetric('modal-angle-knee-r', angles.kneeAngleR !== undefined && angles.kneeAngleR !== null ? `${Math.round(angles.kneeAngleR)}°` : "--°");
            setModalMetric('modal-angle-hip-l', angles.hipAngleL !== undefined && angles.hipAngleL !== null ? `${Math.round(angles.hipAngleL)}°` : "--°");
            setModalMetric('modal-angle-hip-r', angles.hipAngleR !== undefined && angles.hipAngleR !== null ? `${Math.round(angles.hipAngleR)}°` : "--°");
            setModalMetric('modal-angle-elbow-l', angles.elbowAngleL !== undefined && angles.elbowAngleL !== null ? `${Math.round(angles.elbowAngleL)}°` : "--°");
            setModalMetric('modal-angle-elbow-r', angles.elbowAngleR !== undefined && angles.elbowAngleR !== null ? `${Math.round(angles.elbowAngleR)}°` : "--°");
          } else {
            // Fallback to global metrics if angles object is missing
            setModalMetric('modal-angle-knee-l', m.kneeAngleL !== undefined ? `${m.kneeAngleL}°` : "--°");
            setModalMetric('modal-angle-knee-r', m.kneeAngleR !== undefined ? `${m.kneeAngleR}°` : "--°");
            setModalMetric('modal-angle-hip-l', m.hipAngleL !== undefined ? `${m.hipAngleL}°` : "--°");
            setModalMetric('modal-angle-hip-r', m.hipAngleR !== undefined ? `${m.hipAngleR}°` : "--°");
            setModalMetric('modal-angle-elbow-l', m.elbowAngleL !== undefined ? `${m.elbowAngleL}°` : "--°");
            setModalMetric('modal-angle-elbow-r', m.elbowAngleR !== undefined ? `${m.elbowAngleR}°` : "--°");
          }
        };

        // Default to A-Pose on open
        setActivePoseInModal('A');

        // Bind click handlers for switching
        const removeOldListenersAndAdd = (elem, handler) => {
          if (!elem) return;
          const clone = elem.cloneNode(true);
          elem.parentNode.replaceChild(clone, elem);
          clone.addEventListener('click', handler);
          return clone;
        };

        removeOldListenersAndAdd(btnSwitchA, () => setActivePoseInModal('A'));
        removeOldListenersAndAdd(btnSwitchT, () => setActivePoseInModal('T'));
        removeOldListenersAndAdd(btnSwitchOverhead, () => setActivePoseInModal('Overhead'));

        removeOldListenersAndAdd(wrapperA, () => setActivePoseInModal('A'));
        removeOldListenersAndAdd(wrapperT, () => setActivePoseInModal('T'));
        removeOldListenersAndAdd(wrapperOverhead, () => setActivePoseInModal('Overhead'));

      } else {
        // Normal snapshot: hide switcher and thumbnails
        if (poseSwitcher) {
          poseSwitcher.classList.add('hidden');
          poseSwitcher.classList.remove('visible-flex');
        }
        if (thumbnailsContainer) {
          thumbnailsContainer.classList.add('hidden');
          thumbnailsContainer.classList.remove('visible-flex');
        }
        if (modalSectionWidths) {
          modalSectionWidths.classList.remove('hidden');
          modalSectionWidths.classList.add('visible-block');
        }
        if (modalSectionHandTracking) {
          modalSectionHandTracking.classList.remove('hidden');
          modalSectionHandTracking.classList.add('visible-block');
        }
        if (modalImg) modalImg.src = snapshot.image;

        if (m) {
          setModalMetric('modal-val-pose', m.pose || "A-Pose");
          const modalPoseElem = document.getElementById('modal-val-pose');
          if (modalPoseElem) {
            modalPoseElem.classList.remove('pose-color-t', 'pose-color-overhead', 'pose-color-default');
            if (m.pose === "T-Pose") modalPoseElem.classList.add('pose-color-t');
            else if (m.pose === "Overhead Reach") modalPoseElem.classList.add('pose-color-overhead');
            else modalPoseElem.classList.add('pose-color-default');
          }

          setModalMetric('modal-angle-knee-l', m.kneeAngleL !== undefined ? `${m.kneeAngleL}°` : "--°");
          setModalMetric('modal-angle-knee-r', m.kneeAngleR !== undefined ? `${m.kneeAngleR}°` : "--°");
          setModalMetric('modal-angle-hip-l', m.hipAngleL !== undefined ? `${m.hipAngleL}°` : "--°");
          setModalMetric('modal-angle-hip-r', m.hipAngleR !== undefined ? `${m.hipAngleR}°` : "--°");
          setModalMetric('modal-angle-elbow-l', m.elbowAngleL !== undefined ? `${m.elbowAngleL}°` : "--°");
          setModalMetric('modal-angle-elbow-r', m.elbowAngleR !== undefined ? `${m.elbowAngleR}°` : "--°");
        }
      }

      if (m) {
        // Global and anatomical segments are populated from optimal poses
        // (Limb lengths, height, and widths come from optimal poses stored in metrics)
        setModalMetric('modal-val-height', formatSkeletalHeight(m.skeletal_height));
        setModalMetric('modal-val-wingspan', m.wingspan ? formatSkeletalHeight(m.wingspan) : "--.-");

        setModalMetric('modal-val-thigh-l', m.thigh_l !== undefined ? formatSkeletalHeight(m.thigh_l) : "--.-");
        setModalMetric('modal-val-thigh-r', m.thigh_r !== undefined ? formatSkeletalHeight(m.thigh_r) : "--.-");
        setModalMetric('modal-val-shin-l', m.shin_l !== undefined ? formatSkeletalHeight(m.shin_l) : "--.-");
        setModalMetric('modal-val-shin-r', m.shin_r !== undefined ? formatSkeletalHeight(m.shin_r) : "--.-");
        setModalMetric('modal-val-foot-l', m.foot_l !== undefined ? formatSkeletalHeight(m.foot_l) : "--.-");
        setModalMetric('modal-val-foot-r', m.foot_r !== undefined ? formatSkeletalHeight(m.foot_r) : "--.-");

        setModalMetric('modal-val-torso-l', m.torso_l !== undefined ? formatSkeletalHeight(m.torso_l) : "--.-");
        setModalMetric('modal-val-torso-r', m.torso_r !== undefined ? formatSkeletalHeight(m.torso_r) : "--.-");
        setModalMetric('modal-val-upperarm-l', m.upperarm_l !== undefined ? formatSkeletalHeight(m.upperarm_l) : "--.-");
        setModalMetric('modal-val-upperarm-r', m.upperarm_r !== undefined ? formatSkeletalHeight(m.upperarm_r) : "--.-");
        setModalMetric('modal-val-forearm-l', m.forearm_l !== undefined ? formatSkeletalHeight(m.forearm_l) : "--.-");
        setModalMetric('modal-val-forearm-r', m.forearm_r !== undefined ? formatSkeletalHeight(m.forearm_r) : "--.-");

        if (m.fingerToToeL !== undefined && m.fingerToToeR !== undefined) {
          setModalMetric('modal-val-overhead-reach', `L: ${formatSkeletalHeight(m.fingerToToeL)} / R: ${formatSkeletalHeight(m.fingerToToeR)}`);
        } else {
          setModalMetric('modal-val-overhead-reach', "--.-");
        }
        setModalMetric('modal-val-hip-w', m.hipW !== undefined ? formatSkeletalHeight(m.hipW) : "--.-");

        setModalMetric('modal-val-pinch-l', m.pinch_l_cm !== undefined && m.pinch_l_cm !== null ? formatSkeletalHeight(m.pinch_l_cm) : "--.-");
        setModalMetric('modal-val-pinch-r', m.pinch_r_cm !== undefined && m.pinch_r_cm !== null ? formatSkeletalHeight(m.pinch_r_cm) : "--.-");
        setModalMetric('modal-val-span-l', m.span_l_cm !== undefined && m.span_l_cm !== null ? formatSkeletalHeight(m.span_l_cm) : "--.-");
        setModalMetric('modal-val-span-r', m.span_r_cm !== undefined && m.span_r_cm !== null ? formatSkeletalHeight(m.span_r_cm) : "--.-");
      }

      // Clone download & delete buttons to purge old listeners
      const dlBtn = document.getElementById('modal-dl-btn');
      const delBtn = document.getElementById('modal-del-btn');

      if (dlBtn) {
        const newDlBtn = dlBtn.cloneNode(true);
        dlBtn.parentNode.replaceChild(newDlBtn, dlBtn);
        newDlBtn.addEventListener('click', () => {
          const activeImageSrc = modalImg ? modalImg.src : snapshot.image;
          downloadSnapshotImage(activeImageSrc, snapshot.name || 'biomechanical-snapshot');
        });
      }

      if (delBtn) {
        const newDelBtn = delBtn.cloneNode(true);
        delBtn.parentNode.replaceChild(newDelBtn, delBtn);
        newDelBtn.addEventListener('click', () => {
          if (confirm(`Are you sure you want to delete "${snapshot.name || 'this snapshot'}"?`)) {
            deleteSnapshotHandler(snapshot.id);
            closeSnapshotModal();
          }
        });
      }

      if (modal) modal.classList.add('active');
    })
    .catch(err => {
      console.error("Failed to load snapshot details for modal:", err);
    });
}

function setModalMetric(elementId, text) {
  const elem = document.getElementById(elementId);
  if (elem) elem.textContent = text;
}

function closeSnapshotModal() {
  const modal = document.getElementById('snapshot-modal');
  if (modal) modal.classList.remove('active');
}

function deleteSnapshotHandler(id) {
  snapshotStore.delete(id)
    .then(() => {
      renderGallery();
      statusElement.textContent = "🗑️ Snapshot deleted successfully.";
    })
    .catch(err => {
      console.error("Failed to delete snapshot:", err);
    });
}

// ==========================================
// COMPONENT INTERACTIVE EVENT BINDINGS
// ==========================================

// Calibration box size slider listeners
slider.addEventListener('input', (e) => {
  state.calBoxSize = parseInt(e.target.value);
  sliderValDisplay.textContent = `${state.calBoxSize} px`;
  if (state.calLocked) {
    state.calLocked = false;
    lockCalButton.textContent = "Lock 20cm Calibration";
    lockCalButton.classList.add('cal-btn-unlocked');
    lockCalButton.classList.remove('cal-btn-locked');
  }
});

lockCalButton.addEventListener('click', () => {
  state.pixelsPerCm = state.calBoxSize / MARKER_PHYSICAL_SIZE_CM;
  state.calLocked = true;
  lockCalButton.textContent = "✅ Scale Locked!";
  lockCalButton.classList.add('cal-btn-locked');
  lockCalButton.classList.remove('cal-btn-unlocked');
  statusElement.textContent = `Scale calibrated: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
});

// Preset Position buttons
const posLeftBtn = document.getElementById('pos-left-btn');
const posCenterBtn = document.getElementById('pos-center-btn');
const posRightBtn = document.getElementById('pos-right-btn');

function updatePosBtnStyles(activeBtn) {
  [posLeftBtn, posCenterBtn, posRightBtn].forEach(btn => {
    btn.classList.toggle('btn-tab-active', btn === activeBtn);
    btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
  });
}

posLeftBtn.addEventListener('click', () => {
  const w = state.canvasWidth || 640;
  const h = state.canvasHeight || 480;
  state.calBoxX = w * 0.15;
  state.calBoxY = h / 2;
  updatePosBtnStyles(posLeftBtn);
});

posCenterBtn.addEventListener('click', () => {
  const w = state.canvasWidth || 640;
  const h = state.canvasHeight || 480;
  state.calBoxX = w / 2;
  state.calBoxY = h / 2;
  updatePosBtnStyles(posCenterBtn);
});

posRightBtn.addEventListener('click', () => {
  const w = state.canvasWidth || 640;
  const h = state.canvasHeight || 480;
  state.calBoxX = w * 0.85;
  state.calBoxY = h / 2;
  updatePosBtnStyles(posRightBtn);
});

// Mouse/Touch Drag and Drop positioning logic for the calibration guide box
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

canvasElement.addEventListener('mousedown', (e) => {
  const rect = canvasElement.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const w = state.canvasWidth || 640;
  const h = state.canvasHeight || 480;
  const canvasMouseX = (mouseX / rect.width) * w;
  const canvasMouseY = (mouseY / rect.height) * h;
  
  const x1 = state.calBoxX - state.calBoxSize / 2;
  const y1 = state.calBoxY - state.calBoxSize / 2;
  const x2 = state.calBoxX + state.calBoxSize / 2;
  const y2 = state.calBoxY + state.calBoxSize / 2;
  
  if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
    isDragging = true;
    dragStartX = canvasMouseX - state.calBoxX;
    dragStartY = canvasMouseY - state.calBoxY;
  }
});

canvasElement.addEventListener('mousemove', (e) => {
  const rect = canvasElement.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const w = state.canvasWidth || 640;
  const h = state.canvasHeight || 480;
  const canvasMouseX = (mouseX / rect.width) * w;
  const canvasMouseY = (mouseY / rect.height) * h;
  
  const x1 = state.calBoxX - state.calBoxSize / 2;
  const y1 = state.calBoxY - state.calBoxSize / 2;
  const x2 = state.calBoxX + state.calBoxSize / 2;
  const y2 = state.calBoxY + state.calBoxSize / 2;
  
  if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
    canvasElement.classList.add('cursor-move');
    canvasElement.classList.remove('cursor-default');
  } else {
    if (!isDragging) {
      canvasElement.classList.add('cursor-default');
      canvasElement.classList.remove('cursor-move');
    }
  }
  
  if (isDragging) {
    state.calBoxX = Math.max(state.calBoxSize/2, Math.min(w - state.calBoxSize/2, canvasMouseX - dragStartX));
    state.calBoxY = Math.max(state.calBoxSize/2, Math.min(h - state.calBoxSize/2, canvasMouseY - dragStartY));
  }
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// Touch support for dragging
canvasElement.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const rect = canvasElement.getBoundingClientRect();
    const touch = e.touches[0];
    const mouseX = touch.clientX - rect.left;
    const mouseY = touch.clientY - rect.top;
    
    const w = state.canvasWidth || 640;
    const h = state.canvasHeight || 480;
    const canvasMouseX = (mouseX / rect.width) * w;
    const canvasMouseY = (mouseY / rect.height) * h;
    
    const x1 = state.calBoxX - state.calBoxSize / 2;
    const y1 = state.calBoxY - state.calBoxSize / 2;
    const x2 = state.calBoxX + state.calBoxSize / 2;
    const y2 = state.calBoxY + state.calBoxSize / 2;
    
    if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
      isDragging = true;
      dragStartX = canvasMouseX - state.calBoxX;
      dragStartY = canvasMouseY - state.calBoxY;
      e.preventDefault();
    }
  }
});

canvasElement.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    const rect = canvasElement.getBoundingClientRect();
    const touch = e.touches[0];
    const mouseX = touch.clientX - rect.left;
    const mouseY = touch.clientY - rect.top;
    
    const w = state.canvasWidth || 640;
    const h = state.canvasHeight || 480;
    const canvasMouseX = (mouseX / rect.width) * w;
    const canvasMouseY = (mouseY / rect.height) * h;
    
    state.calBoxX = Math.max(state.calBoxSize/2, Math.min(w - state.calBoxSize/2, canvasMouseX - dragStartX));
    state.calBoxY = Math.max(state.calBoxSize/2, Math.min(h - state.calBoxSize/2, canvasMouseY - dragStartY));
    e.preventDefault();
  }
});

window.addEventListener('touchend', () => {
  isDragging = false;
});

function updateSidebarPlaceholders() {
  const updatePlaceholder = (elem, textWithCm, textWithInches) => {
    if (!elem) return;
    const current = elem.textContent.trim();
    if (current.includes('--.-') || current.includes("--'") || current === "" || current === "Offline") {
      elem.textContent = state.useInches ? textWithInches : textWithCm;
    }
  };

  updatePlaceholder(thighLDisp, "--.- cm", "--.- inches");
  updatePlaceholder(thighRDisp, "--.- cm", "--.- inches");
  updatePlaceholder(shinLDisp, "--.- cm", "--.- inches");
  updatePlaceholder(shinRDisp, "--.- cm", "--.- inches");
  updatePlaceholder(footLDisp, "--.- cm", "--.- inches");
  updatePlaceholder(footRDisp, "--.- cm", "--.- inches");
  
  updatePlaceholder(torsoLDisp, "--.- cm", "--.- inches");
  updatePlaceholder(torsoRDisp, "--.- cm", "--.- inches");
  updatePlaceholder(upperarmLDisp, "--.- cm", "--.- inches");
  updatePlaceholder(upperarmRDisp, "--.- cm", "--.- inches");
  updatePlaceholder(forearmLDisp, "--.- cm", "--.- inches");
  updatePlaceholder(forearmRDisp, "--.- cm", "--.- inches");

  updatePlaceholder(fingerToToeDisp, "L: --.- cm / R: --.- cm", "L: --.- inches / R: --.- inches");
  updatePlaceholder(hipWDisp, "--.- cm", "--.- inches");
  updatePlaceholder(wingspanDisp, "--.- cm", "--.- inches");

  updatePlaceholder(heightCmDisp, "--.- cm", "--'--''");
  updatePlaceholder(heightFtDisp, "--'--'' (Stature)", "--.- cm (Stature)");
}

// Initial placeholder configuration on script load
setTimeout(updateSidebarPlaceholders, 100);

// Multi-unit system controls (Inches/Cm togglers)
const unitInchBtn = document.getElementById('unit-inch-btn');
const unitCmBtn = document.getElementById('unit-cm-btn');

unitInchBtn.addEventListener('click', () => {
  state.useInches = true;
  unitInchBtn.classList.add('active');
  unitCmBtn.classList.remove('active');
  updateHeightInputUnit();
  updateStateInputHeight();
  updateStateValidationHeight();
  updateSidebarPlaceholders();
  if (state.isSnapshotFrozen && state.frozenMetrics) {
    renderDashboard(state.frozenMetrics);
  }
  if (state.dbInitialized) {
    renderGallery();
  }
});

unitCmBtn.addEventListener('click', () => {
  state.useInches = false;
  unitCmBtn.classList.add('active');
  unitInchBtn.classList.remove('active');
  updateHeightInputUnit();
  updateStateInputHeight();
  updateStateValidationHeight();
  updateSidebarPlaceholders();
  if (state.isSnapshotFrozen && state.frozenMetrics) {
    renderDashboard(state.frozenMetrics);
  }
  if (state.dbInitialized) {
    renderGallery();
  }
});

// Switch calibration tabs
function switchCalibrationTab(method, activeBtn, activePanel) {
  state.activeCalMethod = method;
  
  [tabArucoBtn, tabHeightBtn, tabValidationBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('btn-tab-active', btn === activeBtn);
      btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
    }
  });

  [panelAruco, panelCard, panelHeight, panelValidation].forEach(panel => {
    if (panel) {
      if (panel === activePanel) {
        panel.classList.remove('hidden');
        panel.classList.add('visible-flex');
      } else {
        panel.classList.add('hidden');
        panel.classList.remove('visible-flex');
      }
    }
  });

  // Set calibration state based on chosen method
  if (method === 'height') {
    state.pixelsPerCm = null; // Calculated dynamically in frame loop
    state.calLocked = true;   // Automatically consider locked/calibrated
  } else {
    state.pixelsPerCm = null;
    state.calLocked = false;
    if (method === 'card') {
      lockCalButton.textContent = "Lock 20cm Calibration";
      lockCalButton.classList.add('cal-btn-unlocked');
      lockCalButton.classList.remove('cal-btn-locked');
    }
  }
}

tabArucoBtn.addEventListener('click', () => {
  switchCalibrationTab('aruco', tabArucoBtn, panelAruco);
});

tabHeightBtn.addEventListener('click', () => {
  switchCalibrationTab('height', tabHeightBtn, panelHeight);
});

tabValidationBtn.addEventListener('click', () => {
  switchCalibrationTab('validation', tabValidationBtn, panelValidation);
});

const inputUserHeight = document.getElementById('input-user-height');

function updateStateInputHeight() {
  const inputElem = document.getElementById('input-user-height');
  if (!inputElem) return;
  const inputVal = parseFloat(inputElem.value);
  if (!isNaN(inputVal)) {
    if (state.useInches) {
      state.inputHeightCm = inputVal * 2.54;
    } else {
      state.inputHeightCm = inputVal;
    }
  }
}

if (inputUserHeight) {
  inputUserHeight.addEventListener('input', updateStateInputHeight);
  updateStateInputHeight();
}

function updateStateValidationHeight() {
  const inputElem = document.getElementById('input-validation-height');
  if (!inputElem) return;
  const inputVal = parseFloat(inputElem.value);
  if (!isNaN(inputVal)) {
    if (state.useInches) {
      state.validationHeightCm = inputVal * 2.54;
    } else {
      state.validationHeightCm = inputVal;
    }
  }
}

if (inputValidationHeight) {
  inputValidationHeight.addEventListener('input', updateStateValidationHeight);
  updateStateValidationHeight();
}

function syncWallPerspectiveEnabled(enabled) {
  const wasEnabled = state.wallPerspectiveEnabled;
  state.wallPerspectiveEnabled = enabled;

  // Sync checkboxes
  const toggleCal = document.getElementById('toggle-wall-perspective');
  const toggleVal = document.getElementById('toggle-wall-perspective-validation');
  if (toggleCal) toggleCal.checked = enabled;
  if (toggleVal) toggleVal.checked = enabled;

  // Sync container visibilities
  const containerCal = document.getElementById('wall-perspective-container');
  const containerVal = document.getElementById('wall-perspective-container-validation');
  if (containerCal) {
    if (enabled) containerCal.classList.remove('hidden');
    else containerCal.classList.add('hidden');
  }
  if (containerVal) {
    if (enabled) containerVal.classList.remove('hidden');
    else containerVal.classList.add('hidden');
  }

  // Adjust cached pixelsPerCm immediately if it exists
  if (state.pixelsPerCm && wasEnabled !== enabled) {
    if (enabled) {
      state.pixelsPerCm *= state.wallPerspectiveFactor;
    } else {
      state.pixelsPerCm /= state.wallPerspectiveFactor;
    }

    // Update UI status texts
    const arucoStatusText = document.getElementById('aruco-status-text');
    if (arucoStatusText && state.activeCalMethod === 'aruco') {
      arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
    }
    const validationStatusText = document.getElementById('validation-status-text');
    if (validationStatusText && state.activeCalMethod === 'validation') {
      validationStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
    }
  }
}

function syncWallPerspectiveFactor(newVal) {
  const oldVal = state.wallPerspectiveFactor;
  if (isNaN(newVal) || newVal < 1.00 || newVal > 1.25) {
    return; // Allow temporary invalid states while typing, but do not apply them
  }

  if (newVal === oldVal) return;

  state.wallPerspectiveFactor = newVal;

  // Sync text inputs
  const inputCal = document.getElementById('wall-perspective-input');
  const inputVal = document.getElementById('wall-perspective-input-validation');
  if (inputCal && parseFloat(inputCal.value) !== newVal) {
    inputCal.value = newVal.toFixed(2);
  }
  if (inputVal && parseFloat(inputVal.value) !== newVal) {
    inputVal.value = newVal.toFixed(2);
  }

  // Adjust cached pixelsPerCm immediately if it exists
  if (state.wallPerspectiveEnabled && state.pixelsPerCm && oldVal > 0) {
    state.pixelsPerCm = (state.pixelsPerCm / oldVal) * newVal;

    // Update UI status texts
    const arucoStatusText = document.getElementById('aruco-status-text');
    if (arucoStatusText && state.activeCalMethod === 'aruco') {
      arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
    }
    const validationStatusText = document.getElementById('validation-status-text');
    if (validationStatusText && state.activeCalMethod === 'validation') {
      validationStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
    }
  }
}

// Initial Sync from state on load
const toggleWallPerspective = document.getElementById('toggle-wall-perspective');
const toggleWallPerspectiveValidation = document.getElementById('toggle-wall-perspective-validation');
const wallPerspectiveInput = document.getElementById('wall-perspective-input');
const wallPerspectiveInputValidation = document.getElementById('wall-perspective-input-validation');

if (toggleWallPerspective) toggleWallPerspective.checked = state.wallPerspectiveEnabled;
if (toggleWallPerspectiveValidation) toggleWallPerspectiveValidation.checked = state.wallPerspectiveEnabled;

const containerCal = document.getElementById('wall-perspective-container');
const containerVal = document.getElementById('wall-perspective-container-validation');
if (containerCal) {
  if (state.wallPerspectiveEnabled) containerCal.classList.remove('hidden');
  else containerCal.classList.add('hidden');
}
if (containerVal) {
  if (state.wallPerspectiveEnabled) containerVal.classList.remove('hidden');
  else containerVal.classList.add('hidden');
}

if (wallPerspectiveInput) wallPerspectiveInput.value = state.wallPerspectiveFactor.toFixed(2);
if (wallPerspectiveInputValidation) wallPerspectiveInputValidation.value = state.wallPerspectiveFactor.toFixed(2);

// Event Listeners for Toggles
if (toggleWallPerspective) {
  toggleWallPerspective.addEventListener('change', (e) => {
    syncWallPerspectiveEnabled(e.target.checked);
  });
}
if (toggleWallPerspectiveValidation) {
  toggleWallPerspectiveValidation.addEventListener('change', (e) => {
    syncWallPerspectiveEnabled(e.target.checked);
  });
}

// Event Listeners for Inputs (real-time keypresses)
if (wallPerspectiveInput) {
  wallPerspectiveInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    syncWallPerspectiveFactor(val);
  });
  wallPerspectiveInput.addEventListener('blur', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val) || val < 1.00) val = 1.00;
    if (val > 1.25) val = 1.25;
    e.target.value = val.toFixed(2);
    syncWallPerspectiveFactor(val);
  });
}
if (wallPerspectiveInputValidation) {
  wallPerspectiveInputValidation.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    syncWallPerspectiveFactor(val);
  });
  wallPerspectiveInputValidation.addEventListener('blur', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val) || val < 1.00) val = 1.00;
    if (val > 1.25) val = 1.25;
    e.target.value = val.toFixed(2);
    syncWallPerspectiveFactor(val);
  });
}

// Background isolation click handler
yoloToggleBtn.addEventListener('click', () => {
  state.yoloModeActive = !state.yoloModeActive;
  if (state.yoloModeActive) {
    yoloToggleBtn.textContent = "Disable Background Isolation";
    yoloToggleBtn.classList.add('active');
    
    // Hide standard video underneath so canvas can show the background cutout
    videoElement.classList.add('video-dimmed');
    videoElement.classList.remove('video-visible');
  } else {
    yoloToggleBtn.textContent = "Enable Background Isolation";
    yoloToggleBtn.classList.remove('active');
    
    // Restore standard video opacity
    videoElement.classList.add('video-visible');
    videoElement.classList.remove('video-dimmed');
  }
});

// Start capture button listener
captureBtn.addEventListener('click', () => {
  if (state.isSnapshotFrozen) {
    resetAndResume();
    return;
  }
  
  if (state.isCaptureCountingDown || state.isCountingDown) return; // Prevent double trigger
  
  // Ensure tracking has actually found landmarks at least once (i.e. scale calibration or skeletal tracking active)
  if (state.lastVerticalHeightPx === 0) {
    alert("Please stand in view of the camera and let the system track your body before capturing a snapshot!");
    return;
  }
  
  // Start 5-second countdown
  state.isCaptureCountingDown = true;
  state.captureCountdownValue = 5;
  captureBtn.textContent = "Get in Position (5s)...";
  statusElement.textContent = "Preparing snapshot. Step back and stand straight in view of the camera...";
  
  const captureInterval = setInterval(() => {
    state.captureCountdownValue--;
    if (state.captureCountdownValue > 0) {
      captureBtn.textContent = `Get in Position (${state.captureCountdownValue}s)...`;
      statusElement.textContent = `Preparing snapshot. Calibrating posture in ${state.captureCountdownValue} seconds...`;
    } else {
      clearInterval(captureInterval);
      // Zero state trigger. The main frame processor loop will detect this inside 'onResults'
      // and call captureSnapshot() with the frame matching this exact tick!
    }
  }, 1000);
});

// Start automated sequential capture click listener
const autoSequenceBtn = document.getElementById('auto-sequence-btn');
if (autoSequenceBtn) {
  autoSequenceBtn.addEventListener('click', () => {
    if (state.autoActive) {
      cancelAutoSequence();
      statusElement.textContent = "Automated sequential capture sequence cancelled.";
      return;
    }

    if (state.isSnapshotFrozen) {
      resetAndResume();
    }

    if (state.isCaptureCountingDown || state.isCountingDown) return; // Prevent double trigger

    // Check if calibrated
    if (!state.pixelsPerCm || state.pixelsPerCm <= 0) {
      alert("Please lock your 20cm Calibration (ArUco or Direct Card) first before starting Hands-Free Auto Capture!");
      return;
    }

    // Initialize state
    state.autoActive = true;
    state.autoState = 'WAITING_A';
    state.holdTimerMs = 0;
    state.lockoutTimerMs = 0;
    state.lastFrameTime = Date.now();
    state.currentGroupId = Date.now();
    
    state.frozenAutoJoints = null;
    state.frozenAutoMetrics = null;
    state.metricsA = null;
    state.metricsT = null;
    state.metricsOverhead = null;

    autoSequenceBtn.textContent = "Cancel Auto Sequence";
    autoSequenceBtn.classList.add('active-cancel');

    statusElement.textContent = "🚀 Hands-Free Auto Capture started! Please stand in A-Pose (arms resting relaxed at sides).";
  });
}

// Close modal buttons
const modalCloseBtn = document.getElementById('modal-close-btn');
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', closeSnapshotModal);
}

const modalOverlay = document.getElementById('snapshot-modal');
if (modalOverlay) {
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      closeSnapshotModal();
    }
  });
}
