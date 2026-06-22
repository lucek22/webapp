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
const frozenFrameCanvas = document.createElement('canvas');
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
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.fontSize = '0.68rem';
    item.style.padding = '0.2rem 0.4rem';
    item.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
    item.style.borderRadius = '4px';
    item.style.borderLeft = '2.5px solid #1e293b';
    
    let sideColor = '#9ca3af'; // default face/neutral
    if (idx <= 10) {
      sideColor = '#ec4899'; // face
      item.style.borderLeftColor = sideColor;
    } else if (idx === 11 || idx === 13 || idx === 15 || idx === 17 || idx === 19 || idx === 21) {
      sideColor = '#06b6d4'; // left arm
      item.style.borderLeftColor = sideColor;
    } else if (idx === 12 || idx === 14 || idx === 16 || idx === 18 || idx === 20 || idx === 22) {
      sideColor = '#a855f7'; // right arm
      item.style.borderLeftColor = sideColor;
    } else if (idx === 23 || idx === 25 || idx === 27 || idx === 29 || idx === 31) {
      sideColor = '#10b981'; // left leg
      item.style.borderLeftColor = sideColor;
    } else if (idx === 24 || idx === 26 || idx === 28 || idx === 30 || idx === 32) {
      sideColor = '#f59e0b'; // right leg
      item.style.borderLeftColor = sideColor;
    }

    item.innerHTML = `
      <span style="color: ${sideColor}; font-weight: 600;">#${idx} ${name}</span>
      <span id="lm-status-${idx}" style="color: #64748b; font-family: monospace; font-size: 0.62rem;">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });

  // Append Left Hand Fingertips
  const handFingersL = [
    { name: 'Thumb Tip', color: '#ec4899', id: 'val-fingertip-l-0' },
    { name: 'Index Tip', color: '#06b6d4', id: 'val-fingertip-l-1' },
    { name: 'Middle Tip', color: '#a855f7', id: 'val-fingertip-l-2' },
    { name: 'Ring Tip', color: '#10b981', id: 'val-fingertip-l-3' },
    { name: 'Pinky Tip', color: '#f59e0b', id: 'val-fingertip-l-4' }
  ];

  handFingersL.forEach(f => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.fontSize = '0.68rem';
    item.style.padding = '0.2rem 0.4rem';
    item.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
    item.style.borderRadius = '4px';
    item.style.borderLeft = `2.5px solid ${f.color}`;
    
    item.innerHTML = `
      <span style="color: ${f.color}; font-weight: 600;">Left ${f.name}</span>
      <span id="${f.id}" style="color: #64748b; font-family: monospace; font-size: 0.62rem;">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });

  // Append Right Hand Fingertips
  const handFingersR = [
    { name: 'Thumb Tip', color: '#ec4899', id: 'val-fingertip-r-0' },
    { name: 'Index Tip', color: '#06b6d4', id: 'val-fingertip-r-1' },
    { name: 'Middle Tip', color: '#a855f7', id: 'val-fingertip-r-2' },
    { name: 'Ring Tip', color: '#10b981', id: 'val-fingertip-r-3' },
    { name: 'Pinky Tip', color: '#f59e0b', id: 'val-fingertip-r-4' }
  ];

  handFingersR.forEach(f => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.fontSize = '0.68rem';
    item.style.padding = '0.2rem 0.4rem';
    item.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
    item.style.borderRadius = '4px';
    item.style.borderLeft = `2.5px solid ${f.color}`;
    
    item.innerHTML = `
      <span style="color: ${f.color}; font-weight: 600;">Right ${f.name}</span>
      <span id="${f.id}" style="color: #64748b; font-family: monospace; font-size: 0.62rem;">Offline</span>
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

const panelAruco = document.getElementById('panel-aruco');
const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const arucoStatusText = document.getElementById('aruco-status-text');

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
      color = '#a855f7'; // Right Arm: Neon Purple
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

    const pts = landmarks.map(lm => ({ x: getCanvasX(lm.x), y: lm.y * 480 }));

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
    if (metrics.pose === "T-Pose") {
      activePoseDisp.style.color = "#06b6d4"; // Cyan
    } else if (metrics.pose === "Overhead Reach") {
      activePoseDisp.style.color = "#10b981"; // Emerald
    } else {
      activePoseDisp.style.color = "#818cf8"; // Violet
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
        
        // Compile and download consolidated session report
        compileAndDownloadCombinedSession();
        
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

  // Draw ArUco box overlay if detected and active tab is 'aruco'
  if (state.latestArucoMarker && state.activeCalMethod === 'aruco') {
    const corners = state.latestArucoMarker.corners.map(c => ({
      x: state.currentFacingMode === "user" ? 640 - c.x : c.x,
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
            if (landmark && landmark.visibility > 0.5) {
              statusSpan.textContent = "Online";
              statusSpan.style.color = "#10b981";
            } else if (landmark) {
              statusSpan.textContent = "Low Vis";
              statusSpan.style.color = "#f59e0b";
            } else {
              statusSpan.textContent = "Offline";
              statusSpan.style.color = "#64748b";
            }
          }
        });
      }

      // Draw standard skeletal mesh elements
      drawFullSkeletalMesh(all_landmarks);

      // --- DRAW NEON SKELETAL MARKERS ---
      // Shoulder and Hip spans
      drawBone(shoulder_l, shoulder_r, '#6366f1'); 
      drawBone(hip_l, hip_r, '#6366f1'); 
      
      // Torso Lines
      drawBone(shoulder_l, hip_l, '#38bdf8'); 
      drawBone(shoulder_r, hip_r, '#38bdf8'); 

      // Left Arm & Leg
      drawBone(shoulder_l, elbow_l, '#ec4899'); 
      drawBone(elbow_l, wrist_l, '#f43f5e'); 
      drawBone(hip_l, knee_l, '#a855f7'); 
      drawBone(knee_l, ankle_l, '#06b6d4'); 
      drawBone(ankle_l, heel_l, '#10b981'); 
      drawBone(heel_l, toe_l, '#10b981'); 

      // Right Arm & Leg
      drawBone(shoulder_r, elbow_r, '#ec4899'); 
      drawBone(elbow_r, wrist_r, '#f43f5e'); 
      drawBone(hip_r, knee_r, '#a855f7'); 
      drawBone(knee_r, ankle_r, '#06b6d4'); 
      drawBone(ankle_r, heel_r, '#10b981'); 
      drawBone(heel_r, toe_r, '#10b981'); 

      // Joint Nodes
      drawJoint(shoulder_l, '#6366f1');
      drawJoint(shoulder_r, '#6366f1');
      drawJoint(elbow_l, '#d946ef');
      drawJoint(elbow_r, '#d946ef');
      drawJoint(wrist_l, '#f43f5e');
      drawJoint(wrist_r, '#f43f5e');
      drawJoint(hip_l, '#a855f7');
      drawJoint(hip_r, '#a855f7');
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
            canvasCtx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
            canvasCtx.lineWidth = 1.5;
            drawRoundedRect(canvasCtx, barX, barY, barWidth, barHeight, 8);
            canvasCtx.fill();
            canvasCtx.stroke();
            
            if (progress > 0) {
              canvasCtx.save();
              const fillWidth = barWidth * progress;
              const grad = canvasCtx.createLinearGradient(barX, 0, barX + barWidth, 0);
              grad.addColorStop(0, '#a855f7');
              grad.addColorStop(1, '#6366f1');
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
            canvasCtx.shadowColor = '#a855f7';
            canvasCtx.shadowBlur = 6;
            const percentage = Math.floor(progress * 100);
            canvasCtx.fillText(`HOLDING ${detectedPose.toUpperCase()}: ${percentage}%`, 0, 0);
            canvasCtx.restore();
            
            canvasCtx.restore();

            if (state.holdTimerMs >= state.REQ_HOLD_MS) {
              triggerFlashEffect();
              
              // Cache current frame image on frozenFrameCanvas
              frozenFrameCtx.clearRect(0, 0, 640, 480);
              frozenFrameCtx.drawImage(canvasElement, 0, 0);
              
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
              
              // Save automatic snapshot to database in the background
              saveAutoSeqSnapshot(detectedPose, liveMetrics);

              // Trigger visual feedback lockout period
              state.lockoutTimerMs = state.LOCKOUT_MS;
              
              // Store specific pose metrics for combined export
              if (state.autoState === 'WAITING_A') {
                state.metricsA = JSON.parse(JSON.stringify(liveMetrics));
              } else if (state.autoState === 'WAITING_T') {
                state.metricsT = JSON.parse(JSON.stringify(liveMetrics));
              } else if (state.autoState === 'WAITING_OVERHEAD') {
                state.metricsOverhead = JSON.parse(JSON.stringify(liveMetrics));
              }
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
          }, liveMetrics);
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
    canvasCtx.strokeStyle = 'rgba(124, 58, 237, 0.3)';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(20, 20, canvasElement.width - 40, canvasElement.height - 40);

    canvasCtx.fillStyle = '#a78bfa'; // violet
    canvasCtx.strokeStyle = 'rgba(124, 58, 237, 0.5)';
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

  canvasCtx.restore();
}

// ==========================================
// CAPTURE TIMER & SNAPSHOT PROCESSING
// ==========================================

function captureSnapshot(joints, metrics) {
  state.isCaptureCountingDown = false;
  
  // Save deep copies of the joints coordinates and dashboard metrics
  state.frozenJoints = JSON.parse(JSON.stringify(joints));
  state.frozenMetrics = JSON.parse(JSON.stringify(metrics));
  state.frozenHandResults = state.latestHandResults ? JSON.parse(JSON.stringify(state.latestHandResults)) : null;
  
  // Save current frame image from canvas (if YOLO background isolated) or webcam
  frozenFrameCtx.clearRect(0, 0, 640, 480);
  if (state.yoloModeActive) {
    // Main canvas currently holds the isolated composite frame (before overlays were drawn)
    frozenFrameCtx.drawImage(canvasElement, 0, 0);
  } else {
    // Grab direct webcam stream and mirror it in memory if in user-facing mode
    frozenFrameCtx.save();
    if (state.currentFacingMode === "user") {
      frozenFrameCtx.translate(640, 0);
      frozenFrameCtx.scale(-1, 1);
    }
    frozenFrameCtx.drawImage(videoElement, 0, 0);
    frozenFrameCtx.restore();
  }

  state.isSnapshotFrozen = true;
  videoElement.style.opacity = '0'; // Completely hide live video feed under the canvas
  
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
    savePanel.style.display = 'flex';
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
  
  const autoSequenceBtn = document.getElementById('auto-sequence-btn');
  if (autoSequenceBtn) {
    autoSequenceBtn.textContent = "Hands-Free Auto Capture";
    autoSequenceBtn.style.background = "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)";
    autoSequenceBtn.style.border = "1px solid rgba(168, 85, 247, 0.4)";
    autoSequenceBtn.style.boxShadow = "0 4px 10px rgba(168, 85, 247, 0.2)";
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
  canvasCtx.strokeStyle = 'rgba(139, 92, 246, 0.6)';
  canvasCtx.lineWidth = 2;
  canvasCtx.shadowColor = 'rgba(139, 92, 246, 0.4)';
  canvasCtx.shadowBlur = 12;
  
  drawRoundedRect(canvasCtx, panelX, panelY, panelW, panelH, 12);
  canvasCtx.fill();
  canvasCtx.stroke();
  canvasCtx.shadowBlur = 0;
  
  canvasCtx.fillStyle = '#f43f5e';
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
    grad.addColorStop(0, '#f43f5e');
    grad.addColorStop(1, '#ec4899');
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

export function saveAutoSeqSnapshot(poseName, metrics) {
  const subjectInput = document.getElementById('subject-name-input');
  const subjectName = subjectInput ? subjectInput.value.trim() : '';
  const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const dateStr = new Date().toLocaleDateString('en-US', options);
  
  let label = "";
  if (subjectName) {
    label = `${subjectName} - ${poseName} - ${dateStr} (Auto)`;
  } else {
    label = `${poseName} - ${dateStr} (Auto)`;
  }

  // Retrieve active DOM pinch/span measurements in raw cm values
  const pinch_l_cm = getDomMeasurementCm('val-pinch-l');
  const pinch_r_cm = getDomMeasurementCm('val-pinch-r');
  const span_l_cm = getDomMeasurementCm('val-span-l');
  const span_r_cm = getDomMeasurementCm('val-span-r');

  const metricsToSave = {
    ...metrics,
    pinch_l_cm,
    pinch_r_cm,
    span_l_cm,
    span_r_cm
  };

  const snapshotRecord = {
    name: label,
    timestamp: Date.now(),
    image: frozenFrameCanvas.toDataURL('image/png'),
    metrics: metricsToSave
  };

  if (state.dbInitialized) {
    snapshotStore.save(snapshotRecord)
      .then(() => {
        console.log(`[AutoCapture] Saved "${label}" snapshot to IndexedDB gallery.`);
        renderGallery();
      })
      .catch(err => {
        console.error("[AutoCapture] Failed to save automatic snapshot to IndexedDB:", err);
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
    drawBone(shoulder_l, shoulder_r, '#6366f1'); 
    drawBone(hip_l, hip_r, '#6366f1'); 
    drawBone(shoulder_l, hip_l, '#38bdf8'); 
    drawBone(shoulder_r, hip_r, '#38bdf8'); 

    drawBone(shoulder_l, elbow_l, '#ec4899'); 
    drawBone(elbow_l, wrist_l, '#f43f5e'); 
    drawBone(hip_l, knee_l, '#a855f7'); 
    drawBone(knee_l, ankle_l, '#06b6d4'); 
    drawBone(ankle_l, heel_l, '#10b981'); 
    drawBone(heel_l, toe_l, '#10b981'); 

    drawBone(shoulder_r, elbow_r, '#ec4899'); 
    drawBone(elbow_r, wrist_r, '#f43f5e'); 
    drawBone(hip_r, knee_r, '#a855f7'); 
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
    drawJoint(hip_l, '#a855f7');
    drawJoint(hip_r, '#a855f7');
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
  if (state.yoloModeActive) {
    videoElement.style.opacity = '0.05';
  } else {
    videoElement.style.opacity = '1.0';
  }
  
  // Restore capture button styling
  captureBtn.textContent = "Start 5s Capture Snapshot";
  captureBtn.classList.remove('btn-capture-reset');
  captureBtn.classList.add('btn-capture');
  
  statusElement.textContent = "Live biomechanical tracking resumed.";

  // Hide save panel
  const savePanel = document.getElementById('save-controls-panel');
  if (savePanel) {
    savePanel.style.display = 'none';
  }
}

// ==========================================
// CAMERA STREAM MANAGEMENT
// ==========================================

export async function startCamera() {
  statusElement.textContent = "Requesting webcam access...";
  startButton.style.display = 'none';
  yoloToggleBtn.style.display = 'block';
  captureBtn.style.display = 'block';

  const autoSequenceBtn = document.getElementById('auto-sequence-btn');
  if (autoSequenceBtn) {
    autoSequenceBtn.style.display = 'block';
  }

  const subjectPanel = document.getElementById('subject-profile-panel');
  if (subjectPanel) {
    subjectPanel.style.display = 'flex';
  }

  const cameraSwitchBtn = document.getElementById('camera-switch-btn');
  if (cameraSwitchBtn) {
    cameraSwitchBtn.style.display = 'flex';
  }

  try {
    state.activeStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: state.currentFacingMode
      }
    });
    
    videoElement.srcObject = state.activeStream;
    // Mirror the view only for front/user camera
    videoElement.style.transform = state.currentFacingMode === "user" ? "scaleX(-1)" : "none";
    
    // Wait for video metadata to load and then start playing
    videoElement.onloadedmetadata = () => {
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
            state.pixelsPerCm = smoothedScale;
            state.calLocked = true;

            if (state.activeCalMethod === 'aruco') {
              arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong style="color: #06b6d4;">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
            }
          } else {
            if (state.activeCalMethod === 'aruco') {
              if (state.pixelsPerCm) {
                arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong style="color: #06b6d4;">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
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
    startButton.style.display = 'block';
    if (err.name === 'NotAllowedError') {
      statusElement.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Camera Permission Denied!</span><br>Please click the camera/lock icon in your browser address bar and change camera permissions to 'Allow'.`;
    } else if (err.name === 'NotReadableError') {
      statusElement.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Camera in use by another app!</span><br>Another app (Zoom, Teams, FaceTime, or a terminal script) is currently locking your camera. Please close it and try again.`;
    } else {
      statusElement.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Error: ${err.message}</span><br>Please make sure you are loading this page via 'http://localhost:8000' and not 'file://' (which blocks camera access).`;
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

      if (modalImg) modalImg.src = snapshot.image;
      if (modalTitle) modalTitle.textContent = snapshot.name || "Snapshot Analytics";
      
      const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
      const dateStr = new Date(snapshot.timestamp).toLocaleDateString(undefined, dateOptions);
      if (modalDate) modalDate.textContent = `Captured on ${dateStr}`;

      const m = snapshot.metrics;
      if (m) {
        // Full Body
        setModalMetric('modal-val-height', formatSkeletalHeight(m.skeletal_height));
        setModalMetric('modal-val-wingspan', m.wingspan ? formatSkeletalHeight(m.wingspan) : "--.-");

        // Render captured pose in snapshot modal
        setModalMetric('modal-val-pose', m.pose || "A-Pose");
        const modalPoseElem = document.getElementById('modal-val-pose');
        if (modalPoseElem) {
          if (m.pose === "T-Pose") {
            modalPoseElem.style.color = "#06b6d4"; // Cyan
          } else if (m.pose === "Overhead Reach") {
            modalPoseElem.style.color = "#10b981"; // Emerald
          } else {
            modalPoseElem.style.color = "#818cf8"; // Violet
          }
        }

        // Angles
        setModalMetric('modal-angle-knee-l', m.kneeAngleL !== undefined ? `${m.kneeAngleL}°` : "--°");
        setModalMetric('modal-angle-knee-r', m.kneeAngleR !== undefined ? `${m.kneeAngleR}°` : "--°");
        setModalMetric('modal-angle-hip-l', m.hipAngleL !== undefined ? `${m.hipAngleL}°` : "--°");
        setModalMetric('modal-angle-hip-r', m.hipAngleR !== undefined ? `${m.hipAngleR}°` : "--°");
        setModalMetric('modal-angle-elbow-l', m.elbowAngleL !== undefined ? `${m.elbowAngleL}°` : "--°");
        setModalMetric('modal-angle-elbow-r', m.elbowAngleR !== undefined ? `${m.elbowAngleR}°` : "--°");

        // Lower body
        setModalMetric('modal-val-thigh-l', m.thigh_l !== undefined ? formatSkeletalHeight(m.thigh_l) : "--.-");
        setModalMetric('modal-val-thigh-r', m.thigh_r !== undefined ? formatSkeletalHeight(m.thigh_r) : "--.-");
        setModalMetric('modal-val-shin-l', m.shin_l !== undefined ? formatSkeletalHeight(m.shin_l) : "--.-");
        setModalMetric('modal-val-shin-r', m.shin_r !== undefined ? formatSkeletalHeight(m.shin_r) : "--.-");
        setModalMetric('modal-val-foot-l', m.foot_l !== undefined ? formatSkeletalHeight(m.foot_l) : "--.-");
        setModalMetric('modal-val-foot-r', m.foot_r !== undefined ? formatSkeletalHeight(m.foot_r) : "--.-");

        // Upper body
        setModalMetric('modal-val-torso-l', m.torso_l !== undefined ? formatSkeletalHeight(m.torso_l) : "--.-");
        setModalMetric('modal-val-torso-r', m.torso_r !== undefined ? formatSkeletalHeight(m.torso_r) : "--.-");
        setModalMetric('modal-val-upperarm-l', m.upperarm_l !== undefined ? formatSkeletalHeight(m.upperarm_l) : "--.-");
        setModalMetric('modal-val-upperarm-r', m.upperarm_r !== undefined ? formatSkeletalHeight(m.upperarm_r) : "--.-");
        setModalMetric('modal-val-forearm-l', m.forearm_l !== undefined ? formatSkeletalHeight(m.forearm_l) : "--.-");
        setModalMetric('modal-val-forearm-r', m.forearm_r !== undefined ? formatSkeletalHeight(m.forearm_r) : "--.-");

        // Widths
        if (m.fingerToToeL !== undefined && m.fingerToToeR !== undefined) {
          setModalMetric('modal-val-finger-to-toe', `L: ${formatSkeletalHeight(m.fingerToToeL)} / R: ${formatSkeletalHeight(m.fingerToToeR)}`);
        } else {
          setModalMetric('modal-val-finger-to-toe', "--.-");
        }
        setModalMetric('modal-val-hip-w', m.hipW !== undefined ? formatSkeletalHeight(m.hipW) : "--.-");

        // Hand Metrics
        setModalMetric('modal-val-pinch-l', m.pinch_l_cm !== undefined && m.pinch_l_cm !== null ? formatSkeletalHeight(m.pinch_l_cm) : "--.-");
        setModalMetric('modal-val-pinch-r', m.pinch_r_cm !== undefined && m.pinch_r_cm !== null ? formatSkeletalHeight(m.pinch_r_cm) : "--.-");
        setModalMetric('modal-val-span-l', m.span_l_cm !== undefined && m.span_l_cm !== null ? formatSkeletalHeight(m.span_l_cm) : "--.-");
        setModalMetric('modal-val-span-r', m.span_r_cm !== undefined && m.span_r_cm !== null ? formatSkeletalHeight(m.span_r_cm) : "--.-");
      }

      // Clone buttons to purge old single-use click event listeners
      const dlBtn = document.getElementById('modal-dl-btn');
      const delBtn = document.getElementById('modal-del-btn');

      if (dlBtn) {
        const newDlBtn = dlBtn.cloneNode(true);
        dlBtn.parentNode.replaceChild(newDlBtn, dlBtn);
        newDlBtn.addEventListener('click', () => {
          downloadSnapshotImage(snapshot.image, snapshot.name || 'biomechanical-snapshot');
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
    lockCalButton.style.backgroundColor = '#10b981';
  }
});

lockCalButton.addEventListener('click', () => {
  state.pixelsPerCm = state.calBoxSize / MARKER_PHYSICAL_SIZE_CM;
  state.calLocked = true;
  lockCalButton.textContent = "✅ Scale Locked!";
  lockCalButton.style.backgroundColor = '#059669';
  statusElement.textContent = `Scale calibrated: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
});

// Preset Position buttons
const posLeftBtn = document.getElementById('pos-left-btn');
const posCenterBtn = document.getElementById('pos-center-btn');
const posRightBtn = document.getElementById('pos-right-btn');

function updatePosBtnStyles(activeBtn) {
  [posLeftBtn, posCenterBtn, posRightBtn].forEach(btn => {
    btn.style.backgroundColor = (btn === activeBtn) ? '#3b82f6' : '#1e293b';
  });
}

posLeftBtn.addEventListener('click', () => {
  state.calBoxX = 100;
  state.calBoxY = 240;
  updatePosBtnStyles(posLeftBtn);
});

posCenterBtn.addEventListener('click', () => {
  state.calBoxX = 320;
  state.calBoxY = 240;
  updatePosBtnStyles(posCenterBtn);
});

posRightBtn.addEventListener('click', () => {
  state.calBoxX = 540;
  state.calBoxY = 240;
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
  
  const canvasMouseX = (mouseX / rect.width) * 640;
  const canvasMouseY = (mouseY / rect.height) * 480;
  
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
  
  const canvasMouseX = (mouseX / rect.width) * 640;
  const canvasMouseY = (mouseY / rect.height) * 480;
  
  const x1 = state.calBoxX - state.calBoxSize / 2;
  const y1 = state.calBoxY - state.calBoxSize / 2;
  const x2 = state.calBoxX + state.calBoxSize / 2;
  const y2 = state.calBoxY + state.calBoxSize / 2;
  
  if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
    canvasElement.style.cursor = 'move';
  } else {
    if (!isDragging) {
      canvasElement.style.cursor = 'default';
    }
  }
  
  if (isDragging) {
    state.calBoxX = Math.max(state.calBoxSize/2, Math.min(640 - state.calBoxSize/2, canvasMouseX - dragStartX));
    state.calBoxY = Math.max(state.calBoxSize/2, Math.min(480 - state.calBoxSize/2, canvasMouseY - dragStartY));
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
    
    const canvasMouseX = (mouseX / rect.width) * 640;
    const canvasMouseY = (mouseY / rect.height) * 480;
    
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
    
    const canvasMouseX = (mouseX / rect.width) * 640;
    const canvasMouseY = (mouseY / rect.height) * 480;
    
    state.calBoxX = Math.max(state.calBoxSize/2, Math.min(640 - state.calBoxSize/2, canvasMouseX - dragStartX));
    state.calBoxY = Math.max(state.calBoxSize/2, Math.min(480 - state.calBoxSize/2, canvasMouseY - dragStartY));
    e.preventDefault();
  }
});

window.addEventListener('touchend', () => {
  isDragging = false;
});

// Multi-unit system controls (Inches/Cm togglers)
const unitInchBtn = document.getElementById('unit-inch-btn');
const unitCmBtn = document.getElementById('unit-cm-btn');

unitInchBtn.addEventListener('click', () => {
  state.useInches = true;
  unitInchBtn.style.backgroundColor = '#3b82f6';
  unitInchBtn.style.color = 'white';
  unitCmBtn.style.backgroundColor = 'transparent';
  unitCmBtn.style.color = '#9ca3af';
  updateHeightInputUnit();
  if (state.isSnapshotFrozen && state.frozenMetrics) {
    renderDashboard(state.frozenMetrics);
  }
  if (state.dbInitialized) {
    renderGallery();
  }
});

unitCmBtn.addEventListener('click', () => {
  state.useInches = false;
  unitCmBtn.style.backgroundColor = '#3b82f6';
  unitCmBtn.style.color = 'white';
  unitInchBtn.style.backgroundColor = 'transparent';
  unitInchBtn.style.color = '#9ca3af';
  updateHeightInputUnit();
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
  
  [tabArucoBtn, tabHeightBtn].forEach(btn => {
    btn.style.backgroundColor = (btn === activeBtn) ? '#3b82f6' : '#1e293b';
  });

  [panelAruco, panelCard, panelHeight].forEach(panel => {
    if (panel) {
      panel.style.display = (panel === activePanel) ? 'flex' : 'none';
    }
  });

  // Clear lock on switch if transitioning away from manual/height
  if (method !== 'aruco' && state.calLocked) {
    if (method === 'card') {
      lockCalButton.textContent = "Lock 20cm Calibration";
      lockCalButton.style.backgroundColor = '#10b981';
      state.calLocked = false;
    }
  }
}

tabArucoBtn.addEventListener('click', () => {
  switchCalibrationTab('aruco', tabArucoBtn, panelAruco);
});

tabHeightBtn.addEventListener('click', () => {
  switchCalibrationTab('height', tabHeightBtn, panelHeight);
});

const heightCalBtn = document.getElementById('height-cal-btn');
const inputUserHeight = document.getElementById('input-user-height');

heightCalBtn.addEventListener('click', () => {
  if (state.isCountingDown || state.isCaptureCountingDown) return; // Prevent clicks during active countdowns

  const activeHeightPx = state.lastSkeletalHeightPx > 10 ? state.lastSkeletalHeightPx : state.lastVerticalHeightPx;
  if (activeHeightPx > 10) {
    // Start 3-second countdown
    state.isCountingDown = true;
    state.countdownValue = 3;
    heightCalBtn.textContent = "Get in Position (3s)...";
    heightCalBtn.style.backgroundColor = '#d97706'; // warning orange
    statusElement.textContent = "Stand straight and face the camera. Calibrating in 3 seconds...";

    const intervalId = setInterval(() => {
      state.countdownValue--;
      if (state.countdownValue > 0) {
        heightCalBtn.textContent = `Get in Position (${state.countdownValue}s)...`;
        statusElement.textContent = `Stand straight and face the camera. Calibrating in ${state.countdownValue} seconds...`;
      } else {
        clearInterval(intervalId);
        state.isCountingDown = false;

        // Recalculate pixel height at the exact end of countdown
        const captureHeightPx = state.lastSkeletalHeightPx > 10 ? state.lastSkeletalHeightPx : state.lastVerticalHeightPx;
        const inputVal = parseFloat(inputUserHeight.value) || (state.useInches ? 68.9 : 175.0);
        let actualHeightCm = inputVal;
        if (state.useInches) {
          actualHeightCm = inputVal * 2.54; // Convert to cm for calibration scale factor
        }

        state.pixelsPerCm = captureHeightPx / actualHeightCm;
        state.calLocked = true;
        heightCalBtn.textContent = "✅ Calibrated!";
        heightCalBtn.style.backgroundColor = '#059669';
        statusElement.textContent = `Skeletal-calibrated scale locked: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
        
        // Trigger camera snapshot visual flash!
        triggerFlashEffect();
      }
    }, 1000);
  } else {
    alert("Please click 'Start Biomechanical Tracking' and stand in view of the camera first!");
  }
});

// YOLO-style background isolation click handler
yoloToggleBtn.addEventListener('click', () => {
  state.yoloModeActive = !state.yoloModeActive;
  if (state.yoloModeActive) {
    yoloToggleBtn.textContent = "Disable YOLO Background Isolation";
    yoloToggleBtn.style.backgroundColor = 'rgba(6, 182, 212, 0.15)';
    yoloToggleBtn.style.borderColor = '#06b6d4';
    yoloToggleBtn.style.color = '#06b6d4';
    
    // Hide standard video underneath so canvas can show the background cutout
    videoElement.style.opacity = '0.05'; 
  } else {
    yoloToggleBtn.textContent = "Enable YOLO Background Isolation";
    yoloToggleBtn.style.backgroundColor = '#0f1626';
    yoloToggleBtn.style.borderColor = 'rgba(6, 182, 212, 0.4)';
    yoloToggleBtn.style.color = '#06b6d4';
    
    // Restore standard video opacity
    videoElement.style.opacity = '1';
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
    autoSequenceBtn.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
    autoSequenceBtn.style.border = "1px solid rgba(239, 68, 68, 0.4)";
    autoSequenceBtn.style.boxShadow = "0 4px 10px rgba(239, 68, 68, 0.2)";

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
