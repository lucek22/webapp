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
  clearSmoothBuffer,
  getCanvasX,
  formatLength,
  updateHeightInputUnit,
  formatSkeletalHeight,
  triggerFlashEffect,
  getDomMeasurementCm
} from './helpers.js';

import { detectArucoMarker } from './arucoDetector.js';
import { pose, hands, calculatePoseMetrics } from './mediapipeLogic.js';
import { downloadSnapshotImage, compileAndDownloadCombinedSession, downloadIndividualSnapshotJson } from './reportCompiler.js';

export const videoElement = document.getElementById('webcam');
export const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('start-btn');
const yoloToggleBtn = document.getElementById('yolo-toggle-btn');
const captureBtn = document.getElementById('capture-btn');
export const statusElement = document.getElementById('status');

// Uploaded Media Elements
const uploadedVideo = document.getElementById('uploaded-video');
const uploadedImage = document.getElementById('uploaded-image');
const uploadMediaBtn = document.getElementById('upload-media-btn');
const mediaUploadInput = document.getElementById('media-upload-input');

// Custom Floating Video Player Controls (Buckeyes theme)
const videoControlsBar = document.getElementById('video-controls-bar');
const videoPlayPauseBtn = document.getElementById('video-play-pause-btn');
const videoSeekbar = document.getElementById('video-seekbar');
const videoTimeDisplay = document.getElementById('video-time-display');
const videoSpeedBtn = document.getElementById('video-speed-btn');


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

// Hand Metrics
const pinchLDisp = document.getElementById('val-pinch-l');
const pinchRDisp = document.getElementById('val-pinch-r');
const spanLDisp = document.getElementById('val-span-l');
const spanRDisp = document.getElementById('val-span-r');

// UI Angle Elements (Left vs Right)
const kneeAngleLDisp = document.getElementById('angle-knee-l');
const kneeAngleRDisp = document.getElementById('angle-knee-r');
const hipAngleLDisp = document.getElementById('angle-hip-l');
const hipAngleRDisp = document.getElementById('angle-hip-r');
const elbowAngleLDisp = document.getElementById('angle-elbow-l');
const elbowAngleRDisp = document.getElementById('angle-elbow-r');

// UI Overhead Squat Elements
const btnModePosture = document.getElementById('btn-mode-posture');
const btnModeSquat = document.getElementById('btn-mode-squat');
const postureSidebarContent = document.getElementById('posture-sidebar-content');
const squatSidebarContent = document.getElementById('squat-sidebar-content');

const squatPeakKneeL = document.getElementById('squat-peak-knee-l');
const squatLiveKneeL = document.getElementById('squat-live-knee-l');
const squatPeakKneeR = document.getElementById('squat-peak-knee-r');
const squatLiveKneeR = document.getElementById('squat-live-knee-r');

const squatPeakHipL = document.getElementById('squat-peak-hip-l');
const squatLiveHipL = document.getElementById('squat-live-hip-l');
const squatPeakHipR = document.getElementById('squat-peak-hip-r');
const squatLiveHipR = document.getElementById('squat-live-hip-r');

const squatPeakAnkleL = document.getElementById('squat-peak-ankle-l');
const squatLiveAnkleL = document.getElementById('squat-live-ankle-l');
const squatPeakAnkleR = document.getElementById('squat-peak-ankle-r');
const squatLiveAnkleR = document.getElementById('squat-live-ankle-r');

const squatStatusVal = document.getElementById('squat-status-val');

const btnSquatSideLeft = document.getElementById('btn-squat-side-left');
const btnSquatSideRight = document.getElementById('btn-squat-side-right');


// UI Calibration Toggles & Panels
const tabArucoBtn = document.getElementById('tab-aruco-btn');
const tabHeightBtn = document.getElementById('tab-height-btn');
const tabPortfolioBtn = document.getElementById('tab-portfolio-btn');
const tabValidationBtn = document.getElementById('tab-validation-btn');

const panelAruco = document.getElementById('panel-aruco');
const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const panelPortfolio = document.getElementById('panel-portfolio');
const panelValidation = document.getElementById('panel-validation');
const arucoStatusText = document.getElementById('aruco-status-text');
const validationStatusText = document.getElementById('validation-status-text');
const validationFeedbackBox = document.getElementById('validation-feedback-box');
const validationHeightLabel = document.getElementById('validation-height-label');
const inputValidationHeight = document.getElementById('input-validation-height');

const inputPremeasuredScale = document.getElementById('input-premeasured-scale');
const btnApplyScale = document.getElementById('btn-apply-scale');
const textareaPortfolioJson = document.getElementById('textarea-portfolio-json');
const btnImportPortfolio = document.getElementById('btn-import-portfolio');
const btnExportCombined = document.getElementById('btn-export-combined');
const btnExportVideo = document.getElementById('btn-export-video');

const SEGMENT_METRICS = [
  { element: thighLDisp, key: 'thigh_l' },
  { element: thighRDisp, key: 'thigh_r' },
  { element: shinLDisp, key: 'shin_l' },
  { element: shinRDisp, key: 'shin_r' },
  { element: footLDisp, key: 'foot_l' },
  { element: footRDisp, key: 'foot_r' },
  { element: torsoLDisp, key: 'torso_l' },
  { element: torsoRDisp, key: 'torso_r' },
  { element: upperarmLDisp, key: 'upperarm_l' },
  { element: upperarmRDisp, key: 'upperarm_r' },
  { element: forearmLDisp, key: 'forearm_l' },
  { element: forearmRDisp, key: 'forearm_r' }
];

const ANGLE_METRICS = [
  { element: kneeAngleLDisp, key: 'kneeAngleL' },
  { element: kneeAngleRDisp, key: 'kneeAngleR' },
  { element: hipAngleLDisp, key: 'hipAngleL' },
  { element: hipAngleRDisp, key: 'hipAngleR' },
  { element: elbowAngleLDisp, key: 'elbowAngleL' },
  { element: elbowAngleRDisp, key: 'elbowAngleR' }
];

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
  // Draw bottom of the feet ground contact point
  const feet_center = {
    x: (heel_l.x + heel_r.x) / 2,
    y: ground_y
  };
  drawJoint(feet_center, '#06b6d4');
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
  canvasCtx.beginPath();
  canvasCtx.roundRect(0, 0, 160, 38, 6);
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

function drawLiveStatsCard(ctx, calculated) {
  if (!calculated || !calculated.liveMetrics) return;
  const liveMetrics = calculated.liveMetrics;

  const scale = canvasElement.width / 640;
  
  // Card dimensions
  const cardW = 190 * scale;
  const cardH = 168 * scale;
  const cardX = canvasElement.width - cardW - 20 * scale;
  const cardY = 20 * scale;

  ctx.save();
  
  // Glassmorphic background
  ctx.fillStyle = 'rgba(15, 22, 38, 0.85)';
  ctx.strokeStyle = '#ec4899'; // Sleek Neon Pink/Rose border
  ctx.lineWidth = 1.5 * scale;
  
  // Draw glow shadow
  ctx.shadowColor = 'rgba(236, 72, 153, 0.4)';
  ctx.shadowBlur = 10 * scale;
  
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 8 * scale);
  ctx.fill();
  ctx.stroke();
  
  // Disable shadows for crisp text rendering
  ctx.shadowBlur = 0;
  
  // Title / Subject Name
  const subjectInput = document.getElementById('subject-name-input');
  const subjectName = (subjectInput && subjectInput.value.trim()) || "Subject";
  
  let displayName = subjectName.toUpperCase();
  if (displayName.length > 15) {
    displayName = displayName.substring(0, 13) + "...";
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(10, Math.round(11 * scale))}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`SUBJECT: ${displayName}`, cardX + 12 * scale, cardY + 12 * scale);
  
  // Subtitle: Stature (Premeasured or Live)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = `${Math.max(9, Math.round(10 * scale))}px sans-serif`;
  
  const heightVal = liveMetrics.skeletal_height || liveMetrics.live_height;
  const heightStr = heightVal ? formatLength(heightVal) : "--.- cm";
  ctx.fillText(`STATURE: ${heightStr}`, cardX + 12 * scale, cardY + 26 * scale);
  
  // Horizontal divider line
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.2)';
  ctx.beginPath();
  ctx.moveTo(cardX + 12 * scale, cardY + 40 * scale);
  ctx.lineTo(cardX + cardW - 12 * scale, cardY + 40 * scale);
  ctx.stroke();
  
  // Section: Joint Flexions
  ctx.fillStyle = '#ec4899'; // Neon pink section header
  ctx.font = `bold ${Math.max(9, Math.round(9 * scale))}px sans-serif`;
  ctx.fillText("LIVE JOINT FLEXIONS", cardX + 12 * scale, cardY + 46 * scale);
  
  // Joint values mapping helper
  ctx.font = `${Math.max(9, Math.round(10 * scale))}px sans-serif`;
  let itemY = cardY + 58 * scale;
  const rowSpacing = 14 * scale;
  
  const joints = [
    { label: "Knee L / R", val: `${Math.round(calculated.kneeAngleL)}° / ${Math.round(calculated.kneeAngleR)}°` },
    { label: "Hip L / R", val: `${Math.round(calculated.hipAngleL)}° / ${Math.round(calculated.hipAngleR)}°` },
    { label: "Elbow L / R", val: `${Math.round(calculated.elbowAngleL)}° / ${Math.round(calculated.elbowAngleR)}°` }
  ];
  
  joints.forEach(j => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(j.label, cardX + 12 * scale, itemY);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(j.val, cardX + cardW - 12 * scale, itemY);
    ctx.textAlign = 'left';
    itemY += rowSpacing;
  });
  
  // Divider
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.2)';
  ctx.beginPath();
  ctx.moveTo(cardX + 12 * scale, itemY + 2 * scale);
  ctx.lineTo(cardX + cardW - 12 * scale, itemY + 2 * scale);
  ctx.stroke();
  
  itemY += 10 * scale;
  
  // Section: Physical Segments (Torso, Thigh, Shin)
  ctx.fillStyle = '#ec4899';
  ctx.font = `bold ${Math.max(9, Math.round(9 * scale))}px sans-serif`;
  ctx.fillText("PHYSICAL SEGMENTS", cardX + 12 * scale, itemY);
  
  itemY += 14 * scale;
  
  // Calculate average torso, thigh, shin
  const avgTorso = (liveMetrics.torso_l && liveMetrics.torso_r) ? (liveMetrics.torso_l + liveMetrics.torso_r) / 2 : (liveMetrics.torso_l || liveMetrics.torso_r || null);
  const avgThigh = (liveMetrics.thigh_l && liveMetrics.thigh_r) ? (liveMetrics.thigh_l + liveMetrics.thigh_r) / 2 : (liveMetrics.thigh_l || liveMetrics.thigh_r || null);
  const avgShin = (liveMetrics.shin_l && liveMetrics.shin_r) ? (liveMetrics.shin_l + liveMetrics.shin_r) / 2 : (liveMetrics.shin_l || liveMetrics.shin_r || null);

  const segments = [
    { label: "Avg. Torso", val: avgTorso ? formatLength(avgTorso) : "--.- cm" },
    { label: "Avg. Thigh", val: avgThigh ? formatLength(avgThigh) : "--.- cm" },
    { label: "Avg. Shin", val: avgShin ? formatLength(avgShin) : "--.- cm" }
  ];
  
  ctx.font = `${Math.max(9, Math.round(10 * scale))}px sans-serif`;
  segments.forEach(s => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(s.label, cardX + 12 * scale, itemY);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(s.val, cardX + cardW - 12 * scale, itemY);
    ctx.textAlign = 'left';
    itemY += rowSpacing;
  });

  ctx.restore();
}

export function renderDashboard(metrics) {
  if (!metrics) return;

  // Render Left/Right segment lengths
  SEGMENT_METRICS.forEach(m => {
    if (m.element) m.element.textContent = formatLength(metrics[m.key]);
  });

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
    activePoseDisp.classList.remove('text-red', 'text-emerald', 'text-violet');
    if (metrics.pose === "T-Pose") {
      activePoseDisp.classList.add('text-red');
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
  ANGLE_METRICS.forEach(m => {
    if (m.element) m.element.textContent = `${metrics[m.key]}°`;
  });

  // Render Hand Metrics if available
  const fallbackDash = state.useInches ? "--.- in" : "--.- cm";
  if (pinchLDisp) {
    pinchLDisp.textContent = (metrics.pinch_l_cm !== undefined && metrics.pinch_l_cm !== null) ? formatLength(metrics.pinch_l_cm) : fallbackDash;
  }
  if (pinchRDisp) {
    pinchRDisp.textContent = (metrics.pinch_r_cm !== undefined && metrics.pinch_r_cm !== null) ? formatLength(metrics.pinch_r_cm) : fallbackDash;
  }
  if (spanLDisp) {
    spanLDisp.textContent = (metrics.span_l_cm !== undefined && metrics.span_l_cm !== null) ? formatLength(metrics.span_l_cm) : fallbackDash;
  }
  if (spanRDisp) {
    spanRDisp.textContent = (metrics.span_r_cm !== undefined && metrics.span_r_cm !== null) ? formatLength(metrics.span_r_cm) : fallbackDash;
  }
}

// ==========================================
// POSE EVENT DISPATCH COORDINATOR
// ==========================================

export function drawActiveMediaBackground() {
  if (state.yoloModeActive) return;

  let sourceElement = null;
  if (state.isUploadedMedia) {
    if (state.uploadedMediaType === 'video') {
      sourceElement = uploadedVideo;
    } else if (state.uploadedMediaType === 'image') {
      sourceElement = uploadedImage;
    }
  } else {
    sourceElement = videoElement;
  }

  if (sourceElement) {
    canvasCtx.save();
    if (!state.isUploadedMedia && state.currentFacingMode === "user") {
      canvasCtx.translate(canvasElement.width, 0);
      canvasCtx.scale(-1, 1);
    }
    canvasCtx.drawImage(sourceElement, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();
  }
}

export function onPoseResults(results) {
  try {
    let calculated = null;
    state.latestPoseResults = results;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // Draw background video/webcam frame if YOLO background masking is NOT active
  drawActiveMediaBackground();

  const now = Date.now();
  const dt = now - state.lastFrameTime;
  state.lastFrameTime = now;

  const isStaticImage = state.isUploadedMedia && state.uploadedMediaType === 'image';
  if (isStaticImage && state.lastProcessedScaleFactor === state.pixelsPerCm && state.lastCalculatedResults) {
    calculated = state.lastCalculatedResults;
    const {
      shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
      shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
      head_top, ground_y, all_landmarks,
      kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
      ankleAngleL, ankleAngleR,
      liveMetrics
    } = calculated;

    // Draw standard skeletal mesh elements
    drawFullSkeletalMesh(all_landmarks);

    // --- DRAW NEON SKELETAL MARKERS ---
    drawBone(shoulder_l, shoulder_r, '#d4a017'); 
    drawBone(hip_l, hip_r, '#d4a017'); 
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

    if (state.pixelsPerCm && liveMetrics) {
      // Draw head top indicator node
      drawJoint(head_top, '#06b6d4');

      // Position ruler
      const body_xs = [shoulder_l.x, shoulder_r.x, hip_l.x, hip_r.x, knee_l.x, knee_r.x, ankle_l.x, ankle_r.x];
      const min_x = Math.min(...body_xs);
      const max_x = Math.max(...body_xs);
      const ruler_x = max_x + 40 < 620 ? max_x + 40 : min_x - 40 > 20 ? min_x - 40 : 50;

      // Compute feet & inches string for ruler label
      const live_inches = liveMetrics.live_height / 2.54;
      const live_feet = Math.floor(live_inches / 12);
      const live_inches_left = live_inches % 12;
      const live_feet_inches_str = `${live_feet}' ${live_inches_left.toFixed(1)}"`;

      // Draw the live ruler graphics
      drawRulerGraphics(ruler_x, head_top, ground_y, liveMetrics.live_height, live_feet_inches_str, heel_l, heel_r);

      // Draw active pose badge (only on camera/images, remove from video as requested)
      const isVideo = state.isUploadedMedia && state.uploadedMediaType === 'video';
      if (liveMetrics.pose && !isVideo) {
        drawPoseBadge(liveMetrics.pose);
      }

      // Draw live stats HUD overlay on top-right of canvas
      drawLiveStatsCard(canvasCtx, calculated);

      // Support Overhead Squat metrics update for static images
      const kneeMobL = 180 - (kneeAngleL || 180);
      const kneeMobR = 180 - (kneeAngleR || 180);
      const hipMobL = 180 - (hipAngleL || 180);
      const hipMobR = 180 - (hipAngleR || 180);
      const ankleMobL = Math.max(0, 115 - (ankleAngleL || 115));
      const ankleMobR = Math.max(0, 115 - (ankleAngleR || 115));

      if (state.squatTestingSide === 'left') {
        state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
        state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
        state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
      } else {
        state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
        state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
        state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
      }

      if (state.currentMode === 'squat') {
        updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR);
      }
    }

    canvasCtx.restore();
    return;
  }

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
    if (!state.isUploadedMedia && state.currentFacingMode === "user") {
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
      x: (!state.isUploadedMedia && state.currentFacingMode === "user") ? width - c.x : c.x,
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
  let hasValidPerson = false;
  if (results.poseLandmarks) {
    hasValidPerson = true;
  }

  if (!hasValidPerson) {
    // Call offline placeholder function to keep the dashboard from showing ceiling measurements!
    updateDashboardOfflinePlaceholders();

    // Reset cached pixels height indicators to prevent calibrating on empty or false-positive frames
    state.lastSkeletalHeightPx = 0;
    state.lastVerticalHeightPx = 0;

    // Reset status elements (only when not in playout recording to preserve "Recording playout is active..." status)
    if (!state.isRecordingPlayLoop) {
      if (state.autoActive) {
        statusElement.textContent = "🔍 Waiting for subject to enter and align in view...";
        state.holdTimerMs = 0; // Reset sequence hold timer
      } else {
        statusElement.textContent = "🔍 Scanning for a person... Align yourself in view of the camera.";
      }
    }

    // Set all sidebar landmarks to Offline
    if (!state.isRecordingPlayLoop && typeof LANDMARK_NAMES !== 'undefined') {
      LANDMARK_NAMES.forEach((name, idx) => {
        const statusSpan = document.getElementById(`lm-status-${idx}`);
        if (statusSpan) {
          statusSpan.classList.remove('text-emerald', 'text-amber');
          statusSpan.classList.add('text-slate');
          statusSpan.textContent = "Offline";
        }
      });
    }

    // Only draw the warning banner if NOT exporting/recording video playout to keep athletic footage pristine
    if (!state.isRecordingPlayLoop) {
      // Draw a premium neon-glowing "SUBJECT NOT DETECTED" warning overlay
      canvasCtx.save();
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 250);
      const bannerW = 280;
      const bannerH = 40;
      const bannerX = (canvasElement.width - bannerW) / 2;
      const bannerY = 30; // Near the top of the canvas
      
      canvasCtx.fillStyle = 'rgba(15, 22, 38, 0.85)';
      canvasCtx.strokeStyle = `rgba(239, 68, 68, ${0.3 + 0.2 * pulse})`; // Crimson Red glow
      canvasCtx.lineWidth = 1.5;
      canvasCtx.shadowColor = 'rgba(239, 68, 68, 0.6)';
      canvasCtx.shadowBlur = 8;
      
      // Draw container box
      canvasCtx.beginPath();
      canvasCtx.roundRect(bannerX, bannerY, bannerW, bannerH, 6);
      canvasCtx.fill();
      canvasCtx.stroke();
      
      // Draw text (disable shadow blur for sharpness)
      canvasCtx.shadowBlur = 0;
      canvasCtx.fillStyle = `rgba(239, 68, 68, ${0.8 + 0.2 * pulse})`;
      canvasCtx.font = 'bold 11px sans-serif';
      canvasCtx.textAlign = 'center';
      canvasCtx.textBaseline = 'middle';
      canvasCtx.fillText("⚠️  SUBJECT NOT DETECTED IN FRAME", canvasElement.width / 2, bannerY + bannerH / 2);
      canvasCtx.restore();
    }

    canvasCtx.restore();
    return;
  }

  if (typeof calculatePoseMetrics === 'function') {
    calculated = calculatePoseMetrics(results);

    if (calculated) {
      if (isStaticImage) {
        state.lastProcessedScaleFactor = state.pixelsPerCm;
        state.lastCalculatedResults = calculated;
      }

      const {
        shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
        shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
        head_top, ground_y, all_landmarks,
        kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
        ankleAngleL, ankleAngleR,
        liveMetrics
      } = calculated;

      // Merge imported pre-measured portfolio metrics to override raw image length calculations
      if (state.importedPortfolioMetrics && liveMetrics) {
        const imp = state.importedPortfolioMetrics;
        if (imp.skeletal_height !== null && imp.skeletal_height !== undefined) {
          liveMetrics.skeletal_height = imp.skeletal_height;
          liveMetrics.live_height = imp.skeletal_height;
        }
        if (imp.wingspan !== null && imp.wingspan !== undefined) liveMetrics.wingspan = imp.wingspan;
        if (imp.thigh_l !== null && imp.thigh_l !== undefined) liveMetrics.thigh_l = imp.thigh_l;
        if (imp.thigh_r !== null && imp.thigh_r !== undefined) liveMetrics.thigh_r = imp.thigh_r;
        if (imp.shin_l !== null && imp.shin_l !== undefined) liveMetrics.shin_l = imp.shin_l;
        if (imp.shin_r !== null && imp.shin_r !== undefined) liveMetrics.shin_r = imp.shin_r;
        if (imp.foot_l !== null && imp.foot_l !== undefined) liveMetrics.foot_l = imp.foot_l;
        if (imp.foot_r !== null && imp.foot_r !== undefined) liveMetrics.foot_r = imp.foot_r;
        if (imp.torso_l !== null && imp.torso_l !== undefined) liveMetrics.torso_l = imp.torso_l;
        if (imp.torso_r !== null && imp.torso_r !== undefined) liveMetrics.torso_r = imp.torso_r;
        if (imp.upperarm_l !== null && imp.upperarm_l !== undefined) liveMetrics.upperarm_l = imp.upperarm_l;
        if (imp.upperarm_r !== null && imp.upperarm_r !== undefined) liveMetrics.upperarm_r = imp.upperarm_r;
        if (imp.forearm_l !== null && imp.forearm_l !== undefined) liveMetrics.forearm_l = imp.forearm_l;
        if (imp.forearm_r !== null && imp.forearm_r !== undefined) liveMetrics.forearm_r = imp.forearm_r;
        if (imp.fingerToToeL !== null && imp.fingerToToeL !== undefined) liveMetrics.fingerToToeL = imp.fingerToToeL;
        if (imp.fingerToToeR !== null && imp.fingerToToeR !== undefined) liveMetrics.fingerToToeR = imp.fingerToToeR;
        if (imp.hipW !== null && imp.hipW !== undefined) liveMetrics.hipW = imp.hipW;
      }

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

      // Overhead Squat Mobility calculations
      const kneeMobL = 180 - (kneeAngleL || 180);
      const kneeMobR = 180 - (kneeAngleR || 180);
      const hipMobL = 180 - (hipAngleL || 180);
      const hipMobR = 180 - (hipAngleR || 180);
      const ankleMobL = Math.max(0, 115 - (ankleAngleL || 115));
      const ankleMobR = Math.max(0, 115 - (ankleAngleR || 115));

      // Always update peaks state when a valid frame is processed
      if (state.squatTestingSide === 'left') {
        state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
        state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
        state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
      } else {
        state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
        state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
        state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
      }

      // If in squat mode, update the Overhead Squat dashboard UI
      if (state.currentMode === 'squat') {
        updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR);
      }

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

        // Draw active pose badge (only on camera/images, remove from video as requested)
        const isVideo = state.isUploadedMedia && state.uploadedMediaType === 'video';
        if (liveMetrics.pose && !isVideo) {
          drawPoseBadge(liveMetrics.pose);
        }

        // Draw live stats HUD overlay on top-right of canvas
        drawLiveStatsCard(canvasCtx, calculated);

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
            canvasCtx.beginPath();
            canvasCtx.roundRect(barX, barY, barWidth, barHeight, 8);
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
              canvasCtx.roundRect(barX, barY, fillWidth, barHeight, 8);
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
              const width = state.canvasWidth || 640;
              const height = state.canvasHeight || 480;
              frozenFrameCanvas.width = width;
              frozenFrameCanvas.height = height;
              frozenFrameCtx.clearRect(0, 0, width, height);
              frozenFrameCtx.save();
              if (!state.isUploadedMedia && state.currentFacingMode === "user") {
                frozenFrameCtx.translate(width, 0);
                frozenFrameCtx.scale(-1, 1);
              }
              if (results.segmentationMask && state.yoloModeActive) {
                frozenFrameCtx.drawImage(results.segmentationMask, 0, 0, width, height);
                frozenFrameCtx.globalCompositeOperation = 'source-in';
                frozenFrameCtx.drawImage(results.image, 0, 0, width, height);
              } else {
                frozenFrameCtx.drawImage(results.image, 0, 0, width, height);
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
              if (state.activeProfileId) {
                autoSyncToActiveProfile();
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
        statusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
        
        feedbackBox.classList.remove('hidden', 'feedback-info', 'feedback-success', 'feedback-error');
        if (!calculated || !calculated.liveMetrics) {
          feedbackBox.classList.add('feedback-info');
          feedbackBox.innerHTML = `👤 Please stand in view of the camera to perform real-time verification...`;
        } else {
          const liveHeight = calculated.liveMetrics.skeletal_height;
          const targetHeight = state.validationHeightCm;
          const diffCm = Math.abs(liveHeight - targetHeight);
          
          const calculatedStr = formatSkeletalHeight(liveHeight);
          const trueStr = formatSkeletalHeight(targetHeight);
          const diffStr = state.useInches ? `${(diffCm / 2.54).toFixed(1)} in` : `${diffCm.toFixed(1)} cm`;
          
          if (diffCm <= 1.0) {
            feedbackBox.classList.add('feedback-success');
            feedbackBox.innerHTML = `
              <div class="feedback-title">✅ SUCCESS: Calibrated & Positioned Properly!</div>
              <div>Calculated: <strong>${calculatedStr}</strong> | True: <strong>${trueStr}</strong></div>
              <div class="feedback-subtitle">Discrepancy: ${diffStr} (Within 1.0 cm limit)</div>
            `;
          } else {
            feedbackBox.classList.add('feedback-error');
            feedbackBox.innerHTML = `
              <div class="feedback-title">⚠️ POSITION CHECK: Discrepancy Found</div>
              <div>Calculated: <strong>${calculatedStr}</strong> | True: <strong>${trueStr}</strong></div>
              <div class="feedback-subtitle">Discrepancy: <strong class="text-red">${diffStr}</strong> (Max allowed: 1.0 cm)</div>
              <div class="feedback-subtitle feedback-instruction">Please adjust your ArUco marker position or camera alignment.</div>
            `;
          }
        }
      }
    }
  }

  canvasCtx.restore();
  } catch (err) {
    console.error("Error inside onPoseResults:", err);
    try { canvasCtx.restore(); } catch (e) {}
  }
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
  
  const width = state.canvasWidth || 640;
  const height = state.canvasHeight || 480;
  frozenFrameCanvas.width = width;
  frozenFrameCanvas.height = height;
  
  // Save current frame image from results (or fallback to videoElement / uploaded media if results are not available)
  frozenFrameCtx.clearRect(0, 0, width, height);
  frozenFrameCtx.save();
  if (!state.isUploadedMedia && state.currentFacingMode === "user") {
    frozenFrameCtx.translate(width, 0);
    frozenFrameCtx.scale(-1, 1);
  }
  if (results && results.segmentationMask && state.yoloModeActive) {
    frozenFrameCtx.drawImage(results.segmentationMask, 0, 0, width, height);
    frozenFrameCtx.globalCompositeOperation = 'source-in';
    frozenFrameCtx.drawImage(results.image, 0, 0, width, height);
  } else if (results && results.image) {
    frozenFrameCtx.drawImage(results.image, 0, 0, width, height);
  } else {
    const srcElement = state.isUploadedMedia 
      ? (state.uploadedMediaType === 'video' ? uploadedVideo : uploadedImage) 
      : videoElement;
    frozenFrameCtx.drawImage(srcElement, 0, 0, width, height);
  }
  frozenFrameCtx.restore();

  state.isSnapshotFrozen = true;
  videoElement.classList.add('video-hidden');
  videoElement.classList.remove('video-visible', 'video-dimmed'); // Completely hide live video feed under the canvas
  if (state.isUploadedMedia) {
    if (uploadedVideo) {
      uploadedVideo.classList.add('hidden');
      uploadedVideo.classList.remove('video-visible');
    }
    if (uploadedImage) {
      uploadedImage.classList.add('hidden');
      uploadedImage.classList.remove('video-visible');
    }
  }
  
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
  
  canvasCtx.beginPath();
  canvasCtx.roundRect(panelX, panelY, panelW, panelH, 12);
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
  canvasCtx.beginPath();
  canvasCtx.roundRect(barX, barY, barW, barH, 4);
  canvasCtx.fill();
  
  if (progress > 0) {
    canvasCtx.save();
    const fillW = barW * progress;
    const grad = canvasCtx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#d4a017');
    grad.addColorStop(1, '#d4a017');
    canvasCtx.fillStyle = grad;
    canvasCtx.beginPath();
    canvasCtx.roundRect(barX, barY, fillW, barH, 4);
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

    // Draw bottom of the feet ground contact point
    const feet_center = {
      x: (heel_l.x + heel_r.x) / 2,
      y: ground_y
    };
    drawJoint(feet_center, '#06b6d4');
  }

  // Draw frozen hand skeletons if available
  if (state.frozenHandResults) {
    drawHandMesh(state.frozenHandResults.multiHandLandmarks, state.frozenHandResults.multiHandedness);
  }

  // Draw frozen pose badge if available (only on camera/images, remove from video as requested)
  const isVideo = state.isUploadedMedia && state.uploadedMediaType === 'video';
  if (state.frozenMetrics && state.frozenMetrics.pose && !isVideo) {
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
  
  canvasCtx.beginPath();
  canvasCtx.roundRect(-100, -15, 200, 30, 6);
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

export function startUiRenderLoop() {
  if (state.uiRenderLoopActive) return;
  state.uiRenderLoopActive = true;

  function tick() {
    if (!state.uiRenderLoopActive) return;

    let shouldRender = false;
    if (state.activeStream && !videoElement.paused && !videoElement.ended) {
      shouldRender = true;
    } else if (state.isUploadedMedia) {
      if (state.uploadedMediaType === 'video' && !uploadedVideo.paused && !uploadedVideo.ended) {
        shouldRender = true;
      } else if (state.uploadedMediaType === 'image') {
        shouldRender = true;
      }
    }

    if (shouldRender) {
      if (state.isSnapshotFrozen) {
        drawFrozenSnapshot();
      } else if (state.isRecordingPlayLoop && state.exportFramesData && state.exportFramesData.length > 0) {
        try {
          // Look up the closest pre-processed frame for perfect sync
          const curTime = uploadedVideo.currentTime;
          let closestFrame = state.exportFramesData[0];
          let minDiff = Math.abs(closestFrame.time - curTime);
          
          for (let i = 1; i < state.exportFramesData.length; i++) {
            const diff = Math.abs(state.exportFramesData[i].time - curTime);
            if (diff < minDiff) {
              minDiff = diff;
              closestFrame = state.exportFramesData[i];
            }
          }
          
          // Mock results and render immediately on canvas (zero-lag!)
          if (closestFrame) {
            const mockedResults = {
              poseLandmarks: closestFrame.poseLandmarks,
              image: uploadedVideo
            };
            state.latestHandResults = closestFrame.handResults;
            onPoseResults(mockedResults);
          }
        } catch (err) {
          console.error("Error in playout render tick:", err);
          try {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            drawActiveMediaBackground();
            canvasCtx.restore();
          } catch (e) {
            console.error("Playout tick fallback drawing failed:", e);
          }
        }
      } else {
        if (state.latestPoseResults) {
          // If YOLO mode is active, we let the async callback handle drawing to avoid WebGL recycled resource flashing
          if (!state.yoloModeActive) {
            onPoseResults(state.latestPoseResults);
          }
        } else {
          // If no results yet, clear canvas, draw background, and draw manual calibration box if active
          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
          drawActiveMediaBackground();
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

            canvasCtx.fillStyle = state.calLocked ? '#10b981' : '#ec4899';
            canvasCtx.font = 'bold 11px sans-serif';
            canvasCtx.fillText(state.calLocked ? "SCARLET CALIBRATION LOCKED" : "ALIGN PRINTED 200mm SQUARE IN BOX", x1 + 5, y1 - 8);
          }
          canvasCtx.restore();
        }
        
        if (state.latestHandResults && drawHandMesh) {
          drawHandMesh(state.latestHandResults.multiHandLandmarks, state.latestHandResults.multiHandedness);
        }
      }
    } else {
      if (state.isSnapshotFrozen) {
        drawFrozenSnapshot();
      }
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

export function stopUiRenderLoop() {
  state.uiRenderLoopActive = false;
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
  if (state.isUploadedMedia) {
    videoElement.classList.add('video-hidden');
    videoElement.classList.remove('video-visible', 'video-dimmed');
    
    if (state.uploadedMediaType === 'video') {
      uploadedVideo.classList.remove('hidden');
      uploadedVideo.classList.add('video-visible');
    } else if (state.uploadedMediaType === 'image') {
      uploadedImage.classList.remove('hidden');
      uploadedImage.classList.add('video-visible');
    }
  } else {
    videoElement.classList.remove('video-hidden');
    if (state.yoloModeActive) {
      videoElement.classList.add('video-dimmed');
      videoElement.classList.remove('video-visible');
    } else {
      videoElement.classList.add('video-visible');
      videoElement.classList.remove('video-dimmed');
    }
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
  state.isUploadedMedia = false;
  state.uploadedMediaType = null;
  state.latestPoseResults = null;
  state.latestHandResults = null;

  const exportCombinedBtn = document.getElementById('btn-export-combined');
  if (exportCombinedBtn) {
    exportCombinedBtn.classList.add('hidden');
    exportCombinedBtn.classList.remove('visible-block');
  }

  if (btnExportVideo) {
    btnExportVideo.classList.remove('hidden');
    btnExportVideo.classList.add('visible-block');
    updateRecordButtonUI();
  }

  // Safe safeguard: stop any active recording on session switch
  if (state.isRecording && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    try { state.mediaRecorder.stop(); } catch(e){}
    state.isRecording = false;
  }

  if (uploadedVideo) {
    uploadedVideo.classList.add('hidden');
    uploadedVideo.classList.remove('video-visible');
    try { uploadedVideo.pause(); } catch(e){}
    uploadedVideo.src = "";
  }
  if (videoControlsBar) {
    videoControlsBar.classList.add('hidden');
  }
  if (uploadedImage) {
    uploadedImage.classList.add('hidden');
    uploadedImage.classList.remove('video-visible');
    uploadedImage.src = "";
  }
  videoElement.classList.remove('video-hidden');
  videoElement.classList.add('video-visible');

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

    // Throttled concurrent model inference loop (runs in background)
    async function cameraInferenceLoop() {
      if (!state.activeStream || videoElement.paused || videoElement.ended) {
        state.isCameraInferenceLoopRunning = false;
        return;
      }
      state.isCameraInferenceLoopRunning = true;

      const startTime = Date.now();
      try {
        if (!state.isSnapshotFrozen) {
          if (state.currentMode === 'squat') {
            state.latestArucoMarker = null;
            if (arucoStatusText) {
              arucoStatusText.innerHTML = `<span style="color: #BA0C2F; font-weight: 700;">Active Squat Analyzer Mode (Calibration Bypassed)</span>`;
            }
          } else if ((state.importedPortfolioMetrics || (state.activeProfileId && state.pixelsPerCm)) && state.activeCalMethod !== 'aruco' && state.activeCalMethod !== 'validation') {
            state.latestArucoMarker = null;
            if (state.activeCalMethod === 'aruco' && arucoStatusText && state.pixelsPerCm) {
              arucoStatusText.innerHTML = `✅ Calibrated via Profile (<strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>)`;
            }
          } else if (typeof detectArucoMarker === 'function') {
            const found = detectArucoMarker(videoElement);
            state.latestArucoMarker = found;

            if (found) {
              const corners = found.corners;
              const d01 = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
              const d12 = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
              const d23 = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
              const d30 = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
              const edgeLengthPx = (d01 + d12 + d23 + d30) / 4;

              const smoothedScale = smooth('scale_factor', edgeLengthPx / MARKER_PHYSICAL_SIZE_CM);
              if (state.wallPerspectiveEnabled) {
                state.pixelsPerCm = smoothedScale * state.wallPerspectiveFactor;
              } else {
                state.pixelsPerCm = smoothedScale;
              }
              state.calLocked = true;

              if (state.activeCalMethod === 'aruco') {
                arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
              }
            } else {
              if (state.activeCalMethod === 'aruco') {
                if (state.pixelsPerCm) {
                  arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
                } else {
                  arucoStatusText.innerHTML = `🔍 Scanning for Reference (200mm)...`;
                }
              }
            }
          }

          // Sequential model calls - avoids Emscripten concurrent initialization/runtime namespace memory collision errors!
          await pose.send({ image: videoElement });
          await hands.send({ image: videoElement });
        }
      } catch (err) {
        console.error("Camera inference loop error:", err);
      }

      const elapsed = Date.now() - startTime;
      const delay = Math.max(50 - elapsed, 1); // target ~20fps inference to prevent CPU starvation
      setTimeout(cameraInferenceLoop, delay);
    }

    // Start processing once stream is playing
    videoElement.onplay = () => {
      if (state.currentMode === 'squat') {
        const side = state.squatTestingSide || 'left';
        statusElement.textContent = `Active squat tracking. Position subject profile view for the ${side.toUpperCase()} side.`;
      } else {
        statusElement.textContent = "Active tracking. Present your printed ArUco marker to calibrate scale!";
      }
      startUiRenderLoop();
      cameraInferenceLoop();
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

// ==========================================
// UPLOADED MEDIA INTEGRATION
// ==========================================

export async function handleUploadedFile(file) {
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  state.isUploadedMedia = true;
  state.uploadedMediaType = isVideo ? 'video' : 'image';
  state.latestPoseResults = null;
  state.latestHandResults = null;
  state.lastProcessedScaleFactor = null;
  state.lastCalculatedResults = null;

  // Stop camera stream if active
  if (state.activeStream) {
    state.activeStream.getTracks().forEach(track => track.stop());
    state.activeStream = null;
  }

  // Adjust button visibilities
  startButton.classList.add('hidden');
  yoloToggleBtn.classList.remove('hidden');
  yoloToggleBtn.classList.add('visible-block');
  captureBtn.classList.remove('hidden');
  captureBtn.classList.add('visible-block');

  const exportCombinedBtn = document.getElementById('btn-export-combined');
  if (exportCombinedBtn) {
    if (isVideo) {
      exportCombinedBtn.classList.add('hidden');
      exportCombinedBtn.classList.remove('visible-block');
    } else {
      exportCombinedBtn.classList.remove('hidden');
      exportCombinedBtn.classList.add('visible-block');
    }
  }

  if (btnExportVideo) {
    if (isVideo) {
      btnExportVideo.classList.remove('hidden');
      btnExportVideo.classList.add('visible-block');
      updateRecordButtonUI();
    } else {
      btnExportVideo.classList.add('hidden');
      btnExportVideo.classList.remove('visible-block');
    }
  }

  // Safe safeguard: stop any active recording on session switch
  if (state.isRecording && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    try { state.mediaRecorder.stop(); } catch(e){}
    state.isRecording = false;
  }

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
    cameraSwitchBtn.classList.add('hidden');
    cameraSwitchBtn.classList.remove('visible-flex');
  }

  // Hide live video
  videoElement.classList.add('video-hidden');
  videoElement.classList.remove('video-visible', 'video-dimmed');
  try { videoElement.pause(); } catch(e){}
  videoElement.srcObject = null;

  const objectURL = URL.createObjectURL(file);

  if (isVideo) {
    if (videoControlsBar) {
      videoControlsBar.classList.remove('hidden');
    }
    if (uploadedImage) {
      uploadedImage.classList.add('hidden');
      uploadedImage.classList.remove('video-visible');
      uploadedImage.src = "";
    }
    if (uploadedVideo) {
      uploadedVideo.src = objectURL;
      uploadedVideo.classList.remove('hidden');
      uploadedVideo.classList.add('video-visible');
      uploadedVideo.muted = true;
      uploadedVideo.loop = true;
      
      uploadedVideo.onloadedmetadata = () => {
        uploadedVideo.play();
        state.canvasWidth = uploadedVideo.videoWidth || 640;
        state.canvasHeight = uploadedVideo.videoHeight || 480;
        canvasElement.width = state.canvasWidth;
        canvasElement.height = state.canvasHeight;
        
        const frozenFrameCanvas = document.getElementById('frozen-frame-canvas');
        if (frozenFrameCanvas) {
          frozenFrameCanvas.width = state.canvasWidth;
          frozenFrameCanvas.height = state.canvasHeight;
        }

        const viewport = document.querySelector('.viewport');
        if (viewport) {
          viewport.style.aspectRatio = `${state.canvasWidth} / ${state.canvasHeight}`;
        }

        state.calBoxX = state.canvasWidth / 2;
        state.calBoxY = state.canvasHeight / 2;

        statusElement.textContent = "Uploaded video active. Syncing with computer vision models...";
      };

      uploadedVideo.onplay = () => {
        startUploadedMediaLoop();
      };

      uploadedVideo.onended = () => {
        console.log(`[ExportDebug] uploadedVideo.onended fired. isRecording: ${state.isRecording}, isRecordingPlayLoop: ${state.isRecordingPlayLoop}, currentTime: ${uploadedVideo.currentTime}, duration: ${uploadedVideo.duration}`);
        if (state.isRecording) {
          if (state.isRecordingPlayLoop) {
            statusElement.textContent = `⏱️ Video ended at ${uploadedVideo.currentTime.toFixed(1)}s. Finishing export...`;
            setTimeout(() => {
              stopVideoRecording();
            }, 100);
          } else {
            // Wait 2.5 seconds to let the MediaPipe processing pipeline catch up and drain fully to prevent end truncation
            statusElement.textContent = "⏱️ Finalizing export, compiling remaining frames... please wait.";
            setTimeout(() => {
              stopVideoRecording();
            }, 2500);
          }
        }
      };
    }
  } else {
    // Image
    if (videoControlsBar) {
      videoControlsBar.classList.add('hidden');
    }
    if (uploadedVideo) {
      uploadedVideo.classList.add('hidden');
      uploadedVideo.classList.remove('video-visible');
      try { uploadedVideo.pause(); } catch(e){}
      uploadedVideo.src = "";
    }
    if (uploadedImage) {
      uploadedImage.src = objectURL;
      uploadedImage.classList.remove('hidden');
      uploadedImage.classList.add('video-visible');
      
      uploadedImage.onload = async () => {
        const maxLiveDim = 1280;
        let w = uploadedImage.naturalWidth || 640;
        let h = uploadedImage.naturalHeight || 480;
        if (w > maxLiveDim || h > maxLiveDim) {
          const aspect = w / h;
          if (w > h) {
            w = maxLiveDim;
            h = Math.round(maxLiveDim / aspect);
          } else {
            h = maxLiveDim;
            w = Math.round(maxLiveDim * aspect);
          }
        }

        state.canvasWidth = w;
        state.canvasHeight = h;
        canvasElement.width = state.canvasWidth;
        canvasElement.height = state.canvasHeight;

        const frozenFrameCanvas = document.getElementById('frozen-frame-canvas');
        if (frozenFrameCanvas) {
          frozenFrameCanvas.width = state.canvasWidth;
          frozenFrameCanvas.height = state.canvasHeight;
        }

        const viewport = document.querySelector('.viewport');
        if (viewport) {
          viewport.style.aspectRatio = `${state.canvasWidth} / ${state.canvasHeight}`;
        }

        state.calBoxX = state.canvasWidth / 2;
        state.calBoxY = state.canvasHeight / 2;

        statusElement.textContent = "Processing static image...";

        // Send once to cache pose & hand landmarks
        try {
          await pose.send({ image: uploadedImage });
          await hands.send({ image: uploadedImage });
          statusElement.textContent = "Static image processed. Drag manual calibration scale or trigger snapshot captures.";
        } catch (err) {
          console.error("Error processing static image:", err);
          statusElement.textContent = "Error processing image.";
        }

        startUploadedMediaLoop();
      };
    }
  }
}

export function startUploadedMediaLoop() {
  async function videoInferenceLoop() {
    if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || uploadedVideo.paused || uploadedVideo.ended || state.isRecordingPlayLoop || state.isExportingFrameByFrame) {
      state.isVideoInferenceLoopRunning = false;
      return;
    }
    state.isVideoInferenceLoopRunning = true;

    const startTime = Date.now();
    try {
      if (!state.isSnapshotFrozen) {
        if (state.currentMode === 'squat') {
          state.latestArucoMarker = null;
          if (arucoStatusText) {
            arucoStatusText.innerHTML = `<span style="color: #BA0C2F; font-weight: 700;">Active Squat Analyzer Mode</span>`;
          }
        } else if ((state.importedPortfolioMetrics || (state.activeProfileId && state.pixelsPerCm)) && state.activeCalMethod !== 'aruco' && state.activeCalMethod !== 'validation') {
          state.latestArucoMarker = null;
          if (state.activeCalMethod === 'aruco' && arucoStatusText && state.pixelsPerCm) {
            arucoStatusText.innerHTML = `✅ Calibrated via Profile (<strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>)`;
          }
        } else if (typeof detectArucoMarker === 'function') {
          const found = detectArucoMarker(uploadedVideo);
          state.latestArucoMarker = found;

          if (found) {
            const corners = found.corners;
            const d01 = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
            const d12 = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
            const d23 = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
            const d30 = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
            const edgeLengthPx = (d01 + d12 + d23 + d30) / 4;

            // Safeguard: Ignore noise / false detections with extremely small edge lengths
            if (edgeLengthPx > 25) {
              // Smooth calibration scale to avoid webcam noise
              const smoothedScale = smooth('scale_factor', edgeLengthPx / MARKER_PHYSICAL_SIZE_CM, 8, 0.25);
              if (state.wallPerspectiveEnabled) {
                state.pixelsPerCm = smoothedScale * state.wallPerspectiveFactor;
              } else {
                state.pixelsPerCm = smoothedScale;
              }
              state.calLocked = true;

              if (state.activeCalMethod === 'aruco') {
                arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
              }
            } else {
              // If it's a tiny detection (likely noise), treat as not found in this frame
              state.latestArucoMarker = null;
            }
          } else {
            if (state.activeCalMethod === 'aruco') {
              if (state.pixelsPerCm) {
                arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
              } else {
                arucoStatusText.innerHTML = `🔍 Scanning for Reference (200mm)...`;
              }
            }
          }
        }

        // Sequential model calls - avoids Emscripten concurrent initialization/runtime namespace memory collision errors!
        await pose.send({ image: uploadedVideo });
        await hands.send({ image: uploadedVideo });
      }
    } catch (err) {
      console.error("Uploaded video processing error:", err);
    }

    const elapsed = Date.now() - startTime;
    const delay = Math.max(50 - elapsed, 1); // target ~20fps inference to prevent CPU starvation
    setTimeout(videoInferenceLoop, delay);
  }

  // Always kick off UI redraw loop
  startUiRenderLoop();

  // If it's a video, also kick off the background inference loop
  if (state.uploadedMediaType === 'video') {
    videoInferenceLoop();
  }
}

// Hook up upload media event listeners
if (uploadMediaBtn && mediaUploadInput) {
  uploadMediaBtn.addEventListener('click', () => {
    mediaUploadInput.click();
  });

  mediaUploadInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleUploadedFile(e.target.files[0]);
    }
  });
}

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
        if (snapshot.metrics && snapshot.metrics.isSquatMobility) {
          formattedHeight = "Mobility Peaks";
        } else if (snapshot.metrics && snapshot.metrics.skeletal_height) {
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
  state.activeModalSnapshotId = id;
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
      const isSquatMobility = m && m.isSquatMobility;

      const modalSectionStature = document.getElementById('modal-section-stature');
      const modalSectionJoints = document.getElementById('modal-section-joints');
      const modalSectionSquatPeaks = document.getElementById('modal-section-squat-peaks');
      const modalSectionLowerBody = document.getElementById('modal-section-lower-body');
      const modalSectionUpperBody = document.getElementById('modal-section-upper-body');
      const modalSectionWidths = document.getElementById('modal-section-widths');
      const modalSectionHandTracking = document.getElementById('modal-section-hand-tracking');

      if (isSquatMobility) {
        // Hide standard sections
        if (modalSectionStature) modalSectionStature.classList.add('hidden');
        if (modalSectionJoints) modalSectionJoints.classList.add('hidden');
        if (modalSectionLowerBody) modalSectionLowerBody.classList.add('hidden');
        if (modalSectionUpperBody) modalSectionUpperBody.classList.add('hidden');
        if (modalSectionWidths) modalSectionWidths.classList.add('hidden');
        if (modalSectionHandTracking) modalSectionHandTracking.classList.add('hidden');

        // Show squat peaks section
        if (modalSectionSquatPeaks) {
          modalSectionSquatPeaks.classList.remove('hidden');
          modalSectionSquatPeaks.classList.add('visible-block');
        }

        if (poseSwitcher) {
          poseSwitcher.classList.add('hidden');
          poseSwitcher.classList.remove('visible-flex');
        }
        if (thumbnailsContainer) {
          thumbnailsContainer.classList.add('hidden');
          thumbnailsContainer.classList.remove('visible-flex');
        }

        if (modalImg) modalImg.src = snapshot.image;

        if (m) {
          const peaks = m.squatPeaks || { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };
          setModalMetric('modal-squat-peak-knee-l', `${Math.round(peaks.kneeL)}°`);
          setModalMetric('modal-squat-peak-knee-r', `${Math.round(peaks.kneeR)}°`);
          setModalMetric('modal-squat-peak-hip-l', `${Math.round(peaks.hipL)}°`);
          setModalMetric('modal-squat-peak-hip-r', `${Math.round(peaks.hipR)}°`);
          setModalMetric('modal-squat-peak-ankle-l', `${Math.round(peaks.ankleL)}°`);
          setModalMetric('modal-squat-peak-ankle-r', `${Math.round(peaks.ankleR)}°`);

          // Calculate depth status
          const maxKneeMob = Math.max(peaks.kneeL, peaks.kneeR);
          let depthStatus = "Standing Upright";
          let statusClass = "text-slate";

          if (maxKneeMob >= 110) {
            depthStatus = "Deep Squat";
            statusClass = "text-emerald";
          } else if (maxKneeMob >= 75) {
            depthStatus = "Parallel Squat";
            statusClass = "text-red";
          } else if (maxKneeMob >= 30) {
            depthStatus = "Partial Squat";
            statusClass = "text-amber";
          }

          const depthStatusElem = document.getElementById('modal-squat-depth-status');
          if (depthStatusElem) {
            depthStatusElem.textContent = depthStatus;
            depthStatusElem.className = `modal-metric-val ${statusClass}`;
          }
        }
      } else {
        // Hide squat peaks section
        if (modalSectionSquatPeaks) {
          modalSectionSquatPeaks.classList.add('hidden');
          modalSectionSquatPeaks.classList.remove('visible-block');
        }

        // Show standard sections
        if (modalSectionStature) modalSectionStature.classList.remove('hidden');
        if (modalSectionJoints) modalSectionJoints.classList.remove('hidden');
        if (modalSectionLowerBody) modalSectionLowerBody.classList.remove('hidden');
        if (modalSectionUpperBody) modalSectionUpperBody.classList.remove('hidden');

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
              ANGLE_METRICS.forEach(am => {
                if (am.element) {
                  const val = angles[am.key];
                  setModalMetric(`modal-${am.element.id}`, (val !== undefined && val !== null) ? `${Math.round(val)}°` : "--°");
                }
              });
            } else {
              // Fallback to global metrics if angles object is missing
              ANGLE_METRICS.forEach(am => {
                if (am.element) {
                  const val = m[am.key];
                  setModalMetric(`modal-${am.element.id}`, val !== undefined ? `${val}°` : "--°");
                }
              });
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

            ANGLE_METRICS.forEach(am => {
              if (am.element) {
                const val = m[am.key];
                setModalMetric(`modal-${am.element.id}`, val !== undefined ? `${val}°` : "--°");
              }
            });
          }
        }

        if (m) {
          // Global and anatomical segments are populated from optimal poses
          // (Limb lengths, height, and widths come from optimal poses stored in metrics)
          setModalMetric('modal-val-height', formatSkeletalHeight(m.skeletal_height));
          setModalMetric('modal-val-wingspan', m.wingspan ? formatLength(m.wingspan) : "--.-");

          SEGMENT_METRICS.forEach(sm => {
            if (sm.element) {
              setModalMetric(`modal-${sm.element.id}`, m[sm.key] !== undefined ? formatLength(m[sm.key]) : "--.-");
            }
          });

          if (m.fingerToToeL !== undefined && m.fingerToToeR !== undefined) {
            setModalMetric('modal-val-overhead-reach', `L: ${formatLength(m.fingerToToeL)} / R: ${formatLength(m.fingerToToeR)}`);
          } else {
            setModalMetric('modal-val-overhead-reach', "--.-");
          }
          setModalMetric('modal-val-hip-w', m.hipW !== undefined ? formatLength(m.hipW) : "--.-");

          setModalMetric('modal-val-pinch-l', m.pinch_l_cm !== undefined && m.pinch_l_cm !== null ? formatLength(m.pinch_l_cm) : "--.-");
          setModalMetric('modal-val-pinch-r', m.pinch_r_cm !== undefined && m.pinch_r_cm !== null ? formatLength(m.pinch_r_cm) : "--.-");
          setModalMetric('modal-val-span-l', m.span_l_cm !== undefined && m.span_l_cm !== null ? formatLength(m.span_l_cm) : "--.-");
          setModalMetric('modal-val-span-r', m.span_r_cm !== undefined && m.span_r_cm !== null ? formatLength(m.span_r_cm) : "--.-");
        }
      }

      // Clone download, json, & delete buttons to purge old listeners
      const dlBtn = document.getElementById('modal-dl-btn');
      const jsonBtn = document.getElementById('modal-json-btn');
      const delBtn = document.getElementById('modal-del-btn');

      if (dlBtn) {
        const newDlBtn = dlBtn.cloneNode(true);
        dlBtn.parentNode.replaceChild(newDlBtn, dlBtn);
        newDlBtn.addEventListener('click', () => {
          const activeImageSrc = modalImg ? modalImg.src : snapshot.image;
          downloadSnapshotImage(activeImageSrc, snapshot.name || 'biomechanical-snapshot');
        });
      }

      if (jsonBtn) {
        const newJsonBtn = jsonBtn.cloneNode(true);
        jsonBtn.parentNode.replaceChild(newJsonBtn, jsonBtn);
        newJsonBtn.addEventListener('click', () => {
          downloadIndividualSnapshotJson(snapshot);
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
    state.scaleFactor3D = null; // Reset 3D scale so that it re-estimates based on new card scale!
    clearSmoothBuffer('scale_factor_3d_aruco');
    clearSmoothBuffer('height_scale_calibration');
    clearSmoothBuffer('body_height_skeletal');
    clearSmoothBuffer('body_height_live');
    
    lockCalButton.textContent = "Lock 20cm Calibration";
    lockCalButton.classList.add('cal-btn-unlocked');
    lockCalButton.classList.remove('cal-btn-locked');
  }
});

lockCalButton.addEventListener('click', () => {
  state.pixelsPerCm = state.calBoxSize / MARKER_PHYSICAL_SIZE_CM;
  state.calLocked = true;
  state.scaleFactor3D = null; // Force recalibration of 3D scale factor using new pixelsPerCm
  clearSmoothBuffer('scale_factor_3d_aruco');
  clearSmoothBuffer('height_scale_calibration');
  clearSmoothBuffer('body_height_skeletal');
  clearSmoothBuffer('body_height_live');
  
  lockCalButton.textContent = "✅ Scale Locked!";
  lockCalButton.classList.add('cal-btn-locked');
  lockCalButton.classList.remove('cal-btn-unlocked');
  statusElement.textContent = `Scale calibrated: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
  if (state.activeProfileId) {
    autoSyncToActiveProfile();
  }
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
  
  const width = state.canvasWidth || 640;
  const height = state.canvasHeight || 480;
  const canvasMouseX = (mouseX / rect.width) * width;
  const canvasMouseY = (mouseY / rect.height) * height;
  
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
  
  const width = state.canvasWidth || 640;
  const height = state.canvasHeight || 480;
  const canvasMouseX = (mouseX / rect.width) * width;
  const canvasMouseY = (mouseY / rect.height) * height;
  
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
    state.calBoxX = Math.max(state.calBoxSize/2, Math.min(width - state.calBoxSize/2, canvasMouseX - dragStartX));
    state.calBoxY = Math.max(state.calBoxSize/2, Math.min(height - state.calBoxSize/2, canvasMouseY - dragStartY));
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
    
    const width = state.canvasWidth || 640;
    const height = state.canvasHeight || 480;
    const canvasMouseX = (mouseX / rect.width) * width;
    const canvasMouseY = (mouseY / rect.height) * height;
    
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
    
    const width = state.canvasWidth || 640;
    const height = state.canvasHeight || 480;
    const canvasMouseX = (mouseX / rect.width) * width;
    const canvasMouseY = (mouseY / rect.height) * height;
    
    state.calBoxX = Math.max(state.calBoxSize/2, Math.min(width - state.calBoxSize/2, canvasMouseX - dragStartX));
    state.calBoxY = Math.max(state.calBoxSize/2, Math.min(height - state.calBoxSize/2, canvasMouseY - dragStartY));
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

  SEGMENT_METRICS.forEach(m => updatePlaceholder(m.element, "--.- cm", "--.- inches"));

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
  } else {
    updateDashboardOfflinePlaceholders();
  }
  if (state.dbInitialized) {
    renderGallery();
  }
  const modal = document.getElementById('snapshot-modal');
  if (modal && !modal.classList.contains('hidden') && state.activeModalSnapshotId) {
    openSnapshotModal(state.activeModalSnapshotId);
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
  } else {
    updateDashboardOfflinePlaceholders();
  }
  if (state.dbInitialized) {
    renderGallery();
  }
  const modal = document.getElementById('snapshot-modal');
  if (modal && !modal.classList.contains('hidden') && state.activeModalSnapshotId) {
    openSnapshotModal(state.activeModalSnapshotId);
  }
});

// Switch calibration tabs
function switchCalibrationTab(method, activeBtn, activePanel) {
  state.activeCalMethod = method;
  state.scaleFactor3D = null; // Clear scale factor on switch so we can recalibrate cleanly!
  
  // Clear calibration-related smoothing buffers to avoid slow drift/lag from previous states
  clearSmoothBuffer('scale_factor');
  clearSmoothBuffer('scale_factor_3d_height');
  clearSmoothBuffer('scale_factor_3d_aruco');
  clearSmoothBuffer('height_scale_calibration');
  clearSmoothBuffer('body_height_skeletal');
  clearSmoothBuffer('body_height_live');
  
  [tabArucoBtn, tabHeightBtn, tabPortfolioBtn, tabValidationBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('btn-tab-active', btn === activeBtn);
      btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
    }
  });

  [panelAruco, panelCard, panelHeight, panelPortfolio, panelValidation].forEach(panel => {
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
  } else if (method === 'validation' || method === 'aruco') {
    // For validation or aruco tab, keep current pixelsPerCm if already calibrated, or restore from active profile if any
    if (state.activeProfileId && !state.pixelsPerCm) {
      const activeProfile = state.allProfiles?.find(p => p.id === state.activeProfileId);
      const activeSession = activeProfile?.sessions?.find(s => s.id === state.activeSessionId) || activeProfile?.sessions?.[activeProfile.sessions.length - 1];
      const sessionPixelsPerCm = activeSession?.pixelsPerCm || activeProfile?.pixelsPerCm;
      if (sessionPixelsPerCm) {
        state.pixelsPerCm = sessionPixelsPerCm;
        state.calLocked = true;
      }
    }
    if (!state.pixelsPerCm) {
      state.pixelsPerCm = null;
      state.calLocked = false;
    } else {
      state.calLocked = true;
    }
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


if (tabPortfolioBtn) {
  tabPortfolioBtn.addEventListener('click', () => {
    switchCalibrationTab('portfolio', tabPortfolioBtn, panelPortfolio);
  });
}

// Premeasured scale factor pasting event listener
if (btnApplyScale && inputPremeasuredScale) {
  btnApplyScale.addEventListener('click', () => {
    const val = parseFloat(inputPremeasuredScale.value);
    if (isNaN(val) || val <= 0) {
      alert("Please enter a valid positive numeric scale factor (px/cm).");
      return;
    }

    state.pixelsPerCm = val;
    state.calLocked = true;

    // Visual feedback glow
    btnApplyScale.classList.add('btn-success-glow');
    btnApplyScale.textContent = "Scale Applied! ✅";
    
    setTimeout(() => {
      btnApplyScale.classList.remove('btn-success-glow');
      btnApplyScale.textContent = "Apply Scale";
    }, 2000);

    // Update global scale indicators
    if (arucoStatusText) {
      arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-red">${state.pixelsPerCm.toFixed(2)} px/cm</strong>`;
    }
    
    statusElement.textContent = `Scale calibration locked to pasted premeasured factor: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
    if (state.activeProfileId) {
      autoSyncToActiveProfile();
    }
  });
}

// Prior portfolio JSON session importer event listeners
if (btnImportPortfolio && textareaPortfolioJson) {
  btnImportPortfolio.addEventListener('click', () => {
    const rawVal = textareaPortfolioJson.value.trim();
    if (!rawVal) {
      alert("Please paste a session JSON report in the text area.");
      return;
    }

    try {
      const data = JSON.parse(rawVal);
      importPriorPortfolio(data);
    } catch (e) {
      alert(`Invalid JSON format: ${e.message}\nPlease make sure you are pasting a valid JSON object.`);
    }
  });
}

// Combined export button event listener
if (btnExportCombined) {
  btnExportCombined.addEventListener('click', exportCombinedAssessmentCard);
}

if (btnExportVideo) {
  btnExportVideo.addEventListener('click', toggleVideoRecording);
}

export function exportCombinedAssessmentCard() {
  const img = document.getElementById('uploaded-image');
  if (!img || img.classList.contains('hidden') || !img.src) {
    alert("Please upload a static image first.");
    return;
  }
  if (!state.latestPoseResults || !state.latestPoseResults.poseLandmarks) {
    alert("Subject pose not detected yet. Please wait for detection to complete.");
    return;
  }

  const width = img.naturalWidth || 640;
  const height = img.naturalHeight || 480;

  // Temporarily set canvas dimensions to natural size so calculatePoseMetrics computes native high-res coordinates!
  const originalWidth = state.canvasWidth;
  const originalHeight = state.canvasHeight;
  state.canvasWidth = width;
  state.canvasHeight = height;

  const calculated = calculatePoseMetrics(state.latestPoseResults);

  // Restore original live dimensions
  state.canvasWidth = originalWidth;
  state.canvasHeight = originalHeight;

  if (!calculated) {
    alert("Could not calculate pose metrics.");
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Draw background image
  ctx.drawImage(img, 0, 0, width, height);

  // Proportional metrics
  const scale = width / 640;
  const lineWidth = Math.max(2.5, 3.5 * scale);
  const jointRadius = Math.max(4.0, 5.0 * scale);

  const drawOffscreenJoint = (pt, color) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, jointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 1 * scale);
    ctx.stroke();
  };

  const drawOffscreenBone = (p1, p2, color) => {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const {
    shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
    shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
    head_top, ground_y, all_landmarks, liveMetrics
  } = calculated;

  // Draw skeleton
  drawOffscreenBone(shoulder_l, shoulder_r, '#d4a017'); 
  drawOffscreenBone(hip_l, hip_r, '#d4a017'); 
  drawOffscreenBone(shoulder_l, hip_l, '#38bdf8'); 
  drawOffscreenBone(shoulder_r, hip_r, '#38bdf8'); 

  // Left Arm & Leg
  drawOffscreenBone(shoulder_l, elbow_l, '#ec4899'); 
  drawOffscreenBone(elbow_l, wrist_l, '#f43f5e'); 
  drawOffscreenBone(hip_l, knee_l, '#d4a017'); 
  drawOffscreenBone(knee_l, ankle_l, '#06b6d4'); 
  drawOffscreenBone(ankle_l, heel_l, '#10b981'); 
  drawOffscreenBone(heel_l, toe_l, '#10b981'); 

  // Right Arm & Leg
  drawOffscreenBone(shoulder_r, elbow_r, '#ec4899'); 
  drawOffscreenBone(elbow_r, wrist_r, '#f43f5e'); 
  drawOffscreenBone(hip_r, knee_r, '#d4a017'); 
  drawOffscreenBone(knee_r, ankle_r, '#06b6d4'); 
  drawOffscreenBone(ankle_r, heel_r, '#10b981'); 
  drawOffscreenBone(heel_r, toe_r, '#10b981'); 

  // Joint circles
  const jointNodes = [
    { pt: shoulder_l, color: '#d4a017' },
    { pt: shoulder_r, color: '#d4a017' },
    { pt: elbow_l, color: '#d946ef' },
    { pt: elbow_r, color: '#d946ef' },
    { pt: wrist_l, color: '#f43f5e' },
    { pt: wrist_r, color: '#f43f5e' },
    { pt: hip_l, color: '#d4a017' },
    { pt: hip_r, color: '#d4a017' },
    { pt: knee_l, color: '#10b981' },
    { pt: knee_r, color: '#10b981' },
    { pt: ankle_l, color: '#06b6d4' },
    { pt: ankle_r, color: '#06b6d4' },
    { pt: toe_l, color: '#10b981' },
    { pt: toe_r, color: '#10b981' },
    { pt: head_top, color: '#06b6d4' }
  ];

  jointNodes.forEach(node => {
    drawOffscreenJoint(node.pt, node.color);
  });

  // Draw ruler
  if (state.pixelsPerCm && liveMetrics) {
    const body_xs = [shoulder_l.x, shoulder_r.x, hip_l.x, hip_r.x, knee_l.x, knee_r.x, ankle_l.x, ankle_r.x];
    const min_x = Math.min(...body_xs);
    const max_x = Math.max(...body_xs);
    const ruler_margin = 40 * scale;
    const ruler_x = max_x + ruler_margin < width - 20 * scale ? max_x + ruler_margin : min_x - ruler_margin > 20 * scale ? min_x - ruler_margin : 50 * scale;

    const live_inches = liveMetrics.live_height / 2.54;
    const live_feet = Math.floor(live_inches / 12);
    const live_inches_left = live_inches % 12;
    const live_feet_inches_str = `${live_feet}' ${live_inches_left.toFixed(1)}"`;

    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = Math.max(1.5, 2.5 * scale);
    ctx.beginPath();
    ctx.moveTo(ruler_x, head_top.y);
    ctx.lineTo(ruler_x, ground_y);
    ctx.stroke();

    const tick_w = Math.max(10, 15 * scale);
    ctx.beginPath();
    ctx.moveTo(ruler_x - tick_w / 2, head_top.y);
    ctx.lineTo(ruler_x + tick_w / 2, head_top.y);
    ctx.moveTo(ruler_x - tick_w / 2, ground_y);
    ctx.lineTo(ruler_x + tick_w / 2, ground_y);
    ctx.stroke();

    ctx.fillStyle = '#06b6d4';
    ctx.font = `bold ${Math.max(10, Math.round(12 * scale))}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
    ctx.shadowBlur = Math.round(4 * scale);

    const label_text = `${formatLength(liveMetrics.live_height)} (${live_feet_inches_str})`;
    ctx.fillText(label_text, ruler_x + tick_w, (head_top.y + ground_y) / 2);
    ctx.restore();
  }

  // Draw assessment stats card
  const card_w = 260 * scale;
  const card_h = 320 * scale;
  const card_x = width - card_w - 20 * scale;
  const card_y = 20 * scale;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 22, 38, 0.85)';
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.4)';
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.shadowColor = 'rgba(236, 72, 153, 0.5)';
  ctx.shadowBlur = Math.round(10 * scale);

  const radius = Math.round(12 * scale);
  ctx.beginPath();
  ctx.moveTo(card_x + radius, card_y);
  ctx.lineTo(card_x + card_w - radius, card_y);
  ctx.quadraticCurveTo(card_x + card_w, card_y, card_x + card_w, card_y + radius);
  ctx.lineTo(card_x + card_w, card_y + card_h - radius);
  ctx.quadraticCurveTo(card_x + card_w, card_y + card_h, card_x + card_w - radius, card_y + card_h);
  ctx.lineTo(card_x + radius, card_y + card_h);
  ctx.quadraticCurveTo(card_x, card_y + card_h, card_x, card_y + card_h - radius);
  ctx.lineTo(card_x, card_y + radius);
  ctx.quadraticCurveTo(card_x, card_y, card_x + radius, card_y);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.fillStyle = '#ec4899';
  ctx.font = `bold ${Math.max(11, Math.round(13 * scale))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText("SCARLET BIOMECHANICS LAB", card_x + card_w / 2, card_y + 25 * scale);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = Math.max(1, 1 * scale);
  ctx.beginPath();
  ctx.moveTo(card_x + 15 * scale, card_y + 38 * scale);
  ctx.lineTo(card_x + card_w - 15 * scale, card_y + 38 * scale);
  ctx.stroke();

  const subjectInput = document.getElementById('subject-name-input');
  const subjectName = (subjectInput && subjectInput.value.trim()) || "Subject";
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(10, Math.round(11 * scale))}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`SUBJECT: ${subjectName.toUpperCase()}`, card_x + 15 * scale, card_y + 55 * scale);

  const todayStr = new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${Math.max(8, Math.round(9 * scale))}px sans-serif`;
  ctx.fillText(`DATE: ${todayStr}`, card_x + 15 * scale, card_y + 70 * scale);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.moveTo(card_x + 15 * scale, card_y + 80 * scale);
  ctx.lineTo(card_x + card_w - 15 * scale, card_y + 80 * scale);
  ctx.stroke();

  let listItems = [];
  if (liveMetrics) {
    listItems.push({ name: "Stature (Skeletal)", val: formatLength(liveMetrics.skeletal_height || liveMetrics.live_height) });
    if (liveMetrics.wingspan) {
      listItems.push({ name: "Wingspan", val: formatLength(liveMetrics.wingspan) });
    }
    if (liveMetrics.thigh_l && liveMetrics.thigh_r) {
      const avgThigh = (liveMetrics.thigh_l + liveMetrics.thigh_r) / 2;
      listItems.push({ name: "Thigh Length", val: formatLength(avgThigh) });
    }
    if (liveMetrics.shin_l && liveMetrics.shin_r) {
      const avgShin = (liveMetrics.shin_l + liveMetrics.shin_r) / 2;
      listItems.push({ name: "Shin Length", val: formatLength(avgShin) });
    }
    if (liveMetrics.torso_l && liveMetrics.torso_r) {
      const avgTorso = (liveMetrics.torso_l + liveMetrics.torso_r) / 2;
      listItems.push({ name: "Torso Length", val: formatLength(avgTorso) });
    }
    if (calculated.kneeAngleL && calculated.kneeAngleR) {
      listItems.push({ name: "Knee Angle (L/R)", val: `${calculated.kneeAngleL}° / ${calculated.kneeAngleR}°` });
    }
    if (calculated.hipAngleL && calculated.hipAngleR) {
      listItems.push({ name: "Hip Angle (L/R)", val: `${calculated.hipAngleL}° / ${calculated.hipAngleR}°` });
    }
  } else if (state.metricsA) {
    const mA = state.metricsA;
    listItems.push({ name: "Stature (Skeletal)", val: formatLength(mA.skeletal_height) });
    if (mA.wingspan) {
      listItems.push({ name: "Wingspan", val: formatLength(mA.wingspan) });
    }
    if (mA.thigh_l) listItems.push({ name: "Thigh Length", val: formatLength(mA.thigh_l) });
    if (mA.shin_l) listItems.push({ name: "Shin Length", val: formatLength(mA.shin_l) });
    if (mA.torso_l) listItems.push({ name: "Torso Length", val: formatLength(mA.torso_l) });
    if (mA.kneeAngleL) listItems.push({ name: "Knee Angle (L/R)", val: `${mA.kneeAngleL}° / ${mA.kneeAngleR}°` });
  } else {
    listItems.push({ name: "Stature", val: "N/A" });
  }

  let item_y = card_y + 100 * scale;
  const item_height = 28 * scale;

  listItems.forEach(item => {
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${Math.max(9, Math.round(10 * scale))}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(item.name.toUpperCase(), card_x + 15 * scale, item_y);

    ctx.fillStyle = '#38bdf8';
    ctx.font = `bold ${Math.max(10, Math.round(11 * scale))}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(item.val, card_x + card_w - 15 * scale, item_y);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = Math.max(0.5, 0.75 * scale);
    ctx.beginPath();
    ctx.moveTo(card_x + 15 * scale, item_y + 8 * scale);
    ctx.lineTo(card_x + card_w - 15 * scale, item_y + 8 * scale);
    ctx.stroke();

    item_y += item_height;
  });

  ctx.restore();

  const dataURL = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  const cleanSubjectName = subjectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  link.download = `scarlet_biomechanics_${cleanSubjectName}_assessment.png`;
  link.href = dataURL;
  link.click();
}

export function startVideoRecording() {
  if (state.isRecording) return;

  state.recordedChunks = [];
  const fps = 30;
  // Capture canvas stream
  let stream;
  try {
    stream = canvasElement.captureStream(fps);
  } catch (err) {
    console.error("Canvas captureStream failed:", err);
    alert("Could not start canvas recording. Your browser may not support canvas.captureStream().");
    return;
  }

  // Determine the best supported mimeType (prioritizing stable WebM VP8 to prevent Windows VP9 hardware-acceleration crashes on Canvas recordings)
  let mimeType = '';
  const types = [
    'video/webm;codecs=vp8',
    'video/webm',
    'video/webm;codecs=vp9',
    'video/mp4;codecs=h264'
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) {
      mimeType = t;
      break;
    }
  }

  const options = mimeType ? { 
    mimeType: mimeType,
    videoBitsPerSecond: 2500000 // 2.5 Mbps target for stable, high-quality encoding without overwhelming the CPU/GPU
  } : {};
  
  try {
    state.mediaRecorder = new MediaRecorder(stream, options);
  } catch (err) {
    console.error("MediaRecorder initialization failed:", err);
    alert("Could not initialize MediaRecorder. Please check browser compatibility.");
    return;
  }

  // Handle encoding errors gracefully
  state.mediaRecorder.onerror = (event) => {
    console.error("[ExportDebug] MediaRecorder error:", event.error);
    statusElement.textContent = `⚠️ Recording encoder error: ${event.error.name} - ${event.error.message}`;
  };

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.recordedChunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = () => {
    console.log(`[ExportDebug] MediaRecorder stopped. Chunks collected: ${state.recordedChunks.length}`);
    if (state.recordedChunks.length === 0) {
      console.warn("No recorded chunks gathered!");
      statusElement.textContent = "❌ Export failed: No video data captured.";
      return;
    }

    const duration = Date.now() - (state.recordingStartTime || Date.now());
    const rawBlob = new Blob(state.recordedChunks, {
      type: mimeType || 'video/webm'
    });

    console.log(`[ExportDebug] Compiled raw blob size: ${(rawBlob.size / 1024 / 1024).toFixed(2)} MB, calculated duration: ${duration}ms`);

    const ext = (mimeType && mimeType.includes('mp4')) ? 'mp4' : 'webm';

    if (ext === 'webm' && typeof ysFixWebmDuration === 'function') {
      console.log(`[ExportDebug] Applying WebM duration fix...`);
      ysFixWebmDuration(rawBlob, duration, { logger: false })
        .then((fixedBlob) => {
          console.log(`[ExportDebug] WebM duration fix succeeded. Fixed blob size: ${(fixedBlob.size / 1024 / 1024).toFixed(2)} MB`);
          triggerDownload(fixedBlob, ext, duration);
        })
        .catch((err) => {
          console.error("[ExportDebug] Failed to fix WebM duration, exporting raw stream:", err);
          triggerDownload(rawBlob, ext, duration);
        });
    } else {
      triggerDownload(rawBlob, ext, duration);
    }

    function triggerDownload(blobToDownload, fileExt, finalDuration) {
      const url = URL.createObjectURL(blobToDownload);
      const a = document.createElement('a');
      a.classList.add('hidden');
      a.href = url;
      const subjectInput = document.getElementById('subject-name-input');
      const subjectName = (subjectInput && subjectInput.value.trim()) || "Subject";
      const cleanSubjectName = subjectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      
      if (state.currentMode === 'squat') {
        const side = state.squatTestingSide || 'left';
        a.download = `scarlet_biomechanics_${cleanSubjectName}_${side}_overhead_squat.${fileExt}`;
      } else {
        a.download = `scarlet_biomechanics_${cleanSubjectName}_recording.${fileExt}`;
      }
      
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);

      state.isRecording = false;
      updateRecordButtonUI();
      
      const sizeMb = (blobToDownload.size / (1024 * 1024)).toFixed(2);
      const durationSec = (finalDuration / 1000).toFixed(1);
      const successMsg = `✅ Video exported successfully! [Duration: ${durationSec}s, Size: ${sizeMb}MB, Format: ${fileExt.toUpperCase()}]`;
      console.log(`[ExportDebug] Download triggered. ${successMsg}`);
      statusElement.textContent = successMsg;

      // Save video to active profile if one is selected
      if (state.activeProfileId) {
        saveVideoToActiveProfile(blobToDownload, fileExt, finalDuration);
      }
    }
  };

  state.isRecording = true;
  state.recordingStartTime = Date.now();
  state.mediaRecorder.start(); // Start recording without timeslices to avoid index corruption
  updateRecordButtonUI();
  statusElement.textContent = "🔴 Video recording in progress... Click the red button to stop and save.";
}

export function stopVideoRecording() {
  console.log(`[ExportDebug] stopVideoRecording() triggered. isRecording: ${state.isRecording}, isRecordingPlayLoop: ${state.isRecordingPlayLoop}`);
  if (!state.isRecording || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
    console.warn(`[ExportDebug] stopVideoRecording called but not actively recording.`);
    return;
  }
  
  try {
    state.mediaRecorder.stop();
    console.log(`[ExportDebug] mediaRecorder.stop() called successfully.`);
  } catch (err) {
    console.error("[ExportDebug] Failed to call mediaRecorder.stop():", err);
  }

  // Reset high-fidelity video export flags
  state.isRecordingPlayLoop = false;
  state.isExportingFrameByFrame = false;
  state.exportFramesData = [];

  // Restore original video looping and playback speed after export completes
  if (state.isUploadedMedia && state.uploadedMediaType === 'video' && uploadedVideo) {
    if (state.wasLooping !== undefined) {
      uploadedVideo.loop = state.wasLooping;
    }
    if (state.wasPlaybackRate !== undefined) {
      uploadedVideo.playbackRate = state.wasPlaybackRate;
    }
  }
}

export async function saveVideoToActiveProfile(blobToDownload, fileExt, finalDuration) {
  try {
    const profile = await snapshotStore.getProfile(state.activeProfileId);
    if (profile) {
      profile.videos = profile.videos || [];
      
      const labelPrefix = state.currentMode === 'squat' 
        ? (state.squatTestingSide === 'left' ? "Left Overhead Squat" : "Right Overhead Squat") 
        : "Video Capture";
        
      const videoEntry = {
        id: Date.now(),
        name: `${labelPrefix} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`,
        blob: blobToDownload,
        timestamp: Date.now(),
        duration: finalDuration,
        fileExt: fileExt
      };
      profile.videos.push(videoEntry);
      await snapshotStore.saveProfile(profile);
      
      // Update local cache
      state.allProfiles = await snapshotStore.getAllProfiles();
      
      console.log(`[VideoSave] Successfully saved video to profile: ${profile.name}`);
      statusElement.textContent = `🎥 Video saved directly to "${profile.name}"'s portfolio and downloaded locally!`;
    }
  } catch (err) {
    console.error("[VideoSave] Failed to save video to active profile:", err);
  }
}

export function toggleVideoRecording() {
  if (state.isExportingFrameByFrame) {
    // Cancel frame pre-processing
    state.isExportingFrameByFrame = false;
    hideExportProgressOverlay();
    statusElement.textContent = "❌ Export pre-processing cancelled.";
    // Restore original video playback settings
    if (state.isUploadedMedia && state.uploadedMediaType === 'video' && uploadedVideo) {
      if (state.wasLooping !== undefined) uploadedVideo.loop = state.wasLooping;
      if (state.wasPlaybackRate !== undefined) uploadedVideo.playbackRate = state.wasPlaybackRate;
    }
    updateRecordButtonUI();
    return;
  }

  if (state.isRecording) {
    stopVideoRecording();
  } else {
    if (state.isUploadedMedia && state.uploadedMediaType === 'video') {
      const uploadedVideo = document.getElementById('uploaded-video');
      if (uploadedVideo) {
        runVideoFramePreprocessing();
      } else {
        startVideoRecording();
      }
    } else {
      startVideoRecording();
    }
  }
}

export function updateRecordButtonUI() {
  if (!btnExportVideo) return;
  const isVideo = state.isUploadedMedia && state.uploadedMediaType === 'video';

  btnExportVideo.classList.remove('btn-export-cancel', 'btn-export-recording', 'btn-export-ready', 'recording-pulse');

  if (state.isExportingFrameByFrame) {
    btnExportVideo.innerHTML = `
      <span class="recording-dot cancel"></span>
      Cancel Analysis...
    `;
    btnExportVideo.classList.add('btn-export-cancel', 'recording-pulse');
  } else if (state.isRecording) {
    btnExportVideo.innerHTML = `
      <span class="recording-dot"></span>
      ${isVideo ? 'Exporting Full Video...' : 'Stop & Export Video'}
    `;
    btnExportVideo.classList.add('btn-export-recording', 'recording-pulse');
  } else {
    if (isVideo) {
      btnExportVideo.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="btn-icon-inline">
          <polyline points="8 17 12 21 16 17"></polyline>
          <line x1="12" y1="12" x2="12" y2="21"></line>
          <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"></path>
        </svg>
        Export Full Video
      `;
    } else {
      btnExportVideo.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="btn-icon-inline">
          <circle cx="12" cy="12" r="10"></circle>
          <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
        </svg>
        Record & Export Video
      `;
    }
    btnExportVideo.classList.add('btn-export-ready');
  }
}

export async function runVideoFramePreprocessing() {
  if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || !uploadedVideo) {
    statusElement.textContent = "❌ No active uploaded video found for high-fidelity export.";
    return;
  }

  // Prevent double triggers
  if (state.isExportingFrameByFrame || state.isRecordingPlayLoop) return;

  statusElement.textContent = "⚙️ Initiating High-Fidelity Pre-processing...";
  state.isExportingFrameByFrame = true;
  state.exportFramesData = [];
  updateRecordButtonUI();

  // Temporarily pause standard looping and background inference
  uploadedVideo.pause();
  
  // Store original video settings
  state.wasLooping = uploadedVideo.loop;
  state.wasPlaybackRate = uploadedVideo.playbackRate;
  
  uploadedVideo.loop = false;
  uploadedVideo.playbackRate = 1.0; // pre-process at normal playhead rate reference

  const duration = uploadedVideo.duration;
  if (!duration || isNaN(duration)) {
    statusElement.textContent = "❌ Failed to retrieve video duration. Cannot pre-process.";
    state.isExportingFrameByFrame = false;
    updateRecordButtonUI();
    return;
  }

  showExportProgressOverlay(0);

  const fps = 30;
  const dt = 1 / fps;
  let currentTime = 0;

  // Let's create our promise-based seek helper
  function seekVideoTo(time) {
    return new Promise((resolve) => {
      let resolved = false;
      function onSeeked() {
        if (!resolved) {
          resolved = true;
          uploadedVideo.removeEventListener('seeked', onSeeked);
          resolve();
        }
      }
      uploadedVideo.addEventListener('seeked', onSeeked);
      uploadedVideo.currentTime = time;
      
      // Safety timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          uploadedVideo.removeEventListener('seeked', onSeeked);
          resolve();
        }
      }, 1000);
    });
  }

  try {
    while (currentTime <= duration && state.isExportingFrameByFrame) {
      // 1. Seek video to currentTime
      await seekVideoTo(currentTime);

      // 2. Clear old state results to prevent frame bleed / stale data
      state.latestPoseResults = null;
      state.latestHandResults = null;

      // 3. Process video frame via MediaPipe Pose and Hands models
      try {
        await pose.send({ image: uploadedVideo });
        await hands.send({ image: uploadedVideo });
      } catch (err) {
        console.warn(`MediaPipe processing error at t=${currentTime.toFixed(3)}s:`, err);
      }

      // 4. Cache landmarks & results
      const poseLandmarksClone = state.latestPoseResults && state.latestPoseResults.poseLandmarks
        ? JSON.parse(JSON.stringify(state.latestPoseResults.poseLandmarks))
        : null;

      const handResultsClone = state.latestHandResults
        ? JSON.parse(JSON.stringify(state.latestHandResults))
        : null;

      state.exportFramesData.push({
        time: currentTime,
        poseLandmarks: poseLandmarksClone,
        handResults: handResultsClone
      });

      // 5. Update glassmorphic progress HUD
      const progressPercent = Math.min(100, (currentTime / duration) * 100);
      showExportProgressOverlay(progressPercent);
      statusElement.textContent = `⚙️ Analyzing biomechanical movements... ${progressPercent.toFixed(0)}%`;

      // 6. Step forward
      currentTime += dt;
    }

    // Pre-processing complete!
    if (state.isExportingFrameByFrame) {
      hideExportProgressOverlay();
      statusElement.textContent = "✅ Pre-processing complete. Initializing zero-lag playout record...";
      state.isExportingFrameByFrame = false;
      updateRecordButtonUI();

      // Start the Playout phase!
      await startRealTimePlaybackExport();
    }
  } catch (err) {
    console.error("High-Fidelity Pre-processing failed:", err);
    statusElement.textContent = "❌ High-Fidelity Pre-processing failed. Reverting to manual recording.";
    hideExportProgressOverlay();
    state.isExportingFrameByFrame = false;
    state.exportFramesData = [];
    updateRecordButtonUI();
    
    // Fallback: start standard recording
    startVideoRecording();
  }
}

export async function startRealTimePlaybackExport() {
  if (!uploadedVideo) return;

  // Set the playout recording flag early to ensure any seeked event triggered by resetting the currentTime is ignored by the manual single-frame inference listener
  state.isRecordingPlayLoop = true;

  statusElement.textContent = "🔴 Starting recording playout at 1.0x speed...";
  
  // Set video to beginning and wait for seeked to complete
  await new Promise((resolve) => {
    let resolved = false;
    function onSeeked() {
      if (!resolved) {
        resolved = true;
        uploadedVideo.removeEventListener('seeked', onSeeked);
        resolve();
      }
    }
    uploadedVideo.addEventListener('seeked', onSeeked);
    uploadedVideo.currentTime = 0;
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        uploadedVideo.removeEventListener('seeked', onSeeked);
        resolve();
      }
    }, 1000);
  });

  
  // Start canvas recording
  startVideoRecording();
  
  // Play the video at standard 1.0x speed
  uploadedVideo.play();
  
  statusElement.textContent = "🔴 Recording playout is active. Analyzing from cached timeline... please do not close this tab.";
  updateRecordButtonUI();
}

export function showExportProgressOverlay(percent) {
  const viewport = document.querySelector('.viewport');
  if (!viewport) return;

  let overlay = document.getElementById('export-progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'export-progress-overlay';
    overlay.className = 'export-progress-overlay';
    overlay.innerHTML = `
      <div class="export-progress-card">
        <div class="export-progress-spinner">
          <svg class="spinner-svg" viewBox="0 0 50 50">
            <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
          </svg>
        </div>
        <div class="export-progress-title">Analyzing Athletic Motion</div>
        <div class="export-progress-subtitle">Phase 1 of 2: High-Fidelity Pre-processing</div>
        <div class="export-progress-bar-container">
          <div class="export-progress-bar-fill" id="export-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="export-progress-text" id="export-progress-text">0% Completed</div>
        <div class="export-progress-warning">
          Biomechanical calculation is active. Once finished, Phase 2 will start recording
        </div>
      </div>
    `;
    viewport.appendChild(overlay);
  }

  // Update percentages
  const fill = document.getElementById('export-progress-fill');
  const text = document.getElementById('export-progress-text');
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${Math.round(percent)}% Completed`;
}

export function hideExportProgressOverlay() {
  const overlay = document.getElementById('export-progress-overlay');
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
}

export function importPriorPortfolio(report) {
  if (!report) return;

  // Try to extract active calculated metrics from the current cached results,
  // or calculate them from the latest pose results if available.
  const activeCalculated = state.lastCalculatedResults || (state.latestPoseResults ? calculatePoseMetrics(state.latestPoseResults) : null);

  // Detect the current pose purely from the active calculation coordinates to avoid profile misalignments
  let detectedPose = "A-Pose";
  if (activeCalculated && activeCalculated.all_landmarks) {
    if (activeCalculated.liveMetrics && activeCalculated.liveMetrics.pose) {
      detectedPose = activeCalculated.liveMetrics.pose;
    } else {
      const lm = activeCalculated.all_landmarks;
      const head_top = activeCalculated.head_top;
      const shoulder_l = activeCalculated.shoulder_l;
      const shoulder_r = activeCalculated.shoulder_r;
      const hip_l = activeCalculated.hip_l;
      const hip_r = activeCalculated.hip_r;
      const knee_l = activeCalculated.knee_l;
      const knee_r = activeCalculated.knee_r;
      const ankle_l = activeCalculated.ankle_l;
      const ankle_r = activeCalculated.ankle_r;
      const heel_l = activeCalculated.heel_l;
      const heel_r = activeCalculated.heel_r;
      const toe_l = activeCalculated.toe_l;
      const toe_r = activeCalculated.toe_r;
      
      const shoulder_mid = {
        x: (shoulder_l.x + shoulder_r.x) / 2,
        y: (shoulder_l.y + shoulder_r.y) / 2
      };
      const head_segment_px = Math.hypot(head_top.x - shoulder_mid.x, head_top.y - shoulder_mid.y);
      const hip_mid_x = (hip_l.x + hip_r.x) / 2;
      const hip_mid_y = (hip_l.y + hip_r.y) / 2;
      const torso_segment_px = Math.hypot(shoulder_mid.x - hip_mid_x, shoulder_mid.y - hip_mid_y);
      const leg_l_px = Math.hypot(hip_l.x - knee_l.x, hip_l.y - knee_l.y) + 
                       Math.hypot(knee_l.x - ankle_l.x, knee_l.y - ankle_l.y) + 
                       Math.hypot(ankle_l.x - heel_l.x, ankle_l.y - heel_l.y);
      const leg_r_px = Math.hypot(hip_r.x - knee_r.x, hip_r.y - knee_r.y) + 
                       Math.hypot(knee_r.x - ankle_r.x, knee_r.y - ankle_r.y) + 
                       Math.hypot(ankle_r.x - heel_r.x, ankle_r.y - heel_r.y);
      const average_leg_px = (leg_l_px + leg_r_px) / 2;
      const skeletal_height_px = head_segment_px + torso_segment_px + average_leg_px;
      
      let wingspan_px = 0;
      if (state.latestLeftMiddleTip && state.latestRightMiddleTip) {
        wingspan_px = Math.hypot(state.latestLeftMiddleTip.x - state.latestRightMiddleTip.x, state.latestLeftMiddleTip.y - state.latestRightMiddleTip.y);
      } else {
        const leftIdx = lm[19];
        const rightIdx = lm[20];
        if (leftIdx && rightIdx) {
          wingspan_px = Math.hypot(leftIdx.x - rightIdx.x, leftIdx.y - rightIdx.y);
        }
      }
      
      const finger_l = state.latestLeftMiddleTip || lm[19] || activeCalculated.wrist_l;
      const fingerToToeL_px = Math.hypot(finger_l.x - toe_l.x, finger_l.y - toe_l.y);
      const finger_r = state.latestRightMiddleTip || lm[20] || activeCalculated.wrist_r;
      const fingerToToeR_px = Math.hypot(finger_r.x - toe_r.x, finger_r.y - toe_r.y);
      const avgFingerToToe_px = (fingerToToeL_px + fingerToToeR_px) / 2;
      
      if (skeletal_height_px > 0) {
        const wingspanRatio = wingspan_px / skeletal_height_px;
        const fingerToToeRatio = avgFingerToToe_px / skeletal_height_px;
        if (wingspanRatio > 0.83) {
          detectedPose = "T-Pose";
        } else if (fingerToToeRatio > 1.20) {
          detectedPose = "Overhead Reach";
        }
      }
    }
  }

  // Invalidate static image caches to force a full re-calculation with the new scale
  state.lastProcessedScaleFactor = null;
  state.lastCalculatedResults = null;

  // 1. Restore Subject Name & Automatically map to/load matching Profile
  const subjectInput = document.getElementById('subject-name-input');
  if (report.subjectName) {
    if (subjectInput) subjectInput.value = report.subjectName;
    
    // Find matching profile by name (case-insensitive)
    const matchingProfile = state.allProfiles.find(p => p.name.toLowerCase() === report.subjectName.toLowerCase());
    if (matchingProfile) {
      state.activeProfileId = matchingProfile.id;
      // Sync dropdown select element
      const profileSelect = document.getElementById('profile-select');
      if (profileSelect) {
        profileSelect.value = String(matchingProfile.id);
      }
      
      // Update status bar
      const activeProfileName = document.getElementById('active-profile-name');
      if (activeProfileName) activeProfileName.textContent = matchingProfile.name;
      const profileStatusBar = document.getElementById('profile-status-bar');
      if (profileStatusBar) profileStatusBar.classList.remove('hidden');
      const btnDeleteProfile = document.getElementById('btn-delete-profile');
      if (btnDeleteProfile) btnDeleteProfile.classList.remove('hidden');
      
      console.log(`[importPriorPortfolio] Found and automatically matched active profile: ${matchingProfile.name}`);
    }
  }
  const subjectPanel = document.getElementById('subject-profile-panel');
  if (subjectPanel) {
    subjectPanel.classList.remove('hidden');
    subjectPanel.classList.add('visible-flex');
  }

  // 2. Restore Calibration Scale Factor
  if (report.pixelsPerCm && report.pixelsPerCm > 0) {
    state.pixelsPerCm = report.pixelsPerCm;
    state.calLocked = true;
    if (inputPremeasuredScale) {
      inputPremeasuredScale.value = report.pixelsPerCm.toFixed(2);
    }
    if (arucoStatusText) {
      arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-red">${state.pixelsPerCm.toFixed(2)} px/cm</strong>`;
    }
  } else if (report.summary && report.summary.skeletal_height_cm) {
    console.log("[Portfolio Ingest] Report has skeletal height but no scale factor.");
  }

  // 3. Reconstruct Biomechanical Metrics structure
  const mA = report.summary || {};
  const segs = report.segments || {};
  const profs = report.posturalFlexionProfiles || {};

  const activeKneeL = activeCalculated ? activeCalculated.kneeAngleL : null;
  const activeKneeR = activeCalculated ? activeCalculated.kneeAngleR : null;
  const activeHipL = activeCalculated ? activeCalculated.hipAngleL : null;
  const activeHipR = activeCalculated ? activeCalculated.hipAngleR : null;
  const activeElbowL = activeCalculated ? activeCalculated.elbowAngleL : null;
  const activeElbowR = activeCalculated ? activeCalculated.elbowAngleR : null;

  const importedMetrics = {
    pose: activeCalculated?.liveMetrics?.pose || "Combined (Imported)",
    skeletal_height: mA.skeletal_height_cm || report.metrics?.skeletal_height || 175.0,
    wingspan: mA.wingspan_cm || report.metrics?.wingspan || null,
    fingerToToeL: mA.overhead_reach_toe_to_finger_l_cm || report.metrics?.fingerToToeL || null,
    fingerToToeR: mA.overhead_reach_toe_to_finger_r_cm || report.metrics?.fingerToToeR || null,
    thigh_l: segs.thigh_l || report.metrics?.thigh_l || null,
    thigh_r: segs.thigh_r || report.metrics?.thigh_r || null,
    shin_l: segs.shin_l || report.metrics?.shin_l || null,
    shin_r: segs.shin_r || report.metrics?.shin_r || null,
    foot_l: segs.foot_l || report.metrics?.foot_l || null,
    foot_r: segs.foot_r || report.metrics?.foot_r || null,
    torso_l: segs.torso_l || report.metrics?.torso_l || null,
    torso_r: segs.torso_r || report.metrics?.torso_r || null,
    upperarm_l: segs.upperarm_l || report.metrics?.upperarm_l || null,
    upperarm_r: segs.upperarm_r || report.metrics?.upperarm_r || null,
    forearm_l: segs.forearm_l || report.metrics?.forearm_l || null,
    forearm_r: segs.forearm_r || report.metrics?.forearm_r || null,
    hipW: report.metrics?.hipW || null,
    
    // Live displayed angles must always represent the active image/pose if available
    kneeAngleL: (activeKneeL !== null && activeKneeL !== undefined) ? activeKneeL : (profs.aPose?.kneeL || report.metrics?.kneeAngleL || report.metrics?.anglesA?.kneeAngleL || 180),
    kneeAngleR: (activeKneeR !== null && activeKneeR !== undefined) ? activeKneeR : (profs.aPose?.kneeR || report.metrics?.kneeAngleR || report.metrics?.anglesA?.kneeAngleR || 180),
    hipAngleL: (activeHipL !== null && activeHipL !== undefined) ? activeHipL : (profs.aPose?.hipL || report.metrics?.hipAngleL || report.metrics?.anglesA?.hipAngleL || 180),
    hipAngleR: (activeHipR !== null && activeHipR !== undefined) ? activeHipR : (profs.aPose?.hipR || report.metrics?.hipAngleR || report.metrics?.anglesA?.hipAngleR || 180),
    elbowAngleL: (activeElbowL !== null && activeElbowL !== undefined) ? activeElbowL : (profs.aPose?.elbowL || report.metrics?.elbowAngleL || report.metrics?.anglesA?.elbowAngleL || 180),
    elbowAngleR: (activeElbowR !== null && activeElbowR !== undefined) ? activeElbowR : (profs.aPose?.elbowR || report.metrics?.elbowAngleR || report.metrics?.anglesA?.elbowAngleR || 180),
  };

  // 4. Save to controller's cache state for re-rendering or re-compiling
  state.metricsA = {
    pose: "A-Pose",
    skeletal_height: importedMetrics.skeletal_height,
    wingspan: importedMetrics.wingspan,
    fingerToToeL: importedMetrics.fingerToToeL,
    fingerToToeR: importedMetrics.fingerToToeR,
    thigh_l: importedMetrics.thigh_l,
    thigh_r: importedMetrics.thigh_r,
    shin_l: importedMetrics.shin_l,
    shin_r: importedMetrics.shin_r,
    foot_l: importedMetrics.foot_l,
    foot_r: importedMetrics.foot_r,
    torso_l: importedMetrics.torso_l,
    torso_r: importedMetrics.torso_r,
    upperarm_l: importedMetrics.upperarm_l,
    upperarm_r: importedMetrics.upperarm_r,
    forearm_l: importedMetrics.forearm_l,
    forearm_r: importedMetrics.forearm_r,
    hipW: importedMetrics.hipW,
    
    kneeAngleL: (detectedPose === "A-Pose" && activeKneeL !== null && activeKneeL !== undefined) ? activeKneeL : (profs.aPose?.kneeL || report.metrics?.kneeAngleL || report.metrics?.anglesA?.kneeAngleL || 180),
    kneeAngleR: (detectedPose === "A-Pose" && activeKneeR !== null && activeKneeR !== undefined) ? activeKneeR : (profs.aPose?.kneeR || report.metrics?.kneeAngleR || report.metrics?.anglesA?.kneeAngleR || 180),
    hipAngleL: (detectedPose === "A-Pose" && activeHipL !== null && activeHipL !== undefined) ? activeHipL : (profs.aPose?.hipL || report.metrics?.hipAngleL || report.metrics?.anglesA?.hipAngleL || 180),
    hipAngleR: (detectedPose === "A-Pose" && activeHipR !== null && activeHipR !== undefined) ? activeHipR : (profs.aPose?.hipR || report.metrics?.hipAngleR || report.metrics?.anglesA?.hipAngleR || 180),
    elbowAngleL: (detectedPose === "A-Pose" && activeElbowL !== null && activeElbowL !== undefined) ? activeElbowL : (profs.aPose?.elbowL || report.metrics?.elbowAngleL || report.metrics?.anglesA?.elbowAngleL || 180),
    elbowAngleR: (detectedPose === "A-Pose" && activeElbowR !== null && activeElbowR !== undefined) ? activeElbowR : (profs.aPose?.elbowR || report.metrics?.elbowAngleR || report.metrics?.anglesA?.elbowAngleR || 180),
  };

  const rT = report.anglesT || report.metrics?.anglesT || {};
  const rO = report.anglesOverhead || report.metrics?.anglesOverhead || {};

  state.metricsT = {
    wingspan: importedMetrics.wingspan,
    thigh_l: (rT.thigh_l !== undefined && rT.thigh_l !== null) ? rT.thigh_l : importedMetrics.thigh_l,
    thigh_r: (rT.thigh_r !== undefined && rT.thigh_r !== null) ? rT.thigh_r : importedMetrics.thigh_r,
    shin_l: (rT.shin_l !== undefined && rT.shin_l !== null) ? rT.shin_l : importedMetrics.shin_l,
    shin_r: (rT.shin_r !== undefined && rT.shin_r !== null) ? rT.shin_r : importedMetrics.shin_r,
    foot_l: (rT.foot_l !== undefined && rT.foot_l !== null) ? rT.foot_l : importedMetrics.foot_l,
    foot_r: (rT.foot_r !== undefined && rT.foot_r !== null) ? rT.foot_r : importedMetrics.foot_r,
    torso_l: (rT.torso_l !== undefined && rT.torso_l !== null) ? rT.torso_l : importedMetrics.torso_l,
    torso_r: (rT.torso_r !== undefined && rT.torso_r !== null) ? rT.torso_r : importedMetrics.torso_r,
    upperarm_l: (rT.upperarm_l !== undefined && rT.upperarm_l !== null) ? rT.upperarm_l : importedMetrics.upperarm_l,
    upperarm_r: (rT.upperarm_r !== undefined && rT.upperarm_r !== null) ? rT.upperarm_r : importedMetrics.upperarm_r,
    forearm_l: (rT.forearm_l !== undefined && rT.forearm_l !== null) ? rT.forearm_l : importedMetrics.forearm_l,
    forearm_r: (rT.forearm_r !== undefined && rT.forearm_r !== null) ? rT.forearm_r : importedMetrics.forearm_r,
    hipW: (rT.hipW !== undefined && rT.hipW !== null) ? rT.hipW : importedMetrics.hipW,
    
    kneeAngleL: (detectedPose === "T-Pose" && activeKneeL !== null && activeKneeL !== undefined) ? activeKneeL : (profs.tPose?.kneeL || report.metrics?.anglesT?.kneeAngleL || rT.kneeAngleL || 180),
    kneeAngleR: (detectedPose === "T-Pose" && activeKneeR !== null && activeKneeR !== undefined) ? activeKneeR : (profs.tPose?.kneeR || report.metrics?.anglesT?.kneeAngleR || rT.kneeAngleR || 180),
    hipAngleL: (detectedPose === "T-Pose" && activeHipL !== null && activeHipL !== undefined) ? activeHipL : (profs.tPose?.hipL || report.metrics?.anglesT?.hipAngleL || rT.hipAngleL || 180),
    hipAngleR: (detectedPose === "T-Pose" && activeHipR !== null && activeHipR !== undefined) ? activeHipR : (profs.tPose?.hipR || report.metrics?.anglesT?.hipAngleR || rT.hipAngleR || 180),
    elbowAngleL: (detectedPose === "T-Pose" && activeElbowL !== null && activeElbowL !== undefined) ? activeElbowL : (profs.tPose?.elbowL || report.metrics?.anglesT?.elbowAngleL || rT.elbowAngleL || 180),
    elbowAngleR: (detectedPose === "T-Pose" && activeElbowR !== null && activeElbowR !== undefined) ? activeElbowR : (profs.tPose?.elbowR || report.metrics?.anglesT?.elbowAngleR || rT.elbowAngleR || 180),
  };

  state.metricsOverhead = {
    fingerToToeL: importedMetrics.fingerToToeL,
    fingerToToeR: importedMetrics.fingerToToeR,
    thigh_l: (rO.thigh_l !== undefined && rO.thigh_l !== null) ? rO.thigh_l : importedMetrics.thigh_l,
    thigh_r: (rO.thigh_r !== undefined && rO.thigh_r !== null) ? rO.thigh_r : importedMetrics.thigh_r,
    shin_l: (rO.shin_l !== undefined && rO.shin_l !== null) ? rO.shin_l : importedMetrics.shin_l,
    shin_r: (rO.shin_r !== undefined && rO.shin_r !== null) ? rO.shin_r : importedMetrics.shin_r,
    foot_l: (rO.foot_l !== undefined && rO.foot_l !== null) ? rO.foot_l : importedMetrics.foot_l,
    foot_r: (rO.foot_r !== undefined && rO.foot_r !== null) ? rO.foot_r : importedMetrics.foot_r,
    torso_l: (rO.torso_l !== undefined && rO.torso_l !== null) ? rO.torso_l : importedMetrics.torso_l,
    torso_r: (rO.torso_r !== undefined && rO.torso_r !== null) ? rO.torso_r : importedMetrics.torso_r,
    upperarm_l: (rO.upperarm_l !== undefined && rO.upperarm_l !== null) ? rO.upperarm_l : importedMetrics.upperarm_l,
    upperarm_r: (rO.upperarm_r !== undefined && rO.upperarm_r !== null) ? rO.upperarm_r : importedMetrics.upperarm_r,
    forearm_l: (rO.forearm_l !== undefined && rO.forearm_l !== null) ? rO.forearm_l : importedMetrics.forearm_l,
    forearm_r: (rO.forearm_r !== undefined && rO.forearm_r !== null) ? rO.forearm_r : importedMetrics.forearm_r,
    hipW: (rO.hipW !== undefined && rO.hipW !== null) ? rO.hipW : importedMetrics.hipW,

    kneeAngleL: (detectedPose === "Overhead Reach" && activeKneeL !== null && activeKneeL !== undefined) ? activeKneeL : (profs.overhead?.kneeL || report.metrics?.anglesOverhead?.kneeAngleL || rO.kneeAngleL || 180),
    kneeAngleR: (detectedPose === "Overhead Reach" && activeKneeR !== null && activeKneeR !== undefined) ? activeKneeR : (profs.overhead?.kneeR || report.metrics?.anglesOverhead?.kneeAngleR || rO.kneeAngleR || 180),
    hipAngleL: (detectedPose === "Overhead Reach" && activeHipL !== null && activeHipL !== undefined) ? activeHipL : (profs.overhead?.hipL || report.metrics?.anglesOverhead?.hipAngleL || rO.hipAngleL || 180),
    hipAngleR: (detectedPose === "Overhead Reach" && activeHipR !== null && activeHipR !== undefined) ? activeHipR : (profs.overhead?.hipR || report.metrics?.anglesOverhead?.hipAngleR || rO.hipAngleR || 180),
    elbowAngleL: (detectedPose === "Overhead Reach" && activeElbowL !== null && activeElbowL !== undefined) ? activeElbowL : (profs.overhead?.elbowL || report.metrics?.anglesOverhead?.elbowAngleL || rO.elbowAngleL || 180),
    elbowAngleR: (detectedPose === "Overhead Reach" && activeElbowR !== null && activeElbowR !== undefined) ? activeElbowR : (profs.overhead?.elbowR || report.metrics?.anglesOverhead?.elbowAngleR || rO.elbowAngleR || 180),
  };

  // Save to persistent state for live/image tracking overrides
  state.importedPortfolioMetrics = importedMetrics;

  // Re-render dashboard metrics instantly!
  renderDashboard(importedMetrics);

  // 5. Construct persistent database snapshotRecord for IndexedDB gallery registration
  const timestamp = report.timestamp || Date.now();
  const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', options);
  
  const subjectNameLabel = report.subjectName || "Anonymous";
  const label = `${subjectNameLabel} - Imported Session - ${dateStr}`;

  const consolidatedMetrics = {
    pose: "Combined",
    isCombinedSession: true,
    skeletal_height: importedMetrics.skeletal_height,
    wingspan: importedMetrics.wingspan,
    fingerToToeL: importedMetrics.fingerToToeL,
    fingerToToeR: importedMetrics.fingerToToeR,
    thigh_l: importedMetrics.thigh_l,
    thigh_r: importedMetrics.thigh_r,
    shin_l: importedMetrics.shin_l,
    shin_r: importedMetrics.shin_r,
    foot_l: importedMetrics.foot_l,
    foot_r: importedMetrics.foot_r,
    torso_l: importedMetrics.torso_l,
    torso_r: importedMetrics.torso_r,
    upperarm_l: importedMetrics.upperarm_l,
    upperarm_r: importedMetrics.upperarm_r,
    forearm_l: importedMetrics.forearm_l,
    forearm_r: importedMetrics.forearm_r,
    hipW: importedMetrics.hipW,
    anglesA: state.metricsA,
    anglesT: state.metricsT,
    anglesOverhead: state.metricsOverhead
  };

  const snapshotRecord = {
    name: label,
    timestamp: timestamp,
    isCombinedSession: true,
    imageA: null, // No image in JSON, but standard placeholder can render
    imageT: null,
    imageOverhead: null,
    image: null, 
    metrics: consolidatedMetrics
  };

  if (state.dbInitialized) {
    snapshotStore.save(snapshotRecord)
      .then(() => {
        console.log(`[Import] Saved imported session "${label}" to IndexedDB gallery.`);
        renderGallery();
        statusElement.textContent = `Portfolio imported successfully! Saved "${label}" in session snapshot history.`;
      })
      .catch(err => {
        console.error("[Import] Failed to save imported snapshot to IndexedDB:", err);
        statusElement.textContent = "Portfolio imported to dashboard, but saving to gallery database failed.";
      });
  } else {
    statusElement.textContent = "Portfolio imported successfully to live dashboard (IndexedDB inactive).";
  }

  // Clear inputs on success
  if (textareaPortfolioJson) {
    textareaPortfolioJson.value = "";
  }

  // If a profile is active, sync the imported metrics to the database
  if (state.activeProfileId) {
    autoSyncToActiveProfile();
  }

  // High-end feedback animation on Import button
  if (btnImportPortfolio) {
    btnImportPortfolio.classList.add('btn-success-glow');
    btnImportPortfolio.textContent = "Session Imported Successfully! ✅";
    setTimeout(() => {
      btnImportPortfolio.classList.remove('btn-success-glow');
      btnImportPortfolio.textContent = "Import Prior Portfolio";
    }, 2000);
  }
}

if (tabValidationBtn) {
  tabValidationBtn.addEventListener('click', () => {
    switchCalibrationTab('validation', tabValidationBtn, panelValidation);
  });
}

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
      arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
    }
    const validationStatusText = document.getElementById('validation-status-text');
    if (validationStatusText && state.activeCalMethod === 'validation') {
      validationStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
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
    inputCal.value = parseFloat(newVal.toFixed(3));
  }
  if (inputVal && parseFloat(inputVal.value) !== newVal) {
    inputVal.value = parseFloat(newVal.toFixed(3));
  }

  // Adjust cached pixelsPerCm immediately if it exists
  if (state.wallPerspectiveEnabled && state.pixelsPerCm && oldVal > 0) {
    state.pixelsPerCm = (state.pixelsPerCm / oldVal) * newVal;

    // Update UI status texts
    const arucoStatusText = document.getElementById('aruco-status-text');
    if (arucoStatusText && state.activeCalMethod === 'aruco') {
      arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
    }
    const validationStatusText = document.getElementById('validation-status-text');
    if (validationStatusText && state.activeCalMethod === 'validation') {
      validationStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong class="text-red">${state.pixelsPerCm.toFixed(1)} px/cm</strong>`;
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

if (wallPerspectiveInput) wallPerspectiveInput.value = parseFloat(state.wallPerspectiveFactor.toFixed(3));
if (wallPerspectiveInputValidation) wallPerspectiveInputValidation.value = parseFloat(state.wallPerspectiveFactor.toFixed(3));

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
    e.target.value = parseFloat(val.toFixed(3));
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
    e.target.value = parseFloat(val.toFixed(3));
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

// ==========================================
// OFFLINE DASHBOARD PLACEHOLDERS
// ==========================================

export function updateSquatDashboardOffline() {
  if (squatLiveKneeL) squatLiveKneeL.textContent = '--°';
  if (squatLiveKneeR) squatLiveKneeR.textContent = '--°';
  if (squatLiveHipL) squatLiveHipL.textContent = '--°';
  if (squatLiveHipR) squatLiveHipR.textContent = '--°';
  if (squatLiveAnkleL) squatLiveAnkleL.textContent = '--°';
  if (squatLiveAnkleR) squatLiveAnkleR.textContent = '--°';

  if (squatStatusVal) {
    squatStatusVal.textContent = 'Awaiting Subject';
    squatStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    squatStatusVal.classList.add('text-slate');
  }
}

export function updateSquatSideUI() {
  const side = state.squatTestingSide || 'left';
  
  if (btnSquatSideLeft && btnSquatSideRight) {
    if (side === 'left') {
      btnSquatSideLeft.classList.add('active-left');
      btnSquatSideRight.classList.remove('active-right');
    } else {
      btnSquatSideRight.classList.add('active-right');
      btnSquatSideLeft.classList.remove('active-left');
    }
  }

  const angleBoxes = document.querySelectorAll('#squat-sidebar-content .angle-box');
  angleBoxes.forEach(box => {
    if (side === 'left') {
      if (box.classList.contains('left-border')) {
        box.classList.add('active-left');
        box.classList.remove('inactive-side');
      } else if (box.classList.contains('right-border')) {
        box.classList.add('inactive-side');
        box.classList.remove('active-right');
      }
    } else {
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

export function updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR) {
  // Update live monitors
  if (squatLiveKneeL) squatLiveKneeL.textContent = `${kneeMobL}°`;
  if (squatLiveKneeR) squatLiveKneeR.textContent = `${kneeMobR}°`;
  if (squatLiveHipL) squatLiveHipL.textContent = `${hipMobL}°`;
  if (squatLiveHipR) squatLiveHipR.textContent = `${hipMobR}°`;
  if (squatLiveAnkleL) squatLiveAnkleL.textContent = `${ankleMobL}°`;
  if (squatLiveAnkleR) squatLiveAnkleR.textContent = `${ankleMobR}°`;

  const prevPeaks = JSON.stringify(state.squatPeaks);

  // Compare and update peak recorded values in state based on selected testing side
  if (state.squatTestingSide === 'left') {
    state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
    state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
    state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
  } else {
    state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
    state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
    state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
  }

  if (state.activeProfileId && JSON.stringify(state.squatPeaks) !== prevPeaks) {
    autoSyncToActiveProfileDebounced();
  }

  // Update peak elements in DOM
  if (squatPeakKneeL) squatPeakKneeL.textContent = `${state.squatPeaks.kneeL}°`;
  if (squatPeakKneeR) squatPeakKneeR.textContent = `${state.squatPeaks.kneeR}°`;
  if (squatPeakHipL) squatPeakHipL.textContent = `${state.squatPeaks.hipL}°`;
  if (squatPeakHipR) squatPeakHipR.textContent = `${state.squatPeaks.hipR}°`;
  if (squatPeakAnkleL) squatPeakAnkleL.textContent = `${state.squatPeaks.ankleL}°`;
  if (squatPeakAnkleR) squatPeakAnkleR.textContent = `${state.squatPeaks.ankleR}°`;

  // Determine active movement-depth categorization based on the deepest tracked knee
  const maxKneeMob = Math.max(kneeMobL, kneeMobR);
  let depthStatus = "Standing Upright";
  let statusClass = "text-slate";

  if (maxKneeMob >= 110) {
    depthStatus = "Deep Squat";
    statusClass = "text-emerald";
  } else if (maxKneeMob >= 75) {
    depthStatus = "Parallel Squat";
    statusClass = "text-red";
  } else if (maxKneeMob >= 30) {
    depthStatus = "Partial Squat";
    statusClass = "text-amber";
  } else {
    depthStatus = "Standing Upright";
    statusClass = "text-slate";
  }

  if (squatStatusVal) {
    squatStatusVal.textContent = depthStatus;
    squatStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    squatStatusVal.classList.add(statusClass);
  }
}

export function resetSquatPeaks() {
  state.squatPeaks = {
    kneeL: 0,
    kneeR: 0,
    hipL: 0,
    hipR: 0,
    ankleL: 0,
    ankleR: 0
  };

  if (state.activeProfileId) {
    autoSyncToActiveProfile();
  }

  if (squatPeakKneeL) squatPeakKneeL.textContent = '0°';
  if (squatPeakKneeR) squatPeakKneeR.textContent = '0°';
  if (squatPeakHipL) squatPeakHipL.textContent = '0°';
  if (squatPeakHipR) squatPeakHipR.textContent = '0°';
  if (squatPeakAnkleL) squatPeakAnkleL.textContent = '0°';
  if (squatPeakAnkleR) squatPeakAnkleR.textContent = '0°';

  // Recalculate and redraw current frame if pose results are active
  if (state.latestPoseResults) {
    onPoseResults(state.latestPoseResults);
  }
}

export function updateDashboardOfflinePlaceholders() {
  if (state.isSnapshotFrozen && state.frozenMetrics) {
    renderDashboard(state.frozenMetrics);
    return;
  }
  
  if (state.activeStream || (state.isUploadedMedia && state.latestPoseResults)) {
    if (state.frozenMetrics) {
      renderDashboard(state.frozenMetrics);
    }
    return; 
  }

  // Handle Squat Dashboard offline state reset
  updateSquatDashboardOffline();

  const suffix = state.useInches ? "inches" : "cm";
  const place = `--.- ${suffix}`;

  SEGMENT_METRICS.forEach(m => {
    if (m.element) m.element.textContent = place;
  });
  
  if (fingerToToeDisp) {
    fingerToToeDisp.textContent = `L: ${place} / R: ${place}`;
  }
  hipWDisp.textContent = place;
  if (wingspanDisp) {
    wingspanDisp.textContent = place;
  }
  
  if (state.useInches) {
    heightCmDisp.textContent = `-'- -"`;
    heightFtDisp.textContent = `--.- cm (Stature)`;
  } else {
    heightCmDisp.textContent = `--.- cm`;
    heightFtDisp.textContent = `-'- -" (Stature)`;
  }
  
  ANGLE_METRICS.forEach(m => {
    if (m.element) m.element.textContent = `--°`;
  });
}

// BIND OVERHEAD SQUAT INTERFACE LISTENERS
if (btnModePosture) {
  btnModePosture.addEventListener('click', () => {
    state.currentMode = 'posture';
    btnModePosture.classList.add('active');
    if (btnModeSquat) btnModeSquat.classList.remove('active');
    
    if (postureSidebarContent) postureSidebarContent.classList.remove('hidden');
    if (squatSidebarContent) squatSidebarContent.classList.add('hidden');
    
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateDashboardOfflinePlaceholders();
    }
  });
}

if (btnModeSquat) {
  btnModeSquat.addEventListener('click', () => {
    state.currentMode = 'squat';
    btnModeSquat.classList.add('active');
    if (btnModePosture) btnModePosture.classList.remove('active');
    
    if (squatSidebarContent) squatSidebarContent.classList.remove('hidden');
    if (postureSidebarContent) postureSidebarContent.classList.add('hidden');
    
    updateSquatSideUI(); // Ensure side selector states are active on sidebar open

    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateSquatDashboardOffline();
    }
  });
}

// Wire up Testing Side selector buttons
if (btnSquatSideLeft) {
  btnSquatSideLeft.addEventListener('click', () => {
    state.squatTestingSide = 'left';
    updateSquatSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}
if (btnSquatSideRight) {
  btnSquatSideRight.addEventListener('click', () => {
    state.squatTestingSide = 'right';
    updateSquatSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}

// Initial UI sync for squat side selector (runs immediately upon controller load)
setTimeout(() => {
  updateSquatSideUI();
}, 200);

const btnResetPeaks = document.getElementById('btn-reset-peaks');
if (btnResetPeaks) {
  btnResetPeaks.addEventListener('click', resetSquatPeaks);
}

const btnSaveSquatPeaks = document.getElementById('btn-save-squat-peaks');
if (btnSaveSquatPeaks) {
  btnSaveSquatPeaks.addEventListener('click', async () => {
    // 1. Validation check for non-zero squat peaks
    const peaks = state.squatPeaks;
    if (!peaks || (peaks.kneeL === 0 && peaks.kneeR === 0 && peaks.hipL === 0 && peaks.hipR === 0 && peaks.ankleL === 0 && peaks.ankleR === 0)) {
      alert("No peak mobility metrics recorded yet. Please perform an overhead squat test first!");
      return;
    }

    // 2. Identify active subject or Guest Mode
    let activeProfileName = "Guest";
    if (state.activeProfileId) {
      try {
        const profile = await snapshotStore.getProfile(state.activeProfileId);
        if (profile) {
          activeProfileName = profile.name;
        }
      } catch (err) {
        console.error("Error fetching active profile for peak saving:", err);
      }
    }

    const label = state.activeProfileId ? `${activeProfileName} - Mobility Peaks` : "Guest - Mobility Peaks";

    // 3. Construct persistent database snapshotRecord for IndexedDB gallery registration
    const snapshotRecord = {
      name: label,
      timestamp: Date.now(),
      image: canvasElement.toDataURL('image/png'),
      metrics: {
        isSquatMobility: true,
        squatPeaks: JSON.parse(JSON.stringify(state.squatPeaks))
      }
    };

    try {
      // 4. If we have an active profile, sync these peaks directly to their portfolio record (skipping general gallery)
      if (state.activeProfileId) {
        const capturedImg = canvasElement.toDataURL('image/png');
        if (state.squatTestingSide === 'left') {
          state.imageSquatL = capturedImg;
        } else {
          state.imageSquatR = capturedImg;
        }
        await autoSyncToActiveProfile();
        
        if (statusElement) {
          statusElement.textContent = `💾 Peak mobility metrics for "${label}" successfully saved to portfolio!`;
        }
      } else {
        // 5. Save standalone isSquatMobility snapshot to IndexedDB gallery (Guest Mode)
        await snapshotStore.save(snapshotRecord);
        if (statusElement) {
          statusElement.textContent = `💾 Standalone peak mobility snapshot successfully saved to gallery!`;
        }
        alert("You are currently in Guest Mode. The peak mobility scores have been saved as a standalone snapshot in your offline Gallery, but NOT in a player portfolio. To save these scores to a player portfolio, please select or create a profile first, then click Save Peaks to Portfolio again.");
        
        // Redraw the gallery only when saved standalone to gallery (Guest Mode)
        renderGallery();
      }
    } catch (err) {
      console.error("Failed to save squat peak snapshot to IndexedDB:", err);
      alert("Could not save squat peaks snapshot. See developer console for errors.");
    }
  });
}

// Initial placeholder update
setTimeout(() => {
  updateDashboardOfflinePlaceholders();
}, 200);

// ==========================================================================
// CUSTOM INTERACTIVE VIDEO CONTROLLER LOGIC (BUCKEYES GLASSMORPHIC THEME)
// ==========================================================================

const PLAY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const PAUSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

state.isUserDraggingSeekbar = false;
let isSeekingInferenceRunning = false;
let pendingInferenceRequest = false;

// Format seconds into MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Update playbar position and clock timer text
function updateVideoControlsUI() {
  if (!uploadedVideo || !videoSeekbar || !videoTimeDisplay) return;
  const current = uploadedVideo.currentTime;
  const duration = uploadedVideo.duration || 0;
  
  if (!state.isUserDraggingSeekbar) {
    if (duration > 0) {
      videoSeekbar.value = (current / duration) * 100;
    } else {
      videoSeekbar.value = 0;
    }
  }
  
  videoTimeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
}

// Throttled frame-by-frame inference for manual seeking & video scrubbing on pause
async function renderSingleVideoFrame() {
  if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || !uploadedVideo) return;
  
  if (isSeekingInferenceRunning) {
    pendingInferenceRequest = true;
    return;
  }
  
  isSeekingInferenceRunning = true;
  pendingInferenceRequest = false;
  
  try {
    // Run computer-vision models sequentially to avoid Emscripten memory allocation collisions
    await pose.send({ image: uploadedVideo });
    await hands.send({ image: uploadedVideo });
    
    // Refresh canvas overlays & telemetry tables instantly
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
    if (state.latestHandResults && drawHandMesh) {
      drawHandMesh(state.latestHandResults.multiHandLandmarks, state.latestHandResults.multiHandedness);
    }
  } catch (err) {
    console.error("[RealtimeSeek] Stopped CV Frame Render Error:", err);
  } finally {
    isSeekingInferenceRunning = false;
    // If another seek happened while we were computing, run inference for the newest frame now
    if (pendingInferenceRequest) {
      renderSingleVideoFrame();
    }
  }
}

// Set up video controls event bindings
if (uploadedVideo) {
  // Sync button icons on play/pause events
  uploadedVideo.addEventListener('play', () => {
    if (videoPlayPauseBtn) videoPlayPauseBtn.innerHTML = PAUSE_SVG;
  });

  uploadedVideo.addEventListener('pause', () => {
    if (videoPlayPauseBtn) videoPlayPauseBtn.innerHTML = PLAY_SVG;
  });

  // Track progress updates
  uploadedVideo.addEventListener('timeupdate', () => {
    updateVideoControlsUI();
  });

  uploadedVideo.addEventListener('durationchange', () => {
    updateVideoControlsUI();
  });

  // Real-time CV update when seeked on pause
  uploadedVideo.addEventListener('seeked', () => {
    // Prevent triggering single-frame inference during frame-by-frame preprocessing or active recording playout to avoid concurrent WASM model collisions
    if (uploadedVideo.paused && !state.isExportingFrameByFrame && !state.isRecordingPlayLoop && !state.isRecording) {
      renderSingleVideoFrame();
    }
  });
}

// Play/Pause button click handler
if (videoPlayPauseBtn) {
  videoPlayPauseBtn.addEventListener('click', () => {
    if (!uploadedVideo) return;
    if (uploadedVideo.paused) {
      uploadedVideo.play().catch(err => console.error(err));
    } else {
      uploadedVideo.pause();
    }
  });
}

// Seekbar drag seeking event handlers
if (videoSeekbar) {
  videoSeekbar.addEventListener('input', (e) => {
    if (!uploadedVideo) return;
    state.isUserDraggingSeekbar = true;
    
    const pct = parseFloat(e.target.value) / 100;
    const duration = uploadedVideo.duration || 0;
    uploadedVideo.currentTime = pct * duration;
    
    if (videoTimeDisplay) {
      videoTimeDisplay.textContent = `${formatTime(uploadedVideo.currentTime)} / ${formatTime(duration)}`;
    }
  });

  videoSeekbar.addEventListener('change', () => {
    state.isUserDraggingSeekbar = false;
  });
}

// Playback speed cycle selector button
const SPEED_STEPS = [0.5, 1.0, 1.5, 2.0];
if (videoSpeedBtn) {
  videoSpeedBtn.addEventListener('click', () => {
    if (!uploadedVideo) return;
    const currentRate = uploadedVideo.playbackRate;
    
    // Cycle to next speed step in array
    let nextIdx = 0;
    for (let i = 0; i < SPEED_STEPS.length; i++) {
      if (Math.abs(currentRate - SPEED_STEPS[i]) < 0.1) {
        nextIdx = (i + 1) % SPEED_STEPS.length;
        break;
      }
    }
    
    const nextRate = SPEED_STEPS[nextIdx];
    uploadedVideo.playbackRate = nextRate;
    videoSpeedBtn.textContent = `${nextRate.toFixed(1)}x`;
  });
}

// ==========================================
// BUCKEYE PERSISTENT SUBJECT PROFILES CONTROLLER
// ==========================================

export function getActiveProfileName(includeFallback = true) {
  if (state.activeProfileId && state.allProfiles) {
    const activeProfile = state.allProfiles.find(p => p.id === state.activeProfileId);
    if (activeProfile) {
      return activeProfile.name;
    }
  }
  const subjectInput = document.getElementById('subject-name-input');
  if (subjectInput && subjectInput.value.trim()) {
    return subjectInput.value.trim();
  }
  return includeFallback ? "Guest Mode" : "";
}

export async function initializeProfilesSelector() {
  const profileSelect = document.getElementById('profile-select');
  const calProfileSelect = document.getElementById('cal-profile-select');
  const profileSearchInput = document.getElementById('profile-search-input');
  const btnSaveProfile = document.getElementById('btn-save-profile');
  const subjectNameInput = document.getElementById('subject-name-input');
  const btnDeleteProfile = document.getElementById('btn-delete-profile');
  const profileStatusBar = document.getElementById('profile-status-bar');
  const newProfileInputContainer = document.getElementById('new-profile-input-container');

  const profileActionRow = document.getElementById('profile-action-row');
  const btnViewProfileDetails = document.getElementById('btn-view-profile-details');
  const profileDetailsModal = document.getElementById('profile-details-modal');
  const btnCloseProfileDetails = document.getElementById('btn-close-profile-details');
  const btnCloseProfileDetailsFooter = document.getElementById('btn-close-profile-details-footer');
  const btnProfileExportJson = document.getElementById('btn-profile-export-json');

  if (!profileSelect) return;

  function populateDropdown(filteredProfiles) {
    const currentSelected = profileSelect.value;
    profileSelect.innerHTML = '';
    
    const guestOpt = document.createElement('option');
    guestOpt.value = '';
    guestOpt.textContent = '-- Guest Session (Unsaved) --';
    profileSelect.appendChild(guestOpt);

    if (calProfileSelect) {
      calProfileSelect.innerHTML = '';
      const calGuestOpt = document.createElement('option');
      calGuestOpt.value = '';
      calGuestOpt.textContent = '-- Guest Session (Unsaved) --';
      calProfileSelect.appendChild(calGuestOpt);
    }
    
    filteredProfiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      profileSelect.appendChild(opt);

      if (calProfileSelect) {
        const calOpt = document.createElement('option');
        calOpt.value = p.id;
        calOpt.textContent = p.name;
        calProfileSelect.appendChild(calOpt);
      }
    });
    
    const createOpt = document.createElement('option');
    createOpt.value = 'new';
    createOpt.textContent = '+ Create New Profile...';
    profileSelect.appendChild(createOpt);

    if (currentSelected && [...profileSelect.options].some(o => o.value === currentSelected)) {
      profileSelect.value = currentSelected;
    } else {
      profileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
    }

    if (calProfileSelect) {
      calProfileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
    }
  }

  try {
    state.allProfiles = await snapshotStore.getAllProfiles();
    populateDropdown(state.allProfiles);
    if (state.activeProfileId) {
      if (profileActionRow) profileActionRow.classList.remove('hidden');
    } else {
      if (profileActionRow) profileActionRow.classList.add('hidden');
    }
  } catch (err) {
    console.error("[initializeProfilesSelector] Failed to load initial profiles:", err);
  }

  if (profileSearchInput) {
    profileSearchInput.addEventListener('input', () => {
      const searchVal = profileSearchInput.value.toLowerCase().trim();
      const filtered = state.allProfiles.filter(p => p.name.toLowerCase().includes(searchVal));
      populateDropdown(filtered);
    });
  }

  const handleProfileChange = async (selectedVal) => {
    if (selectedVal === 'new') {
      if (profileSelect) profileSelect.value = 'new';
      if (calProfileSelect) calProfileSelect.value = '';
      if (newProfileInputContainer) {
        newProfileInputContainer.classList.remove('hidden');
        newProfileInputContainer.classList.add('visible-flex');
      }
      if (profileStatusBar) profileStatusBar.classList.add('hidden');
      if (btnDeleteProfile) btnDeleteProfile.classList.add('hidden');
      if (profileActionRow) profileActionRow.classList.add('hidden');
    } else if (selectedVal === '') {
      if (profileSelect) profileSelect.value = '';
      if (calProfileSelect) calProfileSelect.value = '';

      // Cleanly reset Guest state caches
      state.activeProfileId = null;
      state.metricsA = null;
      state.metricsT = null;
      state.metricsOverhead = null;
      state.imageA = null;
      state.imageT = null;
      state.imageOverhead = null;
      state.importedPortfolioMetrics = null;
      state.pixelsPerCm = null;
      state.calLocked = false;
      state.squatPeaks = { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };

      updateDashboardOfflinePlaceholders();

      if (newProfileInputContainer) {
        newProfileInputContainer.classList.add('hidden');
        newProfileInputContainer.classList.remove('visible-flex');
      }
      if (profileStatusBar) {
        const activeProfileName = document.getElementById('active-profile-name');
        if (activeProfileName) activeProfileName.textContent = 'Guest Mode';
        profileStatusBar.classList.add('hidden');
      }
      if (btnDeleteProfile) btnDeleteProfile.classList.add('hidden');
      if (profileActionRow) profileActionRow.classList.add('hidden');
      
      const arucoStatusText = document.getElementById('aruco-status-text');
      if (arucoStatusText) {
        arucoStatusText.innerHTML = `🔍 Scanning for Reference ArUco (200mm)...`;
      }
    } else {
      if (profileSelect) profileSelect.value = selectedVal;
      if (calProfileSelect) calProfileSelect.value = selectedVal;

      if (newProfileInputContainer) {
        newProfileInputContainer.classList.add('hidden');
        newProfileInputContainer.classList.remove('visible-flex');
      }
      await loadProfileIntoState(Number(selectedVal));
    }
  };

  profileSelect.addEventListener('change', () => handleProfileChange(profileSelect.value));
  if (calProfileSelect) {
    calProfileSelect.addEventListener('change', () => handleProfileChange(calProfileSelect.value));
  }

  if (btnSaveProfile) {
    btnSaveProfile.addEventListener('click', async () => {
      if (!subjectNameInput) return;
      const nameVal = subjectNameInput.value.trim();
      if (!nameVal) {
        alert("Please enter a subject name to create a profile.");
        return;
      }

      const isDuplicate = state.allProfiles.some(p => p.name.toLowerCase() === nameVal.toLowerCase());
      if (isDuplicate) {
        alert(`A profile named "${nameVal}" already exists. Please choose a different name.`);
        return;
      }

      const newProfile = {
        name: nameVal,
        timestamp: Date.now(),
        metricsA: null,
        metricsT: null,
        metricsOverhead: null,
        squatPeaks: { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 },
        imageA: null,
        imageT: null,
        imageOverhead: null,
        pixelsPerCm: null
      };

      try {
        const newId = await snapshotStore.saveProfile(newProfile);
        state.activeProfileId = newId;
        state.allProfiles = await snapshotStore.getAllProfiles();
        
        if (profileSearchInput) profileSearchInput.value = '';
        
        populateDropdown(state.allProfiles);
        profileSelect.value = String(newId);
        if (calProfileSelect) calProfileSelect.value = String(newId);
        
        if (newProfileInputContainer) {
          newProfileInputContainer.classList.add('hidden');
          newProfileInputContainer.classList.remove('visible-flex');
        }
        subjectNameInput.value = '';

        await loadProfileIntoState(newId);
        statusElement.textContent = `✅ Profile "${nameVal}" created successfully!`;
      } catch (err) {
        console.error("[initializeProfilesSelector] Failed to save new profile:", err);
        alert("Failed to save profile to database.");
      }
    });
  }

  if (btnDeleteProfile) {
    btnDeleteProfile.addEventListener('click', async () => {
      if (!state.activeProfileId) return;
      
      const activeProfile = state.allProfiles.find(p => p.id === state.activeProfileId);
      const nameToDelete = activeProfile ? activeProfile.name : "this profile";
      
      if (!confirm(`⚠️ WARNING: Are you sure you want to permanently delete the profile "${nameToDelete}" and all of its compiled metrics?\n\nThis action cannot be undone.`)) {
        return;
      }

      try {
        await snapshotStore.deleteProfile(state.activeProfileId);
        state.activeProfileId = null;
        state.metricsA = null;
        state.metricsT = null;
        state.metricsOverhead = null;
        state.imageA = null;
        state.imageT = null;
        state.imageOverhead = null;
        state.importedPortfolioMetrics = null;
        state.pixelsPerCm = null;
        state.calLocked = false;
        state.squatPeaks = { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };
        
        state.allProfiles = await snapshotStore.getAllProfiles();
        
        if (profileSearchInput) profileSearchInput.value = '';
        populateDropdown(state.allProfiles);
        profileSelect.value = '';
        if (calProfileSelect) calProfileSelect.value = '';
        
        updateDashboardOfflinePlaceholders();

        if (profileStatusBar) {
          const activeProfileName = document.getElementById('active-profile-name');
          if (activeProfileName) activeProfileName.textContent = 'Guest Mode';
          profileStatusBar.classList.add('hidden');
        }
        btnDeleteProfile.classList.add('hidden');
        if (profileActionRow) profileActionRow.classList.add('hidden');
        
        const arucoStatusText = document.getElementById('aruco-status-text');
        if (arucoStatusText) {
          arucoStatusText.innerHTML = `🔍 Scanning for Reference ArUco (200mm)...`;
        }

        statusElement.textContent = `🗑️ Profile deleted successfully. Switched back to Guest Mode.`;
      } catch (err) {
        console.error("[initializeProfilesSelector] Failed to delete profile:", err);
        alert("Failed to delete profile from database.");
      }
    });
  }

  if (btnViewProfileDetails) {
    btnViewProfileDetails.addEventListener('click', () => {
      if (state.activeProfileId) {
        openProfileDetailsModal(state.activeProfileId);
      } else {
        alert("Please select or create a profile to view details.");
      }
    });
  }

  if (btnCloseProfileDetails) {
    btnCloseProfileDetails.addEventListener('click', closeProfileDetailsModal);
  }

  if (btnCloseProfileDetailsFooter) {
    btnCloseProfileDetailsFooter.addEventListener('click', closeProfileDetailsModal);
  }

  if (btnProfileExportJson) {
    btnProfileExportJson.addEventListener('click', () => {
      compileAndDownloadCombinedSession();
    });
  }
}

export function compileImportedMetricsFromProfile(profile, sessionId = null) {
  if (!profile) return null;

  // Determine the source metrics block (either specific session, active session, or profile top-level fallback)
  let sourceObj = profile;
  if (profile.sessions && Array.isArray(profile.sessions) && profile.sessions.length > 0) {
    const targetId = sessionId || state.activeSessionId || profile.activeSessionId;
    const session = profile.sessions.find(s => s.id === targetId) || profile.sessions[0];
    if (session) {
      sourceObj = session;
    }
  }

  const compiled = {};
  let hasAny = false;

  const standardSegments = [
    'skeletal_height', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r',
    'foot_l', 'foot_r', 'torso_l', 'torso_r', 'upperarm_l', 'upperarm_r',
    'forearm_l', 'forearm_r'
  ];

  // 1. Height and standard segments: prioritize A-pose (stature scan), fallback to T, then Overhead
  const standardSources = [sourceObj.metricsA, sourceObj.metricsT, sourceObj.metricsOverhead];
  for (const key of standardSegments) {
    let foundValue = null;
    for (const src of standardSources) {
      if (src && src[key] !== null && src[key] !== undefined) {
        foundValue = src[key];
        break;
      }
    }
    if (foundValue !== null) {
      compiled[key] = foundValue;
      hasAny = true;
    }
  }

  // 2. Wingspan: prioritize T-pose (wingspan scan), fallback to A, then Overhead
  const wingspanSources = [sourceObj.metricsT, sourceObj.metricsA, sourceObj.metricsOverhead];
  let foundWingspan = null;
  for (const src of wingspanSources) {
    if (src && src.wingspan !== null && src.wingspan !== undefined) {
      foundWingspan = src.wingspan;
      break;
    }
  }
  if (foundWingspan !== null) {
    compiled.wingspan = foundWingspan;
    hasAny = true;
  }

  // 3. Overhead reach (finger to toe): prioritize Overhead pose (reach scan), fallback to A, then T
  const reachSources = [sourceObj.metricsOverhead, sourceObj.metricsA, sourceObj.metricsT];
  for (const key of ['fingerToToeL', 'fingerToToeR']) {
    let foundValue = null;
    for (const src of reachSources) {
      if (src && src[key] !== null && src[key] !== undefined) {
        foundValue = src[key];
        break;
      }
    }
    if (foundValue !== null) {
      compiled[key] = foundValue;
      hasAny = true;
    }
  }

  return hasAny ? compiled : null;
}

export function ensureProfileSessions(profile) {
  if (!profile) return profile;
  if (!profile.sessions || !Array.isArray(profile.sessions) || profile.sessions.length === 0) {
    const baselineSession = {
      id: "baseline_" + Date.now(),
      name: "Baseline Session",
      timestamp: profile.timestamp || Date.now(),
      pixelsPerCm: profile.pixelsPerCm || null,
      metricsA: profile.metricsA || null,
      metricsT: profile.metricsT || null,
      metricsOverhead: profile.metricsOverhead || null,
      squatPeaks: profile.squatPeaks || { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 },
      imageA: profile.imageA || null,
      imageT: profile.imageT || null,
      imageOverhead: profile.imageOverhead || null,
      imageSquatL: profile.imageSquatL || null,
      imageSquatR: profile.imageSquatR || null
    };
    profile.sessions = [baselineSession];
    profile.activeSessionId = baselineSession.id;
  }
  if (!profile.activeSessionId) {
    profile.activeSessionId = profile.sessions[profile.sessions.length - 1].id;
  }
  return profile;
}

export async function loadProfileIntoState(profileId) {
  try {
    let profile = await snapshotStore.getProfile(profileId);
    if (!profile) return;

    const hadSessions = !!profile.sessions && Array.isArray(profile.sessions) && profile.sessions.length > 0;
    profile = ensureProfileSessions(profile);
    if (!hadSessions) {
      await snapshotStore.saveProfile(profile);
    }

    state.activeProfileId = profile.id;
    
    // Find active session
    let activeSession = profile.sessions.find(s => s.id === state.activeSessionId);
    if (!activeSession) {
      activeSession = profile.sessions.find(s => s.id === profile.activeSessionId);
    }
    if (!activeSession) {
      activeSession = profile.sessions[profile.sessions.length - 1];
    }
    
    state.activeSessionId = activeSession.id;
    state.metricsA = activeSession.metricsA || null;
    state.metricsT = activeSession.metricsT || null;
    state.metricsOverhead = activeSession.metricsOverhead || null;
    state.squatPeaks = activeSession.squatPeaks || { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };
    state.imageA = activeSession.imageA || null;
    state.imageT = activeSession.imageT || null;
    state.imageOverhead = activeSession.imageOverhead || null;
    state.imageSquatL = activeSession.imageSquatL || null;
    state.imageSquatR = activeSession.imageSquatR || null;
    
    state.importedPortfolioMetrics = compileImportedMetricsFromProfile(profile, activeSession.id);

    const activeHeightCm = state.importedPortfolioMetrics && state.importedPortfolioMetrics.skeletal_height;
    if (activeHeightCm) {
      const inputUserHeight = document.getElementById('input-user-height');
      if (inputUserHeight) {
        if (state.useInches) {
          inputUserHeight.value = (activeHeightCm / 2.54).toFixed(1);
        } else {
          inputUserHeight.value = activeHeightCm.toFixed(1);
        }
      }
    }
    
    const sessionPixelsPerCm = activeSession.pixelsPerCm || profile.pixelsPerCm;
    if (sessionPixelsPerCm) {
      state.pixelsPerCm = sessionPixelsPerCm;
      state.calLocked = true;
      const arucoStatusText = document.getElementById('aruco-status-text');
      if (arucoStatusText) {
        arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-red">${state.pixelsPerCm.toFixed(2)} px/cm</strong>`;
      }
      const inputPremeasuredScale = document.getElementById('input-premeasured-scale');
      if (inputPremeasuredScale) {
        inputPremeasuredScale.value = state.pixelsPerCm.toFixed(2);
      }
    } else {
      state.pixelsPerCm = null;
      state.calLocked = false;
    }

    const displayMetrics = state.metricsA || state.metricsT || state.metricsOverhead;
    if (displayMetrics) {
      renderDashboard(displayMetrics);
    } else {
      updateDashboardOfflinePlaceholders();
    }

    if (squatPeakKneeL) squatPeakKneeL.textContent = `${state.squatPeaks.kneeL || 0}°`;
    if (squatPeakKneeR) squatPeakKneeR.textContent = `${state.squatPeaks.kneeR || 0}°`;
    if (squatPeakHipL) squatPeakHipL.textContent = `${state.squatPeaks.hipL || 0}°`;
    if (squatPeakHipR) squatPeakHipR.textContent = `${state.squatPeaks.hipR || 0}°`;
    if (squatPeakAnkleL) squatPeakAnkleL.textContent = `${state.squatPeaks.ankleL || 0}°`;
    if (squatPeakAnkleR) squatPeakAnkleR.textContent = `${state.squatPeaks.ankleR || 0}°`;

    const activeProfileName = document.getElementById('active-profile-name');
    if (activeProfileName) {
      activeProfileName.textContent = profile.name;
    }
    const profileStatusBar = document.getElementById('profile-status-bar');
    if (profileStatusBar) {
      profileStatusBar.classList.remove('hidden');
    }
    const btnDeleteProfile = document.getElementById('btn-delete-profile');
    if (btnDeleteProfile) {
      btnDeleteProfile.classList.remove('hidden');
    }
    const profileActionRow = document.getElementById('profile-action-row');
    if (profileActionRow) {
      profileActionRow.classList.remove('hidden');
    }
    const profileSelect = document.getElementById('profile-select');
    const calProfileSelect = document.getElementById('cal-profile-select');
    if (profileSelect) profileSelect.value = String(profileId);
    if (calProfileSelect) calProfileSelect.value = String(profileId);

  } catch (err) {
    console.error("[loadProfile] Error loading profile into state:", err);
  }
}

export async function autoSyncToActiveProfile() {
  if (!state.activeProfileId || !state.dbInitialized) return;
  try {
    let profile = await snapshotStore.getProfile(state.activeProfileId);
    if (!profile) return;
    
    // Ensure session properties are initialized
    profile = ensureProfileSessions(profile);
    
    // Find active session block
    let session = profile.sessions.find(s => s.id === state.activeSessionId);
    if (!session) {
      session = profile.sessions.find(s => s.id === profile.activeSessionId);
    }
    if (!session) {
      session = profile.sessions[profile.sessions.length - 1];
    }
    
    // Sync current dashboard state into the active session
    session.timestamp = Date.now();
    session.pixelsPerCm = state.pixelsPerCm;
    session.metricsA = state.metricsA;
    session.metricsT = state.metricsT;
    session.metricsOverhead = state.metricsOverhead;
    session.squatPeaks = JSON.parse(JSON.stringify(state.squatPeaks));
    session.imageA = state.imageA;
    session.imageT = state.imageT;
    session.imageOverhead = state.imageOverhead;
    session.imageSquatL = state.imageSquatL;
    session.imageSquatR = state.imageSquatR;
    
    // Keep profile-level active session and timestamp synced
    profile.timestamp = Date.now();
    profile.activeSessionId = session.id;
    
    // Keep legacy flat fields updated on the main profile for redundant backup
    profile.pixelsPerCm = state.pixelsPerCm;
    profile.metricsA = state.metricsA;
    profile.metricsT = state.metricsT;
    profile.metricsOverhead = state.metricsOverhead;
    profile.squatPeaks = JSON.parse(JSON.stringify(state.squatPeaks));
    profile.imageA = state.imageA;
    profile.imageT = state.imageT;
    profile.imageOverhead = state.imageOverhead;
    profile.imageSquatL = state.imageSquatL;
    profile.imageSquatR = state.imageSquatR;
    
    await snapshotStore.saveProfile(profile);
    console.log(`[autoSync] Synced active profile: ${profile.name}, session: ${session.name}`);
    
    state.allProfiles = await snapshotStore.getAllProfiles();
  } catch (err) {
    console.error("[autoSync] Error syncing to active profile:", err);
  }
}

let syncTimeout = null;
export function autoSyncToActiveProfileDebounced() {
  if (!state.activeProfileId || !state.dbInitialized) return;
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    autoSyncToActiveProfile();
  }, 1500);
}

export async function openProfileDetailsModal(profileId) {
  if (!profileId) return;
  try {
    let profile = await snapshotStore.getProfile(profileId);
    if (!profile) return;

    // 1. Silent schema upgrade
    const originalSessionCount = profile.sessions ? profile.sessions.length : 0;
    profile = ensureProfileSessions(profile);
    if (originalSessionCount === 0) {
      await snapshotStore.saveProfile(profile);
    }

    // Determine the active session
    let activeSession = profile.sessions.find(s => s.id === state.activeSessionId);
    if (!activeSession) {
      activeSession = profile.sessions.find(s => s.id === profile.activeSessionId);
    }
    if (!activeSession) {
      activeSession = profile.sessions[profile.sessions.length - 1];
    }
    state.activeSessionId = activeSession.id;

    // 2. Render Session selector dropdown
    const sessionSelect = document.getElementById('profile-detail-session-select');
    if (sessionSelect) {
      sessionSelect.innerHTML = '';
      profile.sessions.forEach(sess => {
        const option = document.createElement('option');
        option.value = sess.id;
        option.textContent = sess.name || `Session (${new Date(sess.timestamp).toLocaleDateString()})`;
        if (sess.id === activeSession.id) {
          option.selected = true;
        }
        sessionSelect.appendChild(option);
      });

      // Handle session dropdown selection changes
      sessionSelect.onchange = async (e) => {
        const selectedSessId = e.target.value;
        state.activeSessionId = selectedSessId;
        profile.activeSessionId = selectedSessId;
        await snapshotStore.saveProfile(profile);
        
        // Synchronize active session onto live dashboard
        await loadProfileIntoState(profileId);
        
        // Refresh detail views
        openProfileDetailsModal(profileId);
      };
    }

    // 3. Handle "+ New Session" button clicks
    const btnNewSession = document.getElementById('btn-profile-new-session');
    if (btnNewSession) {
      btnNewSession.onclick = async () => {
        const sessionName = prompt("Enter a name for the new session (e.g., 'Set 2 - Post-practice'):");
        if (sessionName === null) return; // evaluator cancelled
        const trimmedName = sessionName.trim() || `Session ${profile.sessions.length + 1}`;

        const newSession = {
          id: "session_" + Date.now(),
          name: trimmedName,
          timestamp: Date.now(),
          pixelsPerCm: profile.pixelsPerCm || null, // carry over scale so we don't force re-calibration
          metricsA: null,
          metricsT: null,
          metricsOverhead: null,
          squatPeaks: { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 },
          imageA: null,
          imageT: null,
          imageOverhead: null,
          imageSquatL: null,
          imageSquatR: null
        };

        profile.sessions.push(newSession);
        profile.activeSessionId = newSession.id;
        state.activeSessionId = newSession.id;

        // Reset live dashboard metrics
        state.metricsA = null;
        state.metricsT = null;
        state.metricsOverhead = null;
        state.squatPeaks = { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };
        state.imageA = null;
        state.imageT = null;
        state.imageOverhead = null;
        state.imageSquatL = null;
        state.imageSquatR = null;

        await snapshotStore.saveProfile(profile);
        await loadProfileIntoState(profileId);

        alert(`New session "${trimmedName}" started! Dashboard metrics are reset for fresh video captures.`);
        openProfileDetailsModal(profileId);
      };
    }

    // 3.5 Handle "Rename Session" button clicks
    const btnRenameSession = document.getElementById('btn-profile-rename-session');
    if (btnRenameSession) {
      btnRenameSession.onclick = async () => {
        const currentSessionName = activeSession.name || `Session (${new Date(activeSession.timestamp).toLocaleDateString()})`;
        const newName = prompt("Enter new name for this session:", currentSessionName);
        if (newName === null) return; // cancelled
        const trimmedName = newName.trim();
        if (!trimmedName) {
          alert("Session name cannot be empty.");
          return;
        }

        try {
          const freshProfile = await snapshotStore.getProfile(profileId);
          if (freshProfile) {
            const freshProfileMigrated = ensureProfileSessions(freshProfile);
            const freshActiveSession = freshProfileMigrated.sessions.find(s => s.id === activeSession.id);
            if (freshActiveSession) {
              freshActiveSession.name = trimmedName;
              await snapshotStore.saveProfile(freshProfileMigrated);
              
              // Refresh state list of profiles
              state.allProfiles = await snapshotStore.getAllProfiles();
              if (state.activeProfileId === profileId) {
                // If it is the current active profile, sync state
                await loadProfileIntoState(profileId);
              }
              
              alert(`Session renamed to "${trimmedName}" successfully!`);
              openProfileDetailsModal(profileId);
            }
          }
        } catch (err) {
          console.error("[SessionRename] Failed to rename session:", err);
          alert("Failed to rename session: " + err.message);
        }
      };
    }

    // 4. Text elements & Profile Renaming
    const detailName = document.getElementById('profile-detail-name');
    const detailScale = document.getElementById('profile-detail-scale');
    const detailLastSession = document.getElementById('profile-detail-last-session');
    
    if (detailName) {
      detailName.innerHTML = `
        ${profile.name || "Anonymous Subject"} 
        <button class="btn btn-rename-profile" title="Rename Profile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
      `;
      
      const renameProfileBtn = detailName.querySelector('.btn-rename-profile');
      if (renameProfileBtn) {
        renameProfileBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const currentName = profile.name || "Anonymous Subject";
          const newName = prompt("Enter new profile name:", currentName);
          if (newName === null) return;
          const trimmedName = newName.trim();
          if (!trimmedName) {
            alert("Profile name cannot be empty.");
            return;
          }
          if (trimmedName.toLowerCase() !== currentName.toLowerCase()) {
            const isDuplicate = state.allProfiles.some(p => p.name.toLowerCase() === trimmedName.toLowerCase());
            if (isDuplicate) {
              alert(`A profile named "${trimmedName}" already exists. Please choose a different name.`);
              return;
            }
          }
          try {
            const freshProfile = await snapshotStore.getProfile(profileId);
            if (freshProfile) {
              freshProfile.name = trimmedName;
              await snapshotStore.saveProfile(freshProfile);
              state.allProfiles = await snapshotStore.getAllProfiles();
              
              // Sync select dropdown selectors
              const profileSelect = document.getElementById('profile-select');
              const calProfileSelect = document.getElementById('cal-profile-select');
              if (profileSelect) {
                const opt = [...profileSelect.options].find(o => Number(o.value) === profileId);
                if (opt) opt.textContent = trimmedName;
              }
              if (calProfileSelect) {
                const opt = [...calProfileSelect.options].find(o => Number(o.value) === profileId);
                if (opt) opt.textContent = trimmedName;
              }
              
              // Update bottom status bar name
              if (state.activeProfileId === profileId) {
                const activeProfileName = document.getElementById('active-profile-name');
                if (activeProfileName) activeProfileName.textContent = trimmedName;
              }
              
              openProfileDetailsModal(profileId);
            }
          } catch (err) {
            console.error("[ProfileRename] Failed to rename profile:", err);
          }
        });
      }
    }

    const sessionPixelsPerCm = activeSession.pixelsPerCm || profile.pixelsPerCm;
    if (detailScale) {
      detailScale.textContent = sessionPixelsPerCm 
        ? `Calibration: ${sessionPixelsPerCm.toFixed(2)} px/cm` 
        : "Calibration: Uncalibrated";
    }
    if (detailLastSession) {
      const ts = activeSession.timestamp || profile.timestamp;
      if (ts) {
        const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        detailLastSession.textContent = `Session Date: ${new Date(ts).toLocaleDateString(undefined, options)}`;
      } else {
        detailLastSession.textContent = "Session Date: --";
      }
    }

    // 5. Pose status cards (now 5 items)
    const poses = [
      { key: 'a', metricsKey: 'metricsA', imgKey: 'imageA', title: 'A-Pose (Stature)', color: 'var(--color-scarlet)' },
      { key: 't', metricsKey: 'metricsT', imgKey: 'imageT', title: 'T-Pose (Wingspan)', color: 'var(--color-cyan)' },
      { key: 'overhead', metricsKey: 'metricsOverhead', imgKey: 'imageOverhead', title: 'Overhead (Reach)', color: '#d4a017' },
      { key: 'squat-l', metricsKey: 'squatPeaks', imgKey: 'imageSquatL', title: 'Left Overhead Squat', color: '#9333ea', isSquat: true, squatSide: 'kneeL' },
      { key: 'squat-r', metricsKey: 'squatPeaks', imgKey: 'imageSquatR', title: 'Right Overhead Squat', color: '#a855f7', isSquat: true, squatSide: 'kneeR' }
    ];

    poses.forEach(p => {
      const statusEl = document.getElementById(`detail-status-${p.key}`);
      const imgEl = document.getElementById(`detail-preview-img-${p.key}`);
      const containerEl = document.getElementById(`detail-preview-container-${p.key}`);
      
      let hasData = false;
      let imgSrc = null;
      
      if (p.isSquat) {
        const peakVal = activeSession.squatPeaks ? activeSession.squatPeaks[p.squatSide] : 0;
        imgSrc = activeSession[p.imgKey];
        hasData = (peakVal > 0) || !!imgSrc;
      } else {
        hasData = !!activeSession[p.metricsKey];
        imgSrc = activeSession[p.imgKey];
      }

      if (hasData) {
        if (statusEl) {
          statusEl.textContent = "✅ Complete";
          statusEl.className = 'text-emerald';
        }
        if (imgSrc) {
          if (imgEl) imgEl.src = imgSrc;
          if (containerEl) containerEl.classList.remove('hidden');
        } else {
          if (containerEl) containerEl.classList.add('hidden');
        }
      } else {
        if (statusEl) {
          statusEl.textContent = "❌ Missing";
          statusEl.className = 'text-red';
        }
        if (containerEl) containerEl.classList.add('hidden');
        if (imgEl) imgEl.src = "";
      }
    });

    // 6. Helper functions for table cells (all binding to activeSession metrics)
    const mA = activeSession.metricsA || {};
    const mT = activeSession.metricsT || {};
    const mO = activeSession.metricsOverhead || {};

    const getVal = (poseKey, metricKey, fallbackSources) => {
      let rawVal = null;
      if (poseKey === 'a') rawVal = mA[metricKey];
      else if (poseKey === 't') rawVal = mT[metricKey];
      else if (poseKey === 'overhead') rawVal = mO[metricKey];

      if (rawVal !== null && rawVal !== undefined) return rawVal;

      if (fallbackSources) {
        for (const srcKey of fallbackSources) {
          const src = srcKey === 'a' ? mA : (srcKey === 't' ? mT : mO);
          if (src && src[metricKey] !== null && src[metricKey] !== undefined) {
            return src[metricKey];
          }
        }
      }
      return null;
    };

    const getValPair = (poseKey, leftKey, rightKey, fallbackSources) => {
      let rawL = null, rawR = null;
      if (poseKey === 'a') {
        rawL = mA[leftKey];
        rawR = mA[rightKey];
      } else if (poseKey === 't') {
        rawL = mT[leftKey];
        rawR = mT[rightKey];
      } else if (poseKey === 'overhead') {
        rawL = mO[leftKey];
        rawR = mO[rightKey];
      }

      let finalL = (rawL !== null && rawL !== undefined) ? rawL : null;
      let finalR = (rawR !== null && rawR !== undefined) ? rawR : null;

      if (finalL === null && fallbackSources) {
        for (const srcKey of fallbackSources) {
          const src = srcKey === 'a' ? mA : (srcKey === 't' ? mT : mO);
          if (src && src[leftKey] !== null && src[leftKey] !== undefined) {
            finalL = src[leftKey];
            break;
          }
        }
      }
      if (finalR === null && fallbackSources) {
        for (const srcKey of fallbackSources) {
          const src = srcKey === 'a' ? mA : (srcKey === 't' ? mT : mO);
          if (src && src[rightKey] !== null && src[rightKey] !== undefined) {
            finalR = src[rightKey];
            break;
          }
        }
      }
      return [finalL, finalR];
    };

    const formatPair = (left, right) => {
      if ((left === null || left === undefined) && (right === null || right === undefined)) return '--';
      return `L: ${formatLength(left)} / R: ${formatLength(right)}`;
    };

    const formatSingle = (val) => {
      if (val === null || val === undefined) return '--';
      return formatLength(val);
    };

    const renderCellSingle = (poseKey, metricKey, val) => {
      if (!state.isEditingProfileMetrics) {
        return formatSingle(val);
      }
      let displayVal = "";
      if (val !== null && val !== undefined && !isNaN(val)) {
        displayVal = state.useInches ? (val / 2.54).toFixed(1) : val.toFixed(1);
      }
      const suffix = state.useInches ? "in" : "cm";
      return `
        <div class="profile-cell-flex">
          <input type="number" step="0.1" min="0" class="profile-edit-input single" 
                 data-pose="${poseKey}" data-key="${metricKey}" 
                 value="${displayVal}" placeholder="--">
          <span class="profile-unit-suffix">${suffix}</span>
        </div>
      `;
    };

    const renderCellPair = (poseKey, leftMetricKey, rightMetricKey, leftVal, rightVal) => {
      if (!state.isEditingProfileMetrics) {
        return formatPair(leftVal, rightVal);
      }
      let displayLeft = "";
      if (leftVal !== null && leftVal !== undefined && !isNaN(leftVal)) {
        displayLeft = state.useInches ? (leftVal / 2.54).toFixed(1) : leftVal.toFixed(1);
      }
      let displayRight = "";
      if (rightVal !== null && rightVal !== undefined && !isNaN(rightVal)) {
        displayRight = state.useInches ? (rightVal / 2.54).toFixed(1) : rightVal.toFixed(1);
      }
      const suffix = state.useInches ? "in" : "cm";
      return `
        <div class="profile-cell-flex-col">
          <div class="profile-cell-flex">
            <span class="profile-side-label">L:</span>
            <input type="number" step="0.1" min="0" class="profile-edit-input pair" 
                   data-pose="${poseKey}" data-key="${leftMetricKey}" 
                   value="${displayLeft}" placeholder="--">
            <span class="profile-unit-suffix">${suffix}</span>
          </div>
          <div class="profile-cell-flex">
            <span class="profile-side-label">R:</span>
            <input type="number" step="0.1" min="0" class="profile-edit-input pair" 
                   data-pose="${poseKey}" data-key="${rightMetricKey}" 
                   value="${displayRight}" placeholder="--">
            <span class="profile-unit-suffix">${suffix}</span>
          </div>
        </div>
      `;
    };

    const renderSquatPeakEdit = (jointKey, valL, valR) => {
      if (!state.isEditingProfileMetrics) {
        return `${valL || 0}° / ${valR || 0}°`;
      }
      return `
        <div class="profile-cell-flex-center">
          <span class="profile-squat-label">L:</span>
          <input type="number" step="1" min="0" max="180" class="profile-squat-edit-input profile-edit-input squat" 
                 data-joint="${jointKey}" data-side="L" 
                 value="${valL || 0}">
          <span class="profile-deg-suffix">°</span>
          <span class="profile-squat-label right">R:</span>
          <input type="number" step="1" min="0" max="180" class="profile-squat-edit-input profile-edit-input squat" 
                 data-joint="${jointKey}" data-side="R" 
                 value="${valR || 0}">
          <span class="profile-deg-suffix">°</span>
        </div>
      `;
    };

    // Stature Height row (Reverted: show on all columns with fallbacks)
    const thA = document.getElementById('detail-table-height-a');
    const thT = document.getElementById('detail-table-height-t');
    const thO = document.getElementById('detail-table-height-overhead');
    if (thA) thA.innerHTML = renderCellSingle('a', 'skeletal_height', getVal('a', 'skeletal_height', ['t', 'overhead']));
    if (thT) thT.innerHTML = renderCellSingle('t', 'skeletal_height', getVal('t', 'skeletal_height', ['a', 'overhead']));
    if (thO) thO.innerHTML = renderCellSingle('overhead', 'skeletal_height', getVal('overhead', 'skeletal_height', ['a', 't']));

    // Wingspan / Reach row (Reverted: show on all columns with fallbacks)
    const twA = document.getElementById('detail-table-wingspan-a');
    const twT = document.getElementById('detail-table-wingspan-t');
    const twO = document.getElementById('detail-table-wingspan-overhead');
    if (twA) twA.innerHTML = renderCellSingle('a', 'wingspan', getVal('a', 'wingspan', ['t', 'overhead']));
    if (twT) twT.innerHTML = renderCellSingle('t', 'wingspan', getVal('t', 'wingspan', ['a', 'overhead']));
    if (twO) {
      const [reachL, reachR] = getValPair('overhead', 'fingerToToeL', 'fingerToToeR', ['a', 't']);
      twO.innerHTML = renderCellPair('overhead', 'fingerToToeL', 'fingerToToeR', reachL, reachR);
    }

    // Torso Length row
    const ttA = document.getElementById('detail-table-torso-a');
    const ttT = document.getElementById('detail-table-torso-t');
    const ttO = document.getElementById('detail-table-torso-overhead');
    if (ttA) {
      const [valL, valR] = getValPair('a', 'torso_l', 'torso_r', ['t', 'overhead']);
      ttA.innerHTML = renderCellPair('a', 'torso_l', 'torso_r', valL, valR);
    }
    if (ttT) {
      const [valL, valR] = getValPair('t', 'torso_l', 'torso_r', ['a', 'overhead']);
      ttT.innerHTML = renderCellPair('t', 'torso_l', 'torso_r', valL, valR);
    }
    if (ttO) {
      const [valL, valR] = getValPair('overhead', 'torso_l', 'torso_r', ['a', 't']);
      ttO.innerHTML = renderCellPair('overhead', 'torso_l', 'torso_r', valL, valR);
    }

    // Thigh Length row
    const tthA = document.getElementById('detail-table-thigh-a');
    const tthT = document.getElementById('detail-table-thigh-t');
    const tthO = document.getElementById('detail-table-thigh-overhead');
    if (tthA) {
      const [valL, valR] = getValPair('a', 'thigh_l', 'thigh_r', ['t', 'overhead']);
      tthA.innerHTML = renderCellPair('a', 'thigh_l', 'thigh_r', valL, valR);
    }
    if (tthT) {
      const [valL, valR] = getValPair('t', 'thigh_l', 'thigh_r', ['a', 'overhead']);
      tthT.innerHTML = renderCellPair('t', 'thigh_l', 'thigh_r', valL, valR);
    }
    if (tthO) {
      const [valL, valR] = getValPair('overhead', 'thigh_l', 'thigh_r', ['a', 't']);
      tthO.innerHTML = renderCellPair('overhead', 'thigh_l', 'thigh_r', valL, valR);
    }

    // Shank Length (shin) row
    const tsA = document.getElementById('detail-table-shin-a');
    const tsT = document.getElementById('detail-table-shin-t');
    const tsO = document.getElementById('detail-table-shin-overhead');
    if (tsA) {
      const [valL, valR] = getValPair('a', 'shin_l', 'shin_r', ['t', 'overhead']);
      tsA.innerHTML = renderCellPair('a', 'shin_l', 'shin_r', valL, valR);
    }
    if (tsT) {
      const [valL, valR] = getValPair('t', 'shin_l', 'shin_r', ['a', 'overhead']);
      tsT.innerHTML = renderCellPair('t', 'shin_l', 'shin_r', valL, valR);
    }
    if (tsO) {
      const [valL, valR] = getValPair('overhead', 'shin_l', 'shin_r', ['a', 't']);
      tsO.innerHTML = renderCellPair('overhead', 'shin_l', 'shin_r', valL, valR);
    }

    // Upper Arm row
    const tuaA = document.getElementById('detail-table-upperarm-a');
    const tuaT = document.getElementById('detail-table-upperarm-t');
    const tuaO = document.getElementById('detail-table-upperarm-overhead');
    if (tuaA) {
      const [valL, valR] = getValPair('a', 'upperarm_l', 'upperarm_r', ['t', 'overhead']);
      tuaA.innerHTML = renderCellPair('a', 'upperarm_l', 'upperarm_r', valL, valR);
    }
    if (tuaT) {
      const [valL, valR] = getValPair('t', 'upperarm_l', 'upperarm_r', ['a', 'overhead']);
      tuaT.innerHTML = renderCellPair('t', 'upperarm_l', 'upperarm_r', valL, valR);
    }
    if (tuaO) {
      const [valL, valR] = getValPair('overhead', 'upperarm_l', 'upperarm_r', ['a', 't']);
      tuaO.innerHTML = renderCellPair('overhead', 'upperarm_l', 'upperarm_r', valL, valR);
    }

    // Forearm row
    const tfaA = document.getElementById('detail-table-forearm-a');
    const tfaT = document.getElementById('detail-table-forearm-t');
    const tfaO = document.getElementById('detail-table-forearm-overhead');
    if (tfaA) {
      const [valL, valR] = getValPair('a', 'forearm_l', 'forearm_r', ['t', 'overhead']);
      tfaA.innerHTML = renderCellPair('a', 'forearm_l', 'forearm_r', valL, valR);
    }
    if (tfaT) {
      const [valL, valR] = getValPair('t', 'forearm_l', 'forearm_r', ['a', 'overhead']);
      tfaT.innerHTML = renderCellPair('t', 'forearm_l', 'forearm_r', valL, valR);
    }
    if (tfaO) {
      const [valL, valR] = getValPair('overhead', 'forearm_l', 'forearm_r', ['a', 't']);
      tfaO.innerHTML = renderCellPair('overhead', 'forearm_l', 'forearm_r', valL, valR);
    }

    // 7. Populate Consolidated Final Baselines Table (passing active session id)
    const cHeight = document.getElementById('consolidated-val-height');
    const cWingspan = document.getElementById('consolidated-val-wingspan');
    const cReach = document.getElementById('consolidated-val-reach');
    const cTorso = document.getElementById('consolidated-val-torso');
    const cThigh = document.getElementById('consolidated-val-thigh');
    const cShin = document.getElementById('consolidated-val-shin');
    const cUpperarm = document.getElementById('consolidated-val-upperarm');
    const cForearm = document.getElementById('consolidated-val-forearm');

    const compiled = compileImportedMetricsFromProfile(profile, activeSession.id) || {};

    if (cHeight) cHeight.innerHTML = formatSingle(compiled.skeletal_height);
    if (cWingspan) cWingspan.innerHTML = formatSingle(compiled.wingspan);
    if (cReach) cReach.innerHTML = formatPair(compiled.fingerToToeL, compiled.fingerToToeR);
    if (cTorso) cTorso.innerHTML = formatPair(compiled.torso_l, compiled.torso_r);
    if (cThigh) cThigh.innerHTML = formatPair(compiled.thigh_l, compiled.thigh_r);
    if (cShin) cShin.innerHTML = formatPair(compiled.shin_l, compiled.shin_r);
    if (cUpperarm) cUpperarm.innerHTML = formatPair(compiled.upperarm_l, compiled.upperarm_r);
    if (cForearm) cForearm.innerHTML = formatPair(compiled.forearm_l, compiled.forearm_r);

    // 8. Wire up metrics editing button event handlers (activeSession-scoped)
    const editBtn = document.getElementById('btn-edit-baseline-metrics');
    if (editBtn) {
      editBtn.classList.remove('btn-save-metrics', 'btn-edit-metrics');
      if (state.isEditingProfileMetrics) {
        editBtn.innerHTML = '💾 Save Metrics';
        editBtn.classList.add('btn-save-metrics');
        
        let cancelBtn = document.getElementById('btn-cancel-baseline-metrics');
        if (!cancelBtn) {
          cancelBtn = document.createElement('button');
          cancelBtn.id = 'btn-cancel-baseline-metrics';
          cancelBtn.className = 'btn btn-cancel-metrics';
          cancelBtn.innerHTML = '❌ Cancel';
          editBtn.parentNode.appendChild(cancelBtn);
        }
        
        cancelBtn.onclick = () => {
          state.isEditingProfileMetrics = false;
          openProfileDetailsModal(profileId);
        };
        
        editBtn.onclick = async () => {
          try {
            const freshProfile = await snapshotStore.getProfile(profileId);
            if (!freshProfile) return;
            
            const freshProfileMigrated = ensureProfileSessions(freshProfile);
            const freshActiveSession = freshProfileMigrated.sessions.find(s => s.id === activeSession.id) || freshProfileMigrated.sessions[0];
            
            if (!freshActiveSession.metricsA) freshActiveSession.metricsA = {};
            if (!freshActiveSession.metricsT) freshActiveSession.metricsT = {};
            if (!freshActiveSession.metricsOverhead) freshActiveSession.metricsOverhead = {};
            
            const inputs = document.querySelectorAll('.profile-edit-input');
            inputs.forEach(input => {
              const pose = input.getAttribute('data-pose');
              const key = input.getAttribute('data-key');
              const rawVal = input.value.trim();
              
              let targetMetrics;
              if (pose === 'a') targetMetrics = freshActiveSession.metricsA;
              else if (pose === 't') targetMetrics = freshActiveSession.metricsT;
              else if (pose === 'overhead') targetMetrics = freshActiveSession.metricsOverhead;
              
              if (targetMetrics) {
                if (rawVal === "") {
                  targetMetrics[key] = null;
                } else {
                  const parsed = parseFloat(rawVal);
                  if (!isNaN(parsed)) {
                    const cmVal = state.useInches ? parsed * 2.54 : parsed;
                    targetMetrics[key] = cmVal;
                  }
                }
              }
            });

            // Save squat peaks mobility records in session
            if (!freshActiveSession.squatPeaks) {
              freshActiveSession.squatPeaks = { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };
            }
            const squatInputs = document.querySelectorAll('.profile-squat-edit-input');
            squatInputs.forEach(input => {
              const joint = input.getAttribute('data-joint');
              const side = input.getAttribute('data-side');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseInt(rawVal, 10);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              const key = joint + side; // e.g. kneeL, kneeR, hipL, hipR, ankleL, ankleR
              freshActiveSession.squatPeaks[key] = val;
            });
            
            // Mirror back to legacy fields for redundancy
            freshProfileMigrated.metricsA = freshActiveSession.metricsA;
            freshProfileMigrated.metricsT = freshActiveSession.metricsT;
            freshProfileMigrated.metricsOverhead = freshActiveSession.metricsOverhead;
            freshProfileMigrated.squatPeaks = freshActiveSession.squatPeaks;
            freshProfileMigrated.imageA = freshActiveSession.imageA;
            freshProfileMigrated.imageT = freshActiveSession.imageT;
            freshProfileMigrated.imageOverhead = freshActiveSession.imageOverhead;
            freshProfileMigrated.imageSquatL = freshActiveSession.imageSquatL;
            freshProfileMigrated.imageSquatR = freshActiveSession.imageSquatR;

            await snapshotStore.saveProfile(freshProfileMigrated);
            state.allProfiles = await snapshotStore.getAllProfiles();
            if (state.activeProfileId === profileId) {
              await loadProfileIntoState(profileId);
            }
            
            state.isEditingProfileMetrics = false;
            alert("Metrics updated successfully!");
            openProfileDetailsModal(profileId);
          } catch (err) {
            console.error("[SaveMetrics] Failed to save metrics:", err);
            alert("Failed to save metrics: " + err.message);
          }
        };
      } else {
        editBtn.innerHTML = '✏️ Edit Metrics';
        editBtn.classList.add('btn-edit-metrics');
        
        const cancelBtn = document.getElementById('btn-cancel-baseline-metrics');
        if (cancelBtn) {
          cancelBtn.parentNode.removeChild(cancelBtn);
        }
        
        editBtn.onclick = () => {
          state.isEditingProfileMetrics = true;
          openProfileDetailsModal(profileId);
        };
      }
    }

    // 9. Squat Peak mobility (with edit inputs support)
    const dsqKnee = document.getElementById('detail-squat-knee');
    const dsqHip = document.getElementById('detail-squat-hip');
    const dsqAnkle = document.getElementById('detail-squat-ankle');
    
    const sPeaks = activeSession.squatPeaks || { kneeL: 0, kneeR: 0, hipL: 0, hipR: 0, ankleL: 0, ankleR: 0 };
    if (dsqKnee) dsqKnee.innerHTML = renderSquatPeakEdit('knee', sPeaks.kneeL, sPeaks.kneeR);
    if (dsqHip) dsqHip.innerHTML = renderSquatPeakEdit('hip', sPeaks.hipL, sPeaks.hipR);
    if (dsqAnkle) dsqAnkle.innerHTML = renderSquatPeakEdit('ankle', sPeaks.ankleL, sPeaks.ankleR);

    // 10. Populate Saved Videos & Interactive Playlist Manager
    if (state.modalObjectUrls) {
      state.modalObjectUrls.forEach(url => URL.revokeObjectURL(url));
    }
    state.modalObjectUrls = [];

    const videosListEl = document.getElementById('profile-details-videos-list');
    const mainVideoPlayer = document.getElementById('profile-details-video-player');
    const videoPlaceholder = document.getElementById('profile-details-video-placeholder');

    if (mainVideoPlayer) {
      mainVideoPlayer.src = '';
      mainVideoPlayer.classList.add('hidden');
      mainVideoPlayer.classList.remove('visible-block');
    }
    if (videoPlaceholder) {
      videoPlaceholder.classList.add('visible-flex');
      videoPlaceholder.classList.remove('hidden');
      videoPlaceholder.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="playlist-placeholder-icon"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
        <span>Select a recording from the playlist below to play</span>
      `;
    }

    if (videosListEl) {
      videosListEl.innerHTML = '';
      
      const savedVideos = profile.videos || [];
      if (savedVideos.length === 0) {
        if (videoPlaceholder) {
          videoPlaceholder.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="playlist-placeholder-icon-empty"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            <span class="playlist-empty-text">No video recordings saved for this profile yet.</span>
          `;
        }
        videosListEl.innerHTML = `
          <div class="playlist-empty-placeholder">
            🎥 Playlist Empty
          </div>
        `;
      } else {
        savedVideos.forEach((video, idx) => {
          const videoRow = document.createElement('div');
          videoRow.className = 'profile-video-row-item';
          
          const videoUrl = URL.createObjectURL(video.blob);
          state.modalObjectUrls.push(videoUrl);
          
          const dateStr = video.timestamp ? new Date(video.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown Date';
          const sizeMb = (video.blob.size / (1024 * 1024)).toFixed(1);
          const durationStr = video.duration ? `${(video.duration / 1000).toFixed(1)}s` : '--';
          
          videoRow.innerHTML = `
            <div class="playlist-video-info-container">
              <div class="playlist-play-icon">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </div>
              <div class="playlist-video-details">
                <div class="playlist-video-title-row">
                  <span class="playlist-video-name">${video.name || 'Video Capture'}</span>
                  <button class="btn btn-rename-video" title="Rename Video">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                  </button>
                </div>
                <span class="playlist-video-meta">${dateStr} &bull; ${sizeMb} MB &bull; ${durationStr}</span>
              </div>
            </div>
            <div class="playlist-row-actions">
              <button class="btn btn-dl-video">DL</button>
              <button class="btn btn-del-video">DEL</button>
            </div>
          `;

          // Play selection trigger
          const selectVideo = () => {
            const allItems = videosListEl.querySelectorAll('.profile-video-row-item');
            allItems.forEach(item => item.classList.remove('active-playlist-item'));

            videoRow.classList.add('active-playlist-item');

            if (mainVideoPlayer) {
              mainVideoPlayer.src = videoUrl;
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
              mainVideoPlayer.play().catch(e => console.log("[VideoPlay] Autoplay blocked:", e));
            }
          };

          videoRow.addEventListener('click', (e) => {
            if (e.target.closest('.btn-rename-video') || e.target.closest('.btn-dl-video') || e.target.closest('.btn-del-video')) {
              return;
            }
            selectVideo();
          });

          // Auto pre-select the first video on open
          if (idx === 0) {
            videoRow.classList.add('active-playlist-item');
            if (mainVideoPlayer) {
              mainVideoPlayer.src = videoUrl;
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
            }
          }

          // Rename action
          const renameBtn = videoRow.querySelector('.btn-rename-video');
          renameBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentName = video.name || 'Video Capture';
            const newName = prompt("Enter a new name for this video:", currentName);
            if (newName === null) return;
            const trimmedName = newName.trim();
            if (!trimmedName) {
              alert("Video name cannot be empty.");
              return;
            }
            try {
              const freshProfile = await snapshotStore.getProfile(profileId);
              if (freshProfile && freshProfile.videos) {
                const vToUpdate = freshProfile.videos.find(v => v.id === video.id);
                if (vToUpdate) {
                  vToUpdate.name = trimmedName;
                  await snapshotStore.saveProfile(freshProfile);
                  state.allProfiles = await snapshotStore.getAllProfiles();
                  openProfileDetailsModal(profileId);
                }
              }
            } catch (err) {
              console.error("[VideoRename] Failed to rename saved video:", err);
            }
          });

          // Download action
          const dlBtn = videoRow.querySelector('.btn-dl-video');
          dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = document.createElement('a');
            a.classList.add('hidden');
            a.href = videoUrl;
            const fileExt = video.fileExt || 'webm';
            const cleanSubjectName = profile.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
            a.download = `scarlet_biomechanics_${cleanSubjectName}_saved_recording_${video.id}.${fileExt}`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              document.body.removeChild(a);
            }, 100);
          });

          // Delete action
          const delBtn = videoRow.querySelector('.btn-del-video');
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm("Are you sure you want to permanently delete this saved video from the profile?")) {
              return;
            }
            try {
              const freshProfile = await snapshotStore.getProfile(profileId);
              if (freshProfile && freshProfile.videos) {
                freshProfile.videos = freshProfile.videos.filter(v => v.id !== video.id);
                await snapshotStore.saveProfile(freshProfile);
                state.allProfiles = await snapshotStore.getAllProfiles();
                openProfileDetailsModal(profileId);
              }
            } catch (err) {
              console.error("[VideoDelete] Failed to delete saved video:", err);
            }
          });

          videosListEl.appendChild(videoRow);
        });
      }
    }

    // 11. Open the modal
    const profileDetailsModal = document.getElementById('profile-details-modal');
    if (profileDetailsModal) {
      profileDetailsModal.classList.add('active');
    }

  } catch (err) {
    console.error("[openProfileDetailsModal] Error showing profile details modal:", err);
  }
}

export function closeProfileDetailsModal() {
  const profileDetailsModal = document.getElementById('profile-details-modal');
  if (profileDetailsModal) {
    profileDetailsModal.classList.remove('active');
  }
  if (state.modalObjectUrls) {
    state.modalObjectUrls.forEach(url => URL.revokeObjectURL(url));
    state.modalObjectUrls = [];
  }
  state.isEditingProfileMetrics = false;
}