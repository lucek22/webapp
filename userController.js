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

state.activeModalVideoProcessing = false;
state.isModalVideoInferenceLoopRunning = false;


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
const btnModeShoulder = document.getElementById('btn-mode-shoulder');
const postureSidebarContent = document.getElementById('posture-sidebar-content');
const squatSidebarContent = document.getElementById('squat-sidebar-content');
const shoulderSidebarContent = document.getElementById('shoulder-sidebar-content');

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
const btnSquatSideFrontal = document.getElementById('btn-squat-side-frontal');

// UI Shoulder Flexion Elements
const shoulderPeakExcursionL = document.getElementById('shoulder-peak-excursion-l');
const shoulderLiveAngleL = document.getElementById('shoulder-live-angle-l');
const shoulderPeakExcursionR = document.getElementById('shoulder-peak-excursion-r');
const shoulderLiveAngleR = document.getElementById('shoulder-live-angle-r');

const shoulderStartAngleL = document.getElementById('shoulder-start-angle-l');
const shoulderStartAngleR = document.getElementById('shoulder-start-angle-r');
const shoulderEndAngleL = document.getElementById('shoulder-end-angle-l');
const shoulderEndAngleR = document.getElementById('shoulder-end-angle-r');

const shoulderStatusVal = document.getElementById('shoulder-status-val');

const btnShoulderSideLeft = document.getElementById('btn-shoulder-side-left');
const btnShoulderSideRight = document.getElementById('btn-shoulder-side-right');


// UI Calibration Toggles & Panels
const tabHeightBtn = document.getElementById('tab-height-btn');
const tabPortfolioBtn = document.getElementById('tab-portfolio-btn');

const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const panelPortfolio = document.getElementById('panel-portfolio');

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

function drawJoint(point, color, ctx = canvasCtx) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawBone(p1, p2, color, ctx = canvasCtx) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.stroke();
}

function drawSkeletalFramework(joints, ctx = canvasCtx) {
  if (!joints) return;
  const {
    shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
    shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
    head_top
  } = joints;

  // 1. Draw Bones
  drawBone(shoulder_l, shoulder_r, '#FFFFFF', ctx); 
  drawBone(hip_l, hip_r, '#FFFFFF', ctx); 
  drawBone(shoulder_l, hip_l, '#FFFFFF', ctx); 
  drawBone(shoulder_r, hip_r, '#FFFFFF', ctx); 

  // Left Arm & Leg
  drawBone(shoulder_l, elbow_l, '#FFFFFF', ctx); 
  drawBone(elbow_l, wrist_l, '#FFFFFF', ctx); 
  drawBone(hip_l, knee_l, '#FFFFFF', ctx); 
  drawBone(knee_l, ankle_l, '#FFFFFF', ctx); 
  drawBone(ankle_l, heel_l, '#FFFFFF', ctx); 
  drawBone(heel_l, toe_l, '#FFFFFF', ctx); 

  // Right Arm & Leg
  drawBone(shoulder_r, elbow_r, '#FFFFFF', ctx); 
  drawBone(elbow_r, wrist_r, '#FFFFFF', ctx); 
  drawBone(hip_r, knee_r, '#FFFFFF', ctx); 
  drawBone(knee_r, ankle_r, '#FFFFFF', ctx); 
  drawBone(ankle_r, heel_r, '#FFFFFF', ctx); 
  drawBone(heel_r, toe_r, '#FFFFFF', ctx); 

  // 2. Draw Joints (Always renders as vibrant glowing white with a dark border)
  drawJoint(shoulder_l, '#ffffff', ctx);
  drawJoint(shoulder_r, '#ffffff', ctx);
  drawJoint(elbow_l, '#ffffff', ctx);
  drawJoint(elbow_r, '#ffffff', ctx);
  drawJoint(wrist_l, '#ffffff', ctx);
  drawJoint(wrist_r, '#ffffff', ctx);
  drawJoint(hip_l, '#ffffff', ctx);
  drawJoint(hip_r, '#ffffff', ctx);
  drawJoint(knee_l, '#ffffff', ctx);
  drawJoint(knee_r, '#ffffff', ctx);
  drawJoint(ankle_l, '#ffffff', ctx);
  drawJoint(ankle_r, '#ffffff', ctx);
  drawJoint(toe_l, '#ffffff', ctx);
  drawJoint(toe_r, '#ffffff', ctx);
  
  if (head_top) {
    drawJoint(head_top, '#ffffff', ctx);
  }
}

export function drawFullSkeletalMesh(landmarks, ctx = canvasCtx) {
  if (!landmarks || landmarks.length < 33) return;

  // 1. Draw thin, semi-transparent skeletal mesh connections
  ctx.beginPath();
  POSE_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2) {
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
  });
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)'; // Sleek translucent indigo vector line
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 2. Draw all 33 pose landmark nodes in vibrant white with high-contrast outlines
  landmarks.forEach((p, idx) => {
    if (!p) return;

    // Render glowing nodes
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff'; // Vibrant glowing white
    ctx.fill();
    ctx.strokeStyle = '#0f172a'; // High contrast dark slate outline
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function drawAngleBadge(ctx, point, value, color) {
  if (!point || value === undefined || value === null || isNaN(value)) return;

  ctx.save();
  ctx.font = 'bold 11px sans-serif';
  const text = `${Math.round(value)}°`;
  const paddingX = 6;
  const paddingY = 4;
  const textWidth = ctx.measureText(text).width;
  const bgW = textWidth + paddingX * 2;
  const bgH = 14 + paddingY * 2;

  // Render offset to the side of the joint
  const offsetX = 15;
  const offsetY = -10;
  const badgeX = point.x + offsetX;
  const badgeY = point.y + offsetY;

  // Badge background (dark glassmorphism)
  ctx.fillStyle = 'rgba(15, 22, 38, 0.85)';
  ctx.strokeStyle = color || '#00e5ff';
  ctx.lineWidth = 1.5;

  // Drop shadow/glow
  ctx.shadowColor = color || '#00e5ff';
  ctx.shadowBlur = 4;

  drawRoundedRect(ctx, badgeX, badgeY, bgW, bgH, 4);
  ctx.fill();
  ctx.stroke();

  // Draw text
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, badgeX + paddingX, badgeY + paddingY);
  ctx.restore();
}

function drawValgusBadge(ctx, point, value) {
  if (!point || value === undefined || value === null || isNaN(value)) return;
  
  ctx.save();
  ctx.font = 'bold 10px sans-serif';
  const text = `VALGUS: ${value.toFixed(1)}°`;
  const paddingX = 6;
  const paddingY = 4;
  const textWidth = ctx.measureText(text).width;
  const bgW = textWidth + paddingX * 2;
  const bgH = 12 + paddingY * 2;

  // Draw below the knee
  const offsetX = -bgW / 2;
  const offsetY = 15;
  const badgeX = point.x + offsetX;
  const badgeY = point.y + offsetY;

  ctx.fillStyle = 'rgba(15, 22, 38, 0.9)';
  ctx.strokeStyle = '#BA0C2F'; // Scarlet/Crimson glow for valgus alert
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#BA0C2F';
  ctx.shadowBlur = 6;

  drawRoundedRect(ctx, badgeX, badgeY, bgW, bgH, 4);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ef4444'; // Bright scarlet red
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, badgeX + paddingX, badgeY + paddingY + 1);
  ctx.restore();
}

export function drawHandMesh(multiHandLandmarks, multiHandedness) {
  if (!multiHandLandmarks || !Array.isArray(multiHandLandmarks)) return;

  multiHandLandmarks.forEach((landmarks, handIdx) => {
    if (!landmarks || !Array.isArray(landmarks) || landmarks.length < 21) return;
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
        canvasCtx.fillStyle = '#ffffff'; // Vibrant glowing white
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#0f172a'; // High contrast dark slate outline
        canvasCtx.lineWidth = 1.5;
        canvasCtx.stroke();
        return;
      }

      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 2.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = '#ffffff'; // Vibrant glowing white
      canvasCtx.fill();
      canvasCtx.strokeStyle = '#0f172a'; // High contrast dark slate outline
      canvasCtx.lineWidth = 1.0;
      canvasCtx.stroke();
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
      canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.25)'; // Subtle glowing white outer halo
      canvasCtx.fill();

      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = '#ffffff'; // Vibrant glowing white
      canvasCtx.fill();
      canvasCtx.strokeStyle = '#0f172a'; // High contrast dark slate outline
      canvasCtx.lineWidth = 1.5;
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
  drawJoint(feet_center, '#FFFFFF');
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
  if (state.activeCalMethod === 'height') return;
  if (!calculated || !calculated.liveMetrics) return;
  const liveMetrics = calculated.liveMetrics;

  const scale = ctx.canvas.width / 640;
  
  // Card dimensions
  const cardW = 190 * scale;
  const cardH = 168 * scale;
  const cardX = ctx.canvas.width - cardW - 20 * scale;
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
  const subjectName = getActiveProfileName(false) || "Subject";
  
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

    // Run core metrics calculation during frame-by-frame preprocessing (and other phases) to ensure peaks are fully analyzed
    if (results && results.poseLandmarks) {
      calculated = calculatePoseMetrics(results);
      if (calculated) {
        const kneeAngleL = calculated.kneeAngleL;
        const kneeAngleR = calculated.kneeAngleR;
        const hipAngleL = calculated.hipAngleL;
        const hipAngleR = calculated.hipAngleR;
        const ankleAngleL = calculated.ankleAngleL;
        const ankleAngleR = calculated.ankleAngleR;

        const kneeMobL = 180 - (kneeAngleL || 180);
        const kneeMobR = 180 - (kneeAngleR || 180);
        const hipMobL = 180 - (hipAngleL || 180);
        const hipMobR = 180 - (hipAngleR || 180);
        const ankleMobL = Math.max(0, 115 - (ankleAngleL || 115));
        const ankleMobR = Math.max(0, 115 - (ankleAngleR || 115));

        state.squatPeaks = getDefaultSquatPeaks(state.squatPeaks);

        if (state.squatTestingSide === 'left') {
          state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
          state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
          state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
        } else if (state.squatTestingSide === 'right') {
          state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
          state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
          state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
        } else if (state.squatTestingSide === 'frontal') {
          if (state.allowFrontalUpdateL) {
            state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
            state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
            state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
          }
          if (state.allowFrontalUpdateR) {
            state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
            state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
            state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
          }
          
          // Cache jointsOverhead directly from analyzed static frame results
          state.jointsOverhead = JSON.parse(JSON.stringify(calculated));
        }

        // Track frontal Knee Valgus/Cave-In peaks during active squat movement (knee flexion >= 30 degrees)
        if (state.squatTestingSide === 'frontal') {
          const valgus = calculateValgusFromJoints(calculated);
          const pctL = valgus.pctL;
          const pctR = valgus.pctR;
          if (kneeMobL >= 30 || kneeMobR >= 30) {
            if (kneeMobL >= 30) {
              state.squatPeaks.maxKneeCaveL = Math.max(state.squatPeaks.maxKneeCaveL || 0, pctL);
            }
            if (kneeMobR >= 30) {
              state.squatPeaks.maxKneeCaveR = Math.max(state.squatPeaks.maxKneeCaveR || 0, pctR);
            }
          }
        }
      }
    }

    // Early return during preprocessing to prevent drawing on the dashboard canvas
    if (state.isExportingFrameByFrame) {
      return;
    }

    // Routing intercept: if we are processing a video inside the details modal, route to drawModalVideoPoseOverlay
    if (state.activeModalVideoProcessing) {
      drawModalVideoPoseOverlay(results);
      return;
    }

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

    // Draw skeletal bones and joint points
    drawSkeletalFramework(calculated);

    if (state.pixelsPerCm && liveMetrics) {
      // Draw head top indicator node
      drawJoint(head_top, '#FFFFFF');

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
      } else if (state.squatTestingSide === 'right') {
        state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
        state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
        state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
      } else if (state.squatTestingSide === 'frontal') {
        if (state.allowFrontalUpdateL) {
          state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
          state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
          state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
        }
        if (state.allowFrontalUpdateR) {
          state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
          state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
          state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
        }
        
        // Cache jointsOverhead directly from analyzed static frame results
        state.jointsOverhead = JSON.parse(JSON.stringify(calculated));
        if (!isVideo) {
          state.imageSquatFrontal = state.uploadedMediaUrl || (results && results.image && results.image.src) || state.imageSquatFrontal;
        }
      }

      if (state.currentMode === 'squat') {
        updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR, calculated);
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
      state.lastCalculatedResults = calculated;
      if (isStaticImage) {
        state.lastProcessedScaleFactor = state.pixelsPerCm;
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

      // Draw skeletal bones and joint points
      drawSkeletalFramework(calculated);

      // --- NEW: DIGITAL FLOATING BADGES & VALGUS ALERTS ---
      drawAngleBadge(canvasCtx, knee_l, kneeAngleL, '#10b981');
      drawAngleBadge(canvasCtx, hip_l, hipAngleL, '#d4a017');
      drawAngleBadge(canvasCtx, ankle_l, ankleAngleL, '#06b6d4');

      drawAngleBadge(canvasCtx, knee_r, kneeAngleR, '#10b981');
      drawAngleBadge(canvasCtx, hip_r, hipAngleR, '#d4a017');
      drawAngleBadge(canvasCtx, ankle_r, ankleAngleR, '#06b6d4');

      // Frontal Knee Valgus Badge
      const valgus = calculateValgusFromJoints(calculated);
      const kneeMobL = 180 - (kneeAngleL || 180);
      const kneeMobR = 180 - (kneeAngleR || 180);
      if (kneeMobL >= 15 && valgus.pctL > 4.0) {
        drawValgusBadge(canvasCtx, knee_l, valgus.pctL);
      }
      if (kneeMobR >= 15 && valgus.pctR > 4.0) {
        drawValgusBadge(canvasCtx, knee_r, valgus.pctR);
      }

      // Draw live stats HUD card unconditionally of calibration
      drawLiveStatsCard(canvasCtx, calculated);

      // Update real-time measurements display
      kneeAngleLDisp.textContent = `${kneeAngleL}°`;
      kneeAngleRDisp.textContent = `${kneeAngleR}°`;
      hipAngleLDisp.textContent = `${hipAngleL}°`;
      hipAngleRDisp.textContent = `${hipAngleR}°`;
      elbowAngleLDisp.textContent = `${elbowAngleL}°`;
      elbowAngleRDisp.textContent = `${elbowAngleR}°`;

      // Overhead Squat Mobility calculations
      const hipMobL = 180 - (hipAngleL || 180);
      const hipMobR = 180 - (hipAngleR || 180);
      const ankleMobL = Math.max(0, 115 - (ankleAngleL || 115));
      const ankleMobR = Math.max(0, 115 - (ankleAngleR || 115));

      // Always update peaks state when a valid frame is processed in squat mode
      if (state.currentMode === 'squat') {
        if (state.squatTestingSide === 'left') {
          state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
          state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
          state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
        } else if (state.squatTestingSide === 'right') {
          state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
          state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
          state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
        } else if (state.squatTestingSide === 'frontal') {
          if (state.allowFrontalUpdateL) {
            state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
            state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
            state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
          }
          if (state.allowFrontalUpdateR) {
            state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
            state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
            state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
          }
        }
      }

      // If in squat mode, update the Overhead Squat dashboard UI
      if (state.currentMode === 'squat') {
        updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR, calculated);
      } else if (state.currentMode === 'shoulder_flexion') {
        const side = state.shoulderTestingSide || 'left';
        const angleInfo = getShoulderWristAngle(results.poseLandmarks, side);
        if (angleInfo) {
          state.lastCalculatedShoulderAngle = angleInfo.angleDeg;
          if (side === 'left') {
            if (shoulderLiveAngleL) shoulderLiveAngleL.textContent = `${Math.round(angleInfo.angleDeg)}°`;
            if (shoulderLiveAngleR) shoulderLiveAngleR.textContent = '--';
          } else {
            if (shoulderLiveAngleR) shoulderLiveAngleR.textContent = `${Math.round(angleInfo.angleDeg)}°`;
            if (shoulderLiveAngleL) shoulderLiveAngleL.textContent = '--';
          }

          if (shoulderStatusVal) {
            shoulderStatusVal.textContent = 'Active Tracking';
            shoulderStatusVal.className = 'text-emerald';
          }

          // 1. Draw vertical reference line straight down from the shoulder
          canvasCtx.save();
          canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          canvasCtx.setLineDash([5, 5]);
          canvasCtx.lineWidth = 1.5;
          canvasCtx.beginPath();
          canvasCtx.moveTo(angleInfo.shoulder.x, angleInfo.shoulder.y);
          canvasCtx.lineTo(angleInfo.shoulder.x, angleInfo.shoulder.y + 120); // vertical down
          canvasCtx.stroke();
          canvasCtx.restore();

          // 2. Draw angle arc at the shoulder
          const r = 40;
          canvasCtx.save();
          canvasCtx.strokeStyle = '#BA0C2F'; // Scarlet red
          canvasCtx.lineWidth = 2.5;
          canvasCtx.beginPath();
          const armAngleRad = Math.atan2(angleInfo.wrist.y - angleInfo.shoulder.y, angleInfo.wrist.x - angleInfo.shoulder.x);
          // straight down in canvas coordinates is Math.PI / 2
          canvasCtx.arc(angleInfo.shoulder.x, angleInfo.shoulder.y, r, Math.PI / 2, armAngleRad, armAngleRad < Math.PI / 2);
          canvasCtx.stroke();
          canvasCtx.restore();

          // 3. Draw a premium crimson glowing line for the active arm (shoulder to wrist)
          canvasCtx.save();
          canvasCtx.strokeStyle = '#BA0C2F';
          canvasCtx.lineWidth = 4;
          canvasCtx.shadowColor = '#BA0C2F';
          canvasCtx.shadowBlur = 10;
          canvasCtx.beginPath();
          canvasCtx.moveTo(angleInfo.shoulder.x, angleInfo.shoulder.y);
          canvasCtx.lineTo(angleInfo.wrist.x, angleInfo.wrist.y);
          canvasCtx.stroke();
          canvasCtx.restore();

          // 4. Draw floating angle badge near the wrist
          drawAngleBadge(canvasCtx, angleInfo.wrist, Math.round(angleInfo.angleDeg), '#BA0C2F');

          // Real-time Peak and Snapshot Tracking for Live Camera Stream has been transitioned to manual Capture Flexion Snapshot button-click
          updateShoulderSidebarUI();
        } else {
          if (shoulderStatusVal) {
            shoulderStatusVal.textContent = 'Offline';
            shoulderStatusVal.className = 'text-slate';
          }
        }
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
        drawJoint(head_top, '#FFFFFF');

        // Draw the live ruler graphics
        drawRulerGraphics(ruler_x, head_top, ground_y, liveMetrics.live_height, live_feet_inches_str, heel_l, heel_r);

        // Draw active pose badge (only on camera/images, remove from video as requested)
        const isVideo = state.isUploadedMedia && state.uploadedMediaType === 'video';
        if (liveMetrics.pose && !isVideo) {
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
    
    // Retrieve active subject name from profile or input fallback
    const subjectName = getActiveProfileName(false);
    
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
  const subjectName = getActiveProfileName(false);
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

    // Draw skeletal bones and joint points
    drawSkeletalFramework(state.frozenJoints);

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
      // Keep tick active for uploaded media (video/image) to cleanly manage canvas clears on pause
      shouldRender = true;
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

          // Update playout progress bar live!
          const duration = uploadedVideo.duration || 1;
          const playoutPercent = Math.min(100, (curTime / duration) * 100);
          showExportProgressOverlay(playoutPercent, 2);
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
      } else if (state.isUploadedMedia && state.uploadedMediaType === 'video') {
        // Standard playback of imported/uploaded video: completely clean, no overlays
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.restore();
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

export async function startCamera(preferredDeviceId = null) {
  if (typeof preferredDeviceId !== 'string') {
    preferredDeviceId = null;
  }
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
    const primaryVideoConstraints = {
      width: { min: 1280, ideal: 1920 },
      height: { min: 720, ideal: 1080 }
    };
    if (preferredDeviceId) {
      primaryVideoConstraints.deviceId = { exact: preferredDeviceId };
    } else {
      primaryVideoConstraints.facingMode = state.currentFacingMode;
    }

    const fallbackVideoConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 }
    };
    if (preferredDeviceId) {
      fallbackVideoConstraints.deviceId = { exact: preferredDeviceId };
    } else {
      fallbackVideoConstraints.facingMode = state.currentFacingMode;
    }

    try {
      // Attempt HD/FHD stream for high tracking accuracy (min 720p, ideal 1080p)
      state.activeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: primaryVideoConstraints
      });
    } catch (hdErr) {
      console.warn("HD/FHD camera request failed, falling back to 640x480:", hdErr);
      // Fallback to standard definition if HD is overconstrained or unsupported
      state.activeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: fallbackVideoConstraints
      });
    }
    
    videoElement.srcObject = state.activeStream;

    // Detect the active device settings and enumerate devices
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.cameraDevices = devices.filter(d => d.kind === 'videoinput' && d.deviceId);

      const activeTrack = state.activeStream.getVideoTracks()[0];
      if (activeTrack) {
        const settings = activeTrack.getSettings();
        if (settings.deviceId) {
          const idx = state.cameraDevices.findIndex(d => d.deviceId === settings.deviceId);
          if (idx !== -1) {
            state.activeCameraIndex = idx;
          }
        }
        
        if (settings.facingMode) {
          state.currentFacingMode = settings.facingMode;
        } else {
          // Fallback check based on device label
          const currentDevice = state.activeCameraIndex !== -1 ? state.cameraDevices[state.activeCameraIndex] : null;
          if (currentDevice && currentDevice.label) {
            const label = currentDevice.label.toLowerCase();
            if (label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('outward')) {
              state.currentFacingMode = "environment";
            } else if (label.includes('front') || label.includes('user') || label.includes('selfie') || label.includes('integrated') || label.includes('facetime') || label.includes('internal') || label.includes('inward') || label.includes('webcam')) {
              state.currentFacingMode = "user";
            } else {
              // Retain current facing mode if we cannot determine, defaulting to user
              if (!state.currentFacingMode) {
                state.currentFacingMode = "user";
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("Could not query active camera settings or enumerate devices:", e);
    }

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
      
      // Clear scale metrics cache on camera feed dimensions update
      state.lastProcessedScaleFactor = null;
      state.lastCalculatedResults = null;
      
      const viewport = document.querySelector('.viewport');
      if (viewport) {
        viewport.style.aspectRatio = `${w} / ${h}`;
      }
      
      console.log(`[CameraFeed] Stream metadata loaded. Coordinates calibrated to ${w}x${h}`);
      
      videoElement.play();
      statusElement.textContent = "Camera active. Syncing with computer vision models...";
    };

    videoElement.srcObject = state.activeStream;
    // Mirror the view only for front/user camera
    videoElement.classList.toggle('mirror-x', state.currentFacingMode === "user");

    // Throttled concurrent model inference loop (runs in background)
    async function cameraInferenceLoop() {
      if (!state.activeStream || videoElement.paused || videoElement.ended) {
        state.isCameraInferenceLoopRunning = false;
        return;
      }
      state.isCameraInferenceLoopRunning = true;

      const startTime = Date.now();
      try {
          // Sequential model calls - avoids Emscripten concurrent initialization/runtime namespace memory collision errors!
          if (!state.activeModalVideoProcessing) {
            await pose.send({ image: videoElement });
            await hands.send({ image: videoElement });
          }
        }
      catch (err) {
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
        if (side === 'frontal') {
          statusElement.textContent = `Active squat tracking. Position subject facing front for the FRONTAL view.`;
        } else {
          statusElement.textContent = `Active squat tracking. Position subject profile view for the ${side.toUpperCase()} side.`;
        }
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

export function showImportDestinationModal(file) {
  return new Promise((resolve) => {
    // 1. Create overlay backdrop
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(10, 10, 15, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s ease;
      font-family: 'Inter', sans-serif;
    `;

    // Calculate file size in MB
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);

    // 2. Create modal card container
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(20, 20, 30, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      width: 500px;
      max-width: 90%;
      padding: 28px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      transform: scale(0.92);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      color: #fff;
    `;

    // 3. Create content
    card.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px; text-align: center;">
        <h2 style="font-size: 20px; font-weight: 700; margin: 0; background: linear-gradient(135deg, #818cf8, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">📥 Import Video Recording</h2>
        <p style="font-size: 13px; color: #9ca3af; margin: 0; word-break: break-all;">${file.name} (${fileSizeMB} MB)</p>
      </div>
      
      <p style="font-size: 14px; font-weight: 600; color: #e5e7eb; margin: 0 0 14px 0;">Select destination for this recording:</p>
      
      <div id="import-options-container" style="display: flex; flex-direction: column; gap: 10px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
        <!-- Option 1: Saved Video Recordings Playlist -->
        <div class="import-opt-card" data-value="playlist" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">📂 Saved Video Recordings Playlist</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Adds video to subject's saved playlist without updating active test slots.</div>
          </div>
        </div>

        <!-- Option 2: Left Overhead Squat -->
        <div class="import-opt-card" data-value="squat-l" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">🏋️ Left Overhead Squat Video</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Assigns to Left sagittal view squat slot and calculates peak mobility stats.</div>
          </div>
        </div>

        <!-- Option 3: Right Overhead Squat -->
        <div class="import-opt-card" data-value="squat-r" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">🏋️ Right Overhead Squat Video</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Assigns to Right sagittal view squat slot and calculates peak mobility stats.</div>
          </div>
        </div>

        <!-- Option 4: Frontal Overhead Squat -->
        <div class="import-opt-card" data-value="squat-frontal" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">🏋️ Frontal Overhead Squat Video</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Assigns to Frontal view squat slot and calculates peak knee cave-in stats.</div>
          </div>
        </div>

        <!-- Option 5: Left Shoulder Flexion -->
        <div class="import-opt-card" data-value="shoulder-l" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">💪 Left Shoulder Flexion Video</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Assigns to Left Shoulder Flexion lowering slot and computes peak mobility excursion.</div>
          </div>
        </div>

        <!-- Option 6: Right Shoulder Flexion -->
        <div class="import-opt-card" data-value="shoulder-r" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">💪 Right Shoulder Flexion Video</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Assigns to Right Shoulder Flexion lowering slot and computes peak mobility excursion.</div>
          </div>
        </div>

        <!-- Option 7: Analyze Video (No save) -->
        <div class="import-opt-card" data-value="analyze-only" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
          <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
            <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">📺 Analyze Video (Don't Save)</div>
            <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Loads transiently on the viewport for temporary analysis without database commit.</div>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
        <button id="import-btn-cancel" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); color: #9ca3af; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s ease;">Cancel</button>
        <button id="import-btn-confirm" disabled style="background: rgba(255, 255, 255, 0.03); border: none; color: rgba(255, 255, 255, 0.35); padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: not-allowed; transition: all 0.2s ease;">Confirm Import</button>
      </div>
    `;

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    // Fade in
    setTimeout(() => {
      backdrop.style.opacity = '1';
      card.style.transform = 'scale(1)';
    }, 10);

    let selectedValue = null;
    const optionCards = card.querySelectorAll('.import-opt-card');
    const confirmBtn = card.querySelector('#import-btn-confirm');
    const cancelBtn = card.querySelector('#import-btn-cancel');

    // Add interactivity to option cards
    optionCards.forEach((optCard) => {
      // Hover effects
      optCard.addEventListener('mouseenter', () => {
        if (selectedValue !== optCard.dataset.value) {
          optCard.style.background = 'rgba(255, 255, 255, 0.06)';
          optCard.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }
      });
      optCard.addEventListener('mouseleave', () => {
        if (selectedValue !== optCard.dataset.value) {
          optCard.style.background = 'rgba(255, 255, 255, 0.02)';
          optCard.style.borderColor = 'rgba(255, 255, 255, 0.06)';
        }
      });

      // Click handler
      optCard.addEventListener('click', () => {
        selectedValue = optCard.dataset.value;

        // Update all options' styling
        optionCards.forEach((otherCard) => {
          const radio = otherCard.querySelector('.import-radio');
          const dot = otherCard.querySelector('.import-radio-dot');
          if (otherCard.dataset.value === selectedValue) {
            otherCard.style.background = 'rgba(129, 140, 248, 0.12)';
            otherCard.style.borderColor = '#818cf8';
            otherCard.style.boxShadow = '0 0 12px rgba(129, 140, 248, 0.2)';
            radio.style.borderColor = '#818cf8';
            radio.style.background = '#818cf8';
            dot.style.display = 'block';
          } else {
            otherCard.style.background = 'rgba(255, 255, 255, 0.02)';
            otherCard.style.borderColor = 'rgba(255, 255, 255, 0.06)';
            otherCard.style.boxShadow = 'none';
            radio.style.borderColor = 'rgba(255, 255, 255, 0.25)';
            radio.style.background = 'transparent';
            dot.style.display = 'none';
          }
        });

        // Enable confirm button
        confirmBtn.removeAttribute('disabled');
        confirmBtn.style.background = 'linear-gradient(135deg, #818cf8, #ec4899)';
        confirmBtn.style.color = '#fff';
        confirmBtn.style.cursor = 'pointer';
        confirmBtn.style.boxShadow = '0 4px 12px rgba(129, 140, 248, 0.25)';
      });
    });

    // Close function
    function closeWithResult(result) {
      backdrop.style.opacity = '0';
      card.style.transform = 'scale(0.92)';
      setTimeout(() => {
        backdrop.remove();
        resolve(result);
      }, 300);
    }

    confirmBtn.addEventListener('click', () => {
      if (selectedValue) {
        closeWithResult(selectedValue);
      }
    });

    cancelBtn.addEventListener('click', () => {
      closeWithResult(null);
    });

    // Close on backdrop click (cancel)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeWithResult(null);
      }
    });
  });
}

export async function saveImportedVideoToProfile(file, target, durationSec) {
  try {
    if (!state.activeProfileId) return null;
    const profile = await snapshotStore.getProfile(state.activeProfileId);
    if (!profile) return null;

    profile.videos = profile.videos || [];
    
    // Determine the label based on target
    let labelPrefix = "Imported Video";
    if (target === 'squat-l') labelPrefix = "Left Overhead Squat";
    else if (target === 'squat-r') labelPrefix = "Right Overhead Squat";
    else if (target === 'squat-frontal') labelPrefix = "Frontal Overhead Squat";
    else if (target === 'playlist') labelPrefix = "Imported Recording";

    const fileExt = file.name.split('.').pop() || 'mp4';

    const videoEntry = {
      id: Date.now(),
      name: `${labelPrefix} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`,
      blob: file, // File is a subclass of Blob, so it saves perfectly in IndexedDB
      timestamp: Date.now(),
      duration: durationSec,
      fileExt: fileExt
    };

    profile.videos.push(videoEntry);
    state.videos = profile.videos;

    // Link video to active session if it's a squat target
    const profileMigrated = ensureProfileSessions(profile);
    const activeSessionId = state.activeSessionId || profileMigrated.activeSessionId || (profileMigrated.sessions && profileMigrated.sessions[0] ? profileMigrated.sessions[0].id : null);
    if (activeSessionId) {
      const activeSession = profileMigrated.sessions.find(s => String(s.id) === String(activeSessionId));
      if (activeSession) {
        if (target === 'squat-l') {
          activeSession.videoSquatL = videoEntry;
          state.videoSquatL = videoEntry;
        } else if (target === 'squat-r') {
          activeSession.videoSquatR = videoEntry;
          state.videoSquatR = videoEntry;
        } else if (target === 'squat-frontal') {
          activeSession.videoSquatFrontal = videoEntry;
          state.videoSquatFrontal = videoEntry;
        }
      }
    }

    await snapshotStore.saveProfile(profileMigrated);
    
    // Update local cache
    state.allProfiles = await snapshotStore.getAllProfiles();
    if (state.activeProfileId === profile.id) {
      await loadProfileIntoState(profile.id);
    }
    
    console.log(`[VideoImport] Successfully imported video to profile: ${profile.name}, target: ${target}`);
    return videoEntry;
  } catch (err) {
    console.error("[VideoImport] Failed to save imported video:", err);
    alert("Could not save the imported video to profile database.");
    return null;
  }
}

export function showAnalysisProgressOverlay(percent) {
  const viewport = document.querySelector('.viewport');
  if (!viewport) return;

  let overlay = document.getElementById('analysis-progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'analysis-progress-overlay';
    overlay.className = 'export-progress-overlay'; // Reuses existing styles!
    overlay.innerHTML = `
      <div class="export-progress-card">
        <div class="export-progress-spinner">
          <svg class="spinner-svg" viewBox="0 0 50 50">
            <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
          </svg>
        </div>
        <div class="export-progress-title">Biomechanical Video Scan</div>
        <div class="export-progress-subtitle">Extracting peak athletic mobility...</div>
        <div class="export-progress-bar-container">
          <div class="export-progress-bar-fill" id="analysis-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="export-progress-text" id="analysis-progress-text">0% Scan Completed</div>
        <div class="export-progress-warning">
          Please wait while our computer vision model parses the imported video frames for joint peaks and range of motion stats.
        </div>
      </div>
    `;
    viewport.appendChild(overlay);
  }

  // Update percentages
  const fill = document.getElementById('analysis-progress-fill');
  const text = document.getElementById('analysis-progress-text');
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${Math.round(percent)}% Scan Completed`;
}

export function hideAnalysisProgressOverlay() {
  const overlay = document.getElementById('analysis-progress-overlay');
  if (overlay) {
    overlay.remove();
  }
}

export async function scanVideoForSquatPeaks(targetSide, durationSec) {
  if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || !uploadedVideo) {
    return;
  }

  console.log(`[PeakAnalysis] Starting frame analysis for side: ${targetSide}, duration: ${durationSec}s`);
  
  // Set flag to prevent background loop collision
  state.isExportingFrameByFrame = true;
  updateRecordButtonUI();

  // Temporarily pause main video play
  uploadedVideo.pause();

  // Store original video play rates & looping
  const wasLooping = uploadedVideo.loop;
  const wasPlaybackRate = uploadedVideo.playbackRate;

  uploadedVideo.loop = false;
  uploadedVideo.playbackRate = 1.0;

  // Initialize progress bar
  showAnalysisProgressOverlay(0);

  // Reset the specific target side's peak values so we scan from a clean state
  if (targetSide === 'squat-l') {
    state.squatPeaks.kneeL = 0;
    state.squatPeaks.hipL = 0;
    state.squatPeaks.ankleL = 0;
  } else if (targetSide === 'squat-r') {
    state.squatPeaks.kneeR = 0;
    state.squatPeaks.hipR = 0;
    state.squatPeaks.ankleR = 0;
  } else if (targetSide === 'squat-frontal') {
    state.squatPeaks.maxKneeCaveL = 0;
    state.squatPeaks.maxKneeCaveR = 0;
    state.squatPeaks.valgusFirstTimestamp = null;
    state.squatPeaks.valgusPeakTimestamp = null;
    state.squatPeaks.valgusPeakScore = 0;
  }

  const fps = 10; // 10 samples per second is extremely high resolution for slow-moving squats and super fast
  const step = 1 / fps;
  let currentTime = 0;

  // Promise-based seek helper
  function seekVideoTo(time) {
    return new Promise((resolve) => {
      let resolved = false;
      function onSeeked() {
        if (!resolved) {
          resolved = true;
          uploadedVideo.removeEventListener('seeked', onSeeked);
          setTimeout(resolve, 25);
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
    while (currentTime <= durationSec && state.isExportingFrameByFrame) {
      // 1. Seek playhead to currentTime
      await seekVideoTo(currentTime);

      // 2. Erase previous cache frames
      state.latestPoseResults = null;
      state.latestHandResults = null;

      // 3. Process video frame via MediaPipe models
      try {
        await pose.send({ image: uploadedVideo });
      } catch (err) {
        console.warn(`[PeakAnalysis] MediaPipe parsing error at t=${currentTime.toFixed(2)}s:`, err);
      }

      // 4. Update the HUD progress
      const progressPercent = Math.min(100, (currentTime / durationSec) * 100);
      showAnalysisProgressOverlay(progressPercent);
      statusElement.textContent = `⚙️ Parsing joint coordinates... ${progressPercent.toFixed(0)}%`;

      // 5. Step forward
      currentTime += step;
    }

    // Final scan of the absolute end of the video
    if (currentTime - step < durationSec && state.isExportingFrameByFrame) {
      await seekVideoTo(durationSec);
      state.latestPoseResults = null;
      try {
        await pose.send({ image: uploadedVideo });
      } catch (e) {}
    }

    // 6. Complete and clean up
    if (state.isExportingFrameByFrame) {
      // Reset playhead to the beginning
      await seekVideoTo(0);
      
      hideAnalysisProgressOverlay();
      state.isExportingFrameByFrame = false;
      updateRecordButtonUI();

      // Commit the updated peak metrics to the player database
      await autoSyncToActiveProfile();

      // Update sidebar visual displays
      updateSquatSideUI();
      updateSquatDashboardOffline();

      // Restore original video state
      uploadedVideo.loop = wasLooping;
      uploadedVideo.playbackRate = wasPlaybackRate;
      
      // Restart standard loop
      uploadedVideo.play().catch(err => console.error("[PeakAnalysis] Play resume failed:", err));
      
      statusElement.textContent = "✅ Video import & peak analysis complete! Peak mobility stats have been updated.";
    }
  } catch (err) {
    console.error("[PeakAnalysis] Background scan failed:", err);
    statusElement.textContent = "❌ Biomechanical background scan failed.";
    hideAnalysisProgressOverlay();
    state.isExportingFrameByFrame = false;
    updateRecordButtonUI();
    
    // Restore original video state
    uploadedVideo.loop = wasLooping;
    uploadedVideo.playbackRate = wasPlaybackRate;
    uploadedVideo.play().catch(e => {});
  }
}

export async function handleUploadedFile(file) {
  if (state.isExportingFrameByFrame || state.isRecordingPlayLoop) {
    alert("An export is currently in progress. Please wait until the export completes before uploading new files.");
    return;
  }
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  
  if (isVideo) {
    if (!state.activeProfileId) {
      alert("Please select or create a player profile in the dashboard first to import video recordings!");
      return;
    }

    const selectedTarget = await showImportDestinationModal(file);
    if (!selectedTarget) {
      console.log("[VideoImport] User cancelled video import.");
      return;
    }

    // Store target temporarily
    state.pendingImportTarget = selectedTarget;
  }

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
      exportCombinedBtn.style.display = 'none';
    } else {
      exportCombinedBtn.style.display = 'block';
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
      // Attach event listeners BEFORE setting the source to prevent race-conditions with cached/local media loading!
      uploadedVideo.onloadedmetadata = async () => {
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

        const importTarget = state.pendingImportTarget;
        if (importTarget && importTarget !== 'analyze-only') {
          // Clear it immediately to prevent duplicate runs
          state.pendingImportTarget = null;

          statusElement.textContent = "📥 Preparing imported video for high-fidelity export and peak analysis...";
          
          // Ensure state.squatPeaks is initialized
          state.squatPeaks = getDefaultSquatPeaks(state.squatPeaks);

          // Configure state based on target to guide the pre-processing engine and layout templates
          if (importTarget === 'squat-l' || importTarget === 'squat-r' || importTarget === 'squat-frontal') {
            state.currentMode = 'squat';
            if (importTarget === 'squat-l') {
              state.squatTestingSide = 'left';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
              state.squatPeaks.kneeL = 0;
              state.squatPeaks.hipL = 0;
              state.squatPeaks.ankleL = 0;
              state.imageSquatL = null; // Clear pre-existing static overlay
            } else if (importTarget === 'squat-r') {
              state.squatTestingSide = 'right';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
              state.squatPeaks.kneeR = 0;
              state.squatPeaks.hipR = 0;
              state.squatPeaks.ankleR = 0;
              state.imageSquatR = null; // Clear pre-existing static overlay
            } else if (importTarget === 'squat-frontal') {
              state.squatTestingSide = 'frontal';
              // Allow updating left/right peak metrics during a frontal squat if they are currently 0 (missing)
              state.allowFrontalUpdateL = (!state.squatPeaks || state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0 && state.squatPeaks.ankleL === 0);
              state.allowFrontalUpdateR = (!state.squatPeaks || state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0 && state.squatPeaks.ankleR === 0);
              state.squatPeaks.maxKneeCaveL = 0;
              state.squatPeaks.maxKneeCaveR = 0;
              state.squatPeaks.valgusFirstTimestamp = null;
              state.squatPeaks.valgusPeakTimestamp = null;
              state.squatPeaks.valgusPeakScore = 0;
              state.imageSquatFrontal = null; // Clear pre-existing static overlay
            }

            // Sync the active mode and side selectors in the UI
            if (btnModeSquat) btnModeSquat.classList.add('active');
            if (btnModePosture) btnModePosture.classList.remove('active');
            if (squatSidebarContent) squatSidebarContent.classList.remove('hidden');
            if (postureSidebarContent) postureSidebarContent.classList.add('hidden');
            updateSquatSideUI();
          } else if (importTarget === 'shoulder-l' || importTarget === 'shoulder-r') {
            state.currentMode = 'shoulder_flexion';
            state.shoulderPeaks = getDefaultShoulderPeaks(state.shoulderPeaks);
            if (importTarget === 'shoulder-l') {
              state.shoulderTestingSide = 'left';
              state.shoulderPeaks.excursionL = 0;
              state.shoulderPeaks.startAngleL = null;
              state.shoulderPeaks.endAngleL = null;
              state.shoulderPeaks.jointsLStart = null;
              state.shoulderPeaks.jointsLEnd = null;
              state.imageShoulderLStart = null;
              state.imageShoulderLEnd = null;
            } else if (importTarget === 'shoulder-r') {
              state.shoulderTestingSide = 'right';
              state.shoulderPeaks.excursionR = 0;
              state.shoulderPeaks.startAngleR = null;
              state.shoulderPeaks.endAngleR = null;
              state.shoulderPeaks.jointsRStart = null;
              state.shoulderPeaks.jointsREnd = null;
              state.imageShoulderRStart = null;
              state.imageShoulderREnd = null;
            }

            // Sync the active mode and side selectors in the UI
            if (btnModeSquat) btnModeSquat.classList.remove('active');
            if (btnModePosture) btnModePosture.classList.remove('active');
            if (btnModeShoulder) btnModeShoulder.classList.add('active');
            if (squatSidebarContent) squatSidebarContent.classList.add('hidden');
            if (postureSidebarContent) postureSidebarContent.classList.add('hidden');
            if (shoulderSidebarContent) shoulderSidebarContent.classList.remove('hidden');

            // Highlight current shoulder testing side
            if (btnShoulderSideLeft && btnShoulderSideRight) {
              if (state.shoulderTestingSide === 'left') {
                btnShoulderSideLeft.classList.add('active');
                btnShoulderSideRight.classList.remove('active');
              } else {
                btnShoulderSideRight.classList.add('active');
                btnShoulderSideLeft.classList.remove('active');
              }
            }
            updateShoulderSidebarUI();
          } else if (importTarget === 'playlist') {
            state.currentMode = 'posture';
            if (btnModeSquat) btnModeSquat.classList.remove('active');
            if (btnModePosture) btnModePosture.classList.add('active');
            if (btnModeShoulder) btnModeShoulder.classList.remove('active');
            if (squatSidebarContent) squatSidebarContent.classList.add('hidden');
            if (postureSidebarContent) postureSidebarContent.classList.remove('hidden');
            if (shoulderSidebarContent) shoulderSidebarContent.classList.add('hidden');
          }

          // Trigger high-fidelity pre-processing + automatic playout export!
          setTimeout(() => {
            runVideoFramePreprocessing();
          }, 300);
        } else {
          // Normal transient run or cancel, just play
          state.pendingImportTarget = null;
          uploadedVideo.play();
          statusElement.textContent = "Uploaded video active. Syncing with computer vision models...";
        }
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

      uploadedVideo.src = objectURL;
      uploadedVideo.onerror = (e) => {
        console.error("[VideoImport] Video element encountered error loading source:", e);
      };
      uploadedVideo.load(); // Explicitly trigger HTML5 source reload!
      uploadedVideo.classList.remove('hidden');
      uploadedVideo.classList.add('video-visible');
      uploadedVideo.muted = true;
      uploadedVideo.loop = true;
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

      uploadedImage.src = objectURL;
      uploadedImage.classList.remove('hidden');
      uploadedImage.classList.add('video-visible');
    }
  }
}

export function startUploadedMediaLoop() {
  async function videoInferenceLoop() {
    if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || uploadedVideo.paused || uploadedVideo.ended || state.isRecordingPlayLoop || state.isExportingFrameByFrame || state.activeModalVideoProcessing) {
      state.isVideoInferenceLoopRunning = false;
      return;
    }
    state.isVideoInferenceLoopRunning = true;

    const startTime = Date.now();
    try {
      if (!state.isSnapshotFrozen) {

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

  // If it's a video, also kick off the background inference loop (disabled to prevent redundant real-time overlays)
  if (state.uploadedMediaType === 'video') {
    state.isVideoInferenceLoopRunning = false;
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

// Camera switch event listener for switching between front/back cameras (cycling all available cameras)
const cameraSwitchBtn = document.getElementById('camera-switch-btn');
if (cameraSwitchBtn) {
  cameraSwitchBtn.addEventListener('click', async () => {
    if (!state.activeStream) return;
    
    // Ensure we have up-to-date enumerated devices while the stream is active
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.cameraDevices = devices.filter(d => d.kind === 'videoinput' && d.deviceId);
    } catch (err) {
      console.warn("Could not enumerate devices on switch click:", err);
    }

    // Stop the active stream tracks first
    state.activeStream.getTracks().forEach(track => track.stop());
    state.activeStream = null;
    
    if (state.cameraDevices && state.cameraDevices.length > 1) {
      // Cycle through available cameras
      state.activeCameraIndex = (state.activeCameraIndex + 1) % state.cameraDevices.length;
      const nextDevice = state.cameraDevices[state.activeCameraIndex];
      await startCamera(nextDevice.deviceId);
    } else {
      // Toggle facing mode between user and environment as a robust fallback
      state.currentFacingMode = (state.currentFacingMode === "user") ? "environment" : "user";
      await startCamera();
    }
  });
}

// ==========================================
// SNAPSHOT PERSISTENCE & GALLERY INTEGRATION
// ==========================================

export function renderGallery() {
  // Gallery DOM UI has been removed in favor of Profile-based storage.
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
          const peaks = getDefaultSquatPeaks(m.squatPeaks);
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
if (slider) {
  slider.addEventListener('input', (e) => {
    state.calBoxSize = parseInt(e.target.value);
    if (sliderValDisplay) sliderValDisplay.textContent = `${state.calBoxSize} px`;
    if (state.calLocked) {
      state.calLocked = false;
      state.scaleFactor3D = null; // Reset 3D scale so that it re-estimates based on new card scale!
      clearSmoothBuffer('height_scale_calibration');
      clearSmoothBuffer('body_height_skeletal');
      clearSmoothBuffer('body_height_live');
      
      if (lockCalButton) {
        lockCalButton.textContent = "Lock 20cm Calibration";
        lockCalButton.classList.add('cal-btn-unlocked');
        lockCalButton.classList.remove('cal-btn-locked');
      }
    }
  });
}

if (lockCalButton) {
  lockCalButton.addEventListener('click', () => {
    state.pixelsPerCm = state.calBoxSize / MARKER_PHYSICAL_SIZE_CM;
    state.calLocked = true;
    state.scaleFactor3D = null; // Force recalibration of 3D scale factor using new pixelsPerCm
    clearSmoothBuffer('height_scale_calibration');
    clearSmoothBuffer('body_height_skeletal');
    clearSmoothBuffer('body_height_live');
    
    lockCalButton.textContent = "✅ Scale Locked!";
    lockCalButton.classList.add('cal-btn-locked');
    lockCalButton.classList.remove('cal-btn-unlocked');
    if (statusElement) statusElement.textContent = `Scale calibrated: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
    if (state.activeProfileId) {
      autoSyncToActiveProfile();
    }
  });
}

// Preset Position buttons
const posLeftBtn = document.getElementById('pos-left-btn');
const posCenterBtn = document.getElementById('pos-center-btn');
const posRightBtn = document.getElementById('pos-right-btn');

function updatePosBtnStyles(activeBtn) {
  [posLeftBtn, posCenterBtn, posRightBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('btn-tab-active', btn === activeBtn);
      btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
    }
  });
}

if (posLeftBtn) {
  posLeftBtn.addEventListener('click', () => {
    const w = state.canvasWidth || 640;
    const h = state.canvasHeight || 480;
    state.calBoxX = w * 0.15;
    state.calBoxY = h / 2;
    updatePosBtnStyles(posLeftBtn);
  });
}

if (posCenterBtn) {
  posCenterBtn.addEventListener('click', () => {
    const w = state.canvasWidth || 640;
    const h = state.canvasHeight || 480;
    state.calBoxX = w / 2;
    state.calBoxY = h / 2;
    updatePosBtnStyles(posCenterBtn);
  });
}

if (posRightBtn) {
  posRightBtn.addEventListener('click', () => {
    const w = state.canvasWidth || 640;
    const h = state.canvasHeight || 480;
    state.calBoxX = w * 0.85;
    state.calBoxY = h / 2;
    updatePosBtnStyles(posRightBtn);
  });
}

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
}, { passive: false });

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
}, { passive: false });

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
export function setUnitSystem(useInches) {
  state.useInches = useInches;

  // 1. Sync class list on main togglers
  const unitInchBtn = document.getElementById('unit-inch-btn');
  const unitCmBtn = document.getElementById('unit-cm-btn');
  if (unitInchBtn && unitCmBtn) {
    if (useInches) {
      unitInchBtn.classList.add('active');
      unitCmBtn.classList.remove('active');
    } else {
      unitInchBtn.classList.remove('active');
      unitCmBtn.classList.add('active');
    }
  }

  // 2. Sync class list on modal togglers
  const modalUnitInchBtn = document.getElementById('modal-unit-inch-btn');
  const modalUnitCmBtn = document.getElementById('modal-unit-cm-btn');
  if (modalUnitInchBtn && modalUnitCmBtn) {
    if (useInches) {
      modalUnitInchBtn.classList.add('active');
      modalUnitCmBtn.classList.remove('active');
    } else {
      modalUnitInchBtn.classList.remove('active');
      modalUnitCmBtn.classList.add('active');
    }
  }

  // 3. Update related input displays & validations
  updateHeightInputUnit();
  updateStateInputHeight();
  updateSidebarPlaceholders();

  // 4. Update live dashboard if frozen or live placeholders
  if (state.isSnapshotFrozen && state.frozenMetrics) {
    renderDashboard(state.frozenMetrics);
  } else {
    updateDashboardOfflinePlaceholders();
  }

  // 5. Update gallery if initialized
  if (state.dbInitialized) {
    renderGallery();
  }

  // 6. Update open snapshot modal
  const modal = document.getElementById('snapshot-modal');
  if (modal && !modal.classList.contains('hidden') && state.activeModalSnapshotId) {
    openSnapshotModal(state.activeModalSnapshotId);
  }

  // 7. Update profile details modal if active
  const profileDetailsModal = document.getElementById('profile-details-modal');
  if (profileDetailsModal && profileDetailsModal.classList.contains('active')) {
    if (state.activeProfileId) {
      openProfileDetailsModal(state.activeProfileId);
    }
  }
}

const unitInchBtn = document.getElementById('unit-inch-btn');
const unitCmBtn = document.getElementById('unit-cm-btn');

if (unitInchBtn) {
  unitInchBtn.addEventListener('click', () => {
    setUnitSystem(true);
  });
}

if (unitCmBtn) {
  unitCmBtn.addEventListener('click', () => {
    setUnitSystem(false);
  });
}

// Switch calibration tabs
function switchCalibrationTab(method, activeBtn, activePanel) {
  state.activeCalMethod = method;
  state.scaleFactor3D = null; // Clear scale factor on switch so we can recalibrate cleanly!
  
  // Clear calibration-related smoothing buffers to avoid slow drift/lag from previous states
  clearSmoothBuffer('scale_factor');
  clearSmoothBuffer('scale_factor_3d_height');
  clearSmoothBuffer('height_scale_calibration');
  clearSmoothBuffer('body_height_skeletal');
  clearSmoothBuffer('body_height_live');
  
  [tabHeightBtn, tabPortfolioBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('btn-tab-active', btn === activeBtn);
      btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
    }
  });

  [panelHeight, panelPortfolio].forEach(panel => {
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
  }  else {
    state.pixelsPerCm = null;
    state.calLocked = false;
  }
}

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
    ctx.strokeStyle = '#FFFFFF';
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

  const subjectName = getActiveProfileName(false) || "Subject";
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
      const subjectName = getActiveProfileName(false) || "Subject";
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

  hideExportProgressOverlay();

  // Clean standard canvas overlay instantly upon finishing export
  if (canvasCtx) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  }

  // Restore original video looping and playback speed after export completes
  if (state.isUploadedMedia && state.uploadedMediaType === 'video' && uploadedVideo) {
    if (state.wasLooping !== undefined) {
      uploadedVideo.loop = state.wasLooping;
    }
    if (state.wasPlaybackRate !== undefined) {
      uploadedVideo.playbackRate = state.wasPlaybackRate;
    }
    if (videoControlsBar) {
      videoControlsBar.classList.remove('hidden');
    }
  }
}

export async function saveVideoToActiveProfile(blobToDownload, fileExt, finalDuration) {
  try {
    const profile = await snapshotStore.getProfile(state.activeProfileId);
    if (profile) {
      profile.videos = profile.videos || [];
      
      let labelPrefix = "Video Capture";
      if (state.currentMode === 'squat') {
        labelPrefix = state.squatTestingSide === 'left' ? "Left Overhead Squat" : (state.squatTestingSide === 'right' ? "Right Overhead Squat" : "Frontal Overhead Squat");
      } else if (state.currentMode === 'shoulder_flexion') {
        labelPrefix = state.shoulderTestingSide === 'left' ? "Left Shoulder Flexion" : "Right Shoulder Flexion";
      }
        
      const videoEntry = {
        id: Date.now(),
        name: `${labelPrefix} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`,
        blob: blobToDownload,
        timestamp: Date.now(),
        duration: finalDuration,
        fileExt: fileExt
      };
      profile.videos.push(videoEntry);
      state.videos = profile.videos;

      // Link video to active session
      const profileMigrated = ensureProfileSessions(profile);
      const activeSessionId = state.activeSessionId || profileMigrated.activeSessionId || (profileMigrated.sessions && profileMigrated.sessions[0] ? profileMigrated.sessions[0].id : null);
      if (activeSessionId) {
        const activeSession = profileMigrated.sessions.find(s => String(s.id) === String(activeSessionId));
        if (activeSession) {
          if (state.currentMode === 'squat') {
            if (state.squatTestingSide === 'left') {
              activeSession.videoSquatL = videoEntry;
              state.videoSquatL = videoEntry;
              if (!state.isRecordingAssessment) {
                activeSession.imageSquatL = null; // Clear static overlay for video slots
                state.imageSquatL = null;
              }
            } else if (state.squatTestingSide === 'right') {
              activeSession.videoSquatR = videoEntry;
              state.videoSquatR = videoEntry;
              if (!state.isRecordingAssessment) {
                activeSession.imageSquatR = null; // Clear static overlay for video slots
                state.imageSquatR = null;
              }
            } else {
              activeSession.videoSquatFrontal = videoEntry;
              state.videoSquatFrontal = videoEntry;
              if (!state.isRecordingAssessment) {
                activeSession.imageSquatFrontal = null; // Clear static overlay for video slots
                state.imageSquatFrontal = null;
              }
            }
          } else if (state.currentMode === 'shoulder_flexion') {
            if (state.shoulderTestingSide === 'left') {
              activeSession.videoShoulderL = videoEntry;
              state.videoShoulderL = videoEntry;
              if (!state.isRecordingAssessment) {
                activeSession.imageShoulderLStart = null;
                state.imageShoulderLStart = null;
                activeSession.imageShoulderLEnd = null;
                state.imageShoulderLEnd = null;
              }
            } else if (state.shoulderTestingSide === 'right') {
              activeSession.videoShoulderR = videoEntry;
              state.videoShoulderR = videoEntry;
              if (!state.isRecordingAssessment) {
                activeSession.imageShoulderRStart = null;
                state.imageShoulderRStart = null;
                activeSession.imageShoulderREnd = null;
                state.imageShoulderREnd = null;
              }
            }
          }
        }
      }

      // Update state.videos so autoSync can find it
      state.videos = profileMigrated.videos;

      // Perform a full database sync of both the video assignments and the calculated joint peaks/valgus metrics
      await autoSyncToActiveProfile();
      if (state.activeProfileId === profile.id) {
        await loadProfileIntoState(profile.id);
      }
      
      console.log(`[VideoSave] Successfully saved video to profile: ${profile.name}`);
      statusElement.textContent = `🎥 Video saved directly to "${profile.name}"'s portfolio and downloaded locally!`;

      if (state.isRecordingAssessment) {
        state.isRecordingAssessment = false;
        alert(`Assessment video recorded and saved successfully for ${profile.name}!`);
        openProfileDetailsModal(profile.id);
      }
    }
  } catch (err) {
    console.error("[VideoSave] Failed to save video to active profile:", err);
  }
}

export function getShoulderWristAngle(landmarks, side) {
  if (!landmarks) return null;
  const shoulderIdx = side === 'left' ? 11 : 12;
  const wristIdx = side === 'left' ? 15 : 16;
  
  const rawShoulder = landmarks[shoulderIdx];
  const rawWrist = landmarks[wristIdx];
  if (!rawShoulder || !rawWrist) return null;

  const height = state.canvasHeight || 480;

  // Resolve landmarks to pixel coordinates, matching how they are drawn
  const shoulder = { x: getCanvasX(rawShoulder.x), y: rawShoulder.y * height };
  const wrist = { x: getCanvasX(rawWrist.x), y: rawWrist.y * height };

  const v_x = wrist.x - shoulder.x;
  const v_y = wrist.y - shoulder.y;
  const len = Math.sqrt(v_x * v_x + v_y * v_y);
  if (len === 0) return null;

  const u_x = v_x / len;
  const u_y = v_y / len;
  
  // Angle relative to straight down vertical [0, 1]
  const cos_theta = Math.max(-1, Math.min(1, u_y));
  const angleDeg = Math.acos(cos_theta) * 180 / Math.PI;

  return { angleDeg, u_x, u_y, wrist, shoulder };
}

export async function processShoulderFlexionFromPreprocessedFrames() {
  if (!state.exportFramesData || state.exportFramesData.length === 0) return;
  const side = state.shoulderTestingSide || 'left';
  console.log(`[ShoulderProcessing] Processing shoulder flexion from ${state.exportFramesData.length} frames for side: ${side}`);

  // 1. Find the Peak End Frame (max angle relative to straight down across the entire video)
  let maxAngle = -1;
  let endIdx = -1;
  let endAngleInfo = null;

  for (let i = 0; i < state.exportFramesData.length; i++) {
    const frame = state.exportFramesData[i];
    if (frame.poseLandmarks) {
      const info = getShoulderWristAngle(frame.poseLandmarks, side);
      if (info && info.angleDeg > maxAngle) {
        maxAngle = info.angleDeg;
        endIdx = i;
        endAngleInfo = info;
      }
    }
  }

  if (endIdx === -1 || !endAngleInfo) {
    console.warn("[ShoulderProcessing] Could not identify a valid peak end frame (arms up) with pose landmarks.");
    return;
  }

  // 2. Find the Start Frame (min angle before the peak end frame)
  let minAngle = 360;
  let startIdx = -1;
  let startAngleInfo = null;

  for (let i = 0; i <= endIdx; i++) {
    const frame = state.exportFramesData[i];
    if (frame.poseLandmarks) {
      const info = getShoulderWristAngle(frame.poseLandmarks, side);
      if (info && info.angleDeg < minAngle) {
        minAngle = info.angleDeg;
        startIdx = i;
        startAngleInfo = info;
      }
    }
  }

  if (startIdx === -1 || !startAngleInfo) {
    console.warn("[ShoulderProcessing] Could not identify a valid start frame (arms down) before the peak.");
    return;
  }

  const startFrame = state.exportFramesData[startIdx];
  const endFrame = state.exportFramesData[endIdx];

  // 3. Compute excursion
  const dot = startAngleInfo.u_x * endAngleInfo.u_x + startAngleInfo.u_y * endAngleInfo.u_y;
  const excursion = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;

  console.log(`[ShoulderProcessing] Identified Start Frame (Arms Down) at t=${startFrame.time.toFixed(3)}s (Angle: ${startAngleInfo.angleDeg.toFixed(1)}°), End Frame (Arms Up Peak) at t=${endFrame.time.toFixed(3)}s (Angle: ${endAngleInfo.angleDeg.toFixed(1)}°). Excursion: ${excursion.toFixed(1)}°`);

  // Ensure state peaks structure is initialized
  state.shoulderPeaks = getDefaultShoulderPeaks(state.shoulderPeaks);

  // Save numerical excursion and angles
  if (side === 'left') {
    state.shoulderPeaks.excursionL = excursion;
    state.shoulderPeaks.startAngleL = startAngleInfo.angleDeg;
    state.shoulderPeaks.endAngleL = endAngleInfo.angleDeg;
    state.shoulderPeaks.jointsL = {
      start: JSON.parse(JSON.stringify(startFrame.poseLandmarks)),
      end: JSON.parse(JSON.stringify(endFrame.poseLandmarks))
    };
    state.jointsShoulderL = state.shoulderPeaks.jointsL;
  } else {
    state.shoulderPeaks.excursionR = excursion;
    state.shoulderPeaks.startAngleR = startAngleInfo.angleDeg;
    state.shoulderPeaks.endAngleR = endAngleInfo.angleDeg;
    state.shoulderPeaks.jointsR = {
      start: JSON.parse(JSON.stringify(startFrame.poseLandmarks)),
      end: JSON.parse(JSON.stringify(endFrame.poseLandmarks))
    };
    state.jointsShoulderR = state.shoulderPeaks.jointsR;
  }

  // Define seek function
  function seekVideoTo(time) {
    return new Promise((resolve) => {
      let resolved = false;
      function onSeeked() {
        if (!resolved) {
          resolved = true;
          uploadedVideo.removeEventListener('seeked', onSeeked);
          setTimeout(resolve, 25);
        }
      }
      uploadedVideo.addEventListener('seeked', onSeeked);
      uploadedVideo.currentTime = time;
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          uploadedVideo.removeEventListener('seeked', onSeeked);
          resolve();
        }
      }, 1000);
    });
  }

  // 4. Capture screenshots with overlays
  // Save original seek time
  const origTime = uploadedVideo.currentTime;

  // Render and capture Start Frame
  await seekVideoTo(startFrame.time);
  const startResults = {
    poseLandmarks: startFrame.poseLandmarks,
    image: uploadedVideo
  };
  onPoseResults(startResults);
  const startImg = canvasElement.toDataURL('image/png');

  // Render and capture End Frame
  await seekVideoTo(endFrame.time);
  const endResults = {
    poseLandmarks: endFrame.poseLandmarks,
    image: uploadedVideo
  };
  onPoseResults(endResults);
  const endImg = canvasElement.toDataURL('image/png');

  // Save to state
  if (side === 'left') {
    state.imageShoulderLStart = endImg;
    state.imageShoulderLEnd = null;
  } else {
    state.imageShoulderRStart = endImg;
    state.imageShoulderREnd = null;
  }

  // Restore video playback position
  await seekVideoTo(origTime);

  // Sync state to profile
  await autoSyncToActiveProfile();
  updateShoulderSidebarUI();
  
  if (statusElement) {
    statusElement.textContent = `✅ Calculated ${side.toUpperCase()} Shoulder Excursion: ${excursion.toFixed(1)}°. Snapshots saved.`;
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
      if (videoControlsBar) {
        videoControlsBar.classList.remove('hidden');
      }
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

  if (videoControlsBar) {
    videoControlsBar.classList.add('hidden');
  }

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
          setTimeout(resolve, 25);
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
      statusElement.textContent = "✅ Pre-processing complete. Initializing zero-lag playout record...";
      state.isExportingFrameByFrame = false;
      updateRecordButtonUI();

      if (state.currentMode === 'shoulder_flexion') {
        try {
          await processShoulderFlexionFromPreprocessedFrames();
        } catch (err) {
          console.error("[ShoulderProcessing] Error processing preprocessed frames:", err);
        }
      }

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
    if (videoControlsBar) {
      videoControlsBar.classList.remove('hidden');
    }
    
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
  showExportProgressOverlay(0, 2);
  
  // Play the video at standard 1.0x speed
  uploadedVideo.play();
  
  statusElement.textContent = "🔴 Recording playout is active. Analyzing from cached timeline... please do not close this tab.";
  updateRecordButtonUI();
}

export function showExportProgressOverlay(percent, phase = 1) {
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
        <div class="export-progress-title" id="export-progress-title">Analyzing Athletic Motion</div>
        <div class="export-progress-subtitle" id="export-progress-subtitle">Phase 1 of 2: High-Fidelity Pre-processing</div>
        <div class="export-progress-bar-container">
          <div class="export-progress-bar-fill" id="export-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="export-progress-text" id="export-progress-text">0% Completed</div>
        <div class="export-progress-warning" id="export-progress-warning">
          Biomechanical calculation is active. Once finished, Phase 2 will start recording
        </div>
      </div>
    `;
    viewport.appendChild(overlay);
  }

  const titleEl = document.getElementById('export-progress-title');
  const subtitleEl = document.getElementById('export-progress-subtitle');
  const warningEl = document.getElementById('export-progress-warning');

  if (phase === 2) {
    if (titleEl) titleEl.textContent = "Exporting Playout to Profile";
    if (subtitleEl) {
      subtitleEl.textContent = "Phase 2 of 2: Recording Playout";
      subtitleEl.style.color = "#ec4899";
    }
    if (warningEl) warningEl.textContent = "🔴 Recording high-fidelity stream with biomechanical overlays... Please do not close or interact.";
  } else {
    if (titleEl) titleEl.textContent = "Analyzing Athletic Motion";
    if (subtitleEl) {
      subtitleEl.textContent = "Phase 1 of 2: High-Fidelity Pre-processing";
      subtitleEl.style.color = "";
    }
    if (warningEl) warningEl.textContent = "Biomechanical calculation is active. Once finished, Phase 2 will start recording";
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

// Event Listeners for Inputs

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
    state.imageA = null;
    state.imageT = null;
    state.imageOverhead = null;

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
      if (btnSquatSideFrontal) btnSquatSideFrontal.classList.remove('active-frontal');
    } else if (side === 'right') {
      btnSquatSideRight.classList.add('active-right');
      btnSquatSideLeft.classList.remove('active-left');
      if (btnSquatSideFrontal) btnSquatSideFrontal.classList.remove('active-frontal');
    } else if (side === 'frontal') {
      if (btnSquatSideFrontal) btnSquatSideFrontal.classList.add('active-frontal');
      btnSquatSideLeft.classList.remove('active-left');
      btnSquatSideRight.classList.remove('active-right');
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
    } else if (side === 'right') {
      if (box.classList.contains('right-border')) {
        box.classList.add('active-right');
        box.classList.remove('inactive-side');
      } else if (box.classList.contains('left-border')) {
        box.classList.add('inactive-side');
        box.classList.remove('active-left');
      }
    } else if (side === 'frontal') {
      if (box.classList.contains('left-border')) {
        box.classList.add('active-left');
        box.classList.remove('inactive-side');
      }
      if (box.classList.contains('right-border')) {
        box.classList.add('active-right');
        box.classList.remove('inactive-side');
      }
    }
  });

  const squatAsymmetryRow = document.getElementById('squat-asymmetry-row');
  if (squatAsymmetryRow) {
    if (side === 'frontal') {
      squatAsymmetryRow.classList.remove('hidden');
      const labelEl = squatAsymmetryRow.querySelector('.metric-lbl');
      if (labelEl) {
        labelEl.textContent = 'Knee Cave-In:';
      }
    } else {
      squatAsymmetryRow.classList.add('hidden');
    }
  }
}

export function updateShoulderSideUI() {
  const side = state.shoulderTestingSide || 'left';
  
  if (btnShoulderSideLeft && btnShoulderSideRight) {
    if (side === 'left') {
      btnShoulderSideLeft.classList.add('active-left');
      btnShoulderSideLeft.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnShoulderSideLeft.style.color = 'white';
      btnShoulderSideRight.classList.remove('active-right');
      btnShoulderSideRight.style.background = 'transparent';
      btnShoulderSideRight.style.color = '#a7b1b7';
    } else if (side === 'right') {
      btnShoulderSideRight.classList.add('active-right');
      btnShoulderSideRight.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnShoulderSideRight.style.color = 'white';
      btnShoulderSideLeft.classList.remove('active-left');
      btnShoulderSideLeft.style.background = 'transparent';
      btnShoulderSideLeft.style.color = '#a7b1b7';
    }
  }

  const angleBoxes = document.querySelectorAll('#shoulder-sidebar-content .angle-box');
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

export async function resetShoulderPeaksUI() {
  state.shoulderPeaks = getDefaultShoulderPeaks();
  state.imageShoulderLStart = null;
  state.imageShoulderLEnd = null;
  state.imageShoulderRStart = null;
  state.imageShoulderREnd = null;
  
  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }
  
  if (shoulderLiveAngleL) shoulderLiveAngleL.textContent = '--°';
  if (shoulderLiveAngleR) shoulderLiveAngleR.textContent = '--°';

  if (shoulderStatusVal) {
    shoulderStatusVal.textContent = 'Awaiting Subject';
    shoulderStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    shoulderStatusVal.classList.add('text-slate');
  }
  updateShoulderSidebarUI();
}

export function calculateValgusFromJoints(joints) {
  let pctL = 0;
  let pctR = 0;
  if (!joints) return { pctL, pctR };
  
  const { knee_l, knee_r, ankle_l, ankle_r } = joints;
  if (knee_l && knee_r && ankle_l && ankle_r) {
    const B = {
      x: ankle_r.x - ankle_l.x,
      y: ankle_r.y - ankle_l.y
    };
    const S_L = {
      x: knee_l.x - ankle_l.x,
      y: knee_l.y - ankle_l.y
    };
    const S_R = {
      x: knee_r.x - ankle_r.x,
      y: knee_r.y - ankle_r.y
    };

    const lenB = Math.sqrt(B.x * B.x + B.y * B.y);

    const lenS_L = Math.sqrt(S_L.x * S_L.x + S_L.y * S_L.y);
    if (lenB > 0.0001 && lenS_L > 0.0001) {
      const dotL = B.x * S_L.x + B.y * S_L.y;
      const cosThetaL = Math.max(-1, Math.min(1, dotL / (lenB * lenS_L)));
      const thetaL_deg = Math.acos(cosThetaL) * (180 / Math.PI);
      pctL = Math.abs(90 - thetaL_deg);
    }

    const lenS_R = Math.sqrt(S_R.x * S_R.x + S_R.y * S_R.y);
    if (lenB > 0.0001 && lenS_R > 0.0001) {
      const dotR = B.x * S_R.x + B.y * S_R.y;
      const cosThetaR = Math.max(-1, Math.min(1, dotR / (lenB * lenS_R)));
      const thetaR_deg = Math.acos(cosThetaR) * (180 / Math.PI);
      pctR = Math.abs(90 - thetaR_deg);
    }
  }
  return { pctL, pctR };
}

export function updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR, calculated) {
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
  } else if (state.squatTestingSide === 'right') {
    state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
    state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
    state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
  } else if (state.squatTestingSide === 'frontal') {
    if (state.allowFrontalUpdateL) {
      state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, kneeMobL);
      state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, hipMobL);
      state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, ankleMobL);
    }
    if (state.allowFrontalUpdateR) {
      state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, kneeMobR);
      state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, hipMobR);
      state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, ankleMobR);
    }
  }

  // Calculate real-time Knee Alignment (deviation from perpendicular to ankle-to-ankle line) in degrees if in frontal mode
  let pctL = 0; // stores left deviation in degrees
  let pctR = 0; // stores right deviation in degrees
  if (state.squatTestingSide === 'frontal' && calculated) {
    const valgus = calculateValgusFromJoints(calculated);
    pctL = valgus.pctL;
    pctR = valgus.pctR;

    const isVideo = state.isUploadedMedia && state.uploadedMediaType === 'video' && uploadedVideo;
    const currentVideoTime = isVideo ? uploadedVideo.currentTime : null;

    // Track peak deviations in degrees only during active squat movement (knee flexion >= 30 degrees)
    if (kneeMobL >= 30 || kneeMobR >= 30) {
      if (kneeMobL >= 30) {
        state.squatPeaks.maxKneeCaveL = Math.max(state.squatPeaks.maxKneeCaveL || 0, pctL);
      }
      if (kneeMobR >= 30) {
        state.squatPeaks.maxKneeCaveR = Math.max(state.squatPeaks.maxKneeCaveR || 0, pctR);
      }

      const maxVal = Math.max(pctL, pctR);

      if (isVideo && currentVideoTime !== null) {
        // Valgus first appearance: deviation > 8.0 degrees is considered valgus
        if (maxVal > 8.0) {
          if (state.squatPeaks.valgusFirstTimestamp === undefined || state.squatPeaks.valgusFirstTimestamp === null) {
            state.squatPeaks.valgusFirstTimestamp = currentVideoTime;
          }
        }

        // Track the peak valgus score and corresponding timestamp
        if (maxVal > (state.squatPeaks.valgusPeakScore || 0)) {
          state.squatPeaks.valgusPeakScore = maxVal;
          state.squatPeaks.valgusPeakTimestamp = currentVideoTime;
        }
      }
    }
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

  // Real-time Frontal Knee Cave-In display in sidebar
  const squatAsymmetryVal = document.getElementById('squat-asymmetry-val');
  if (squatAsymmetryVal) {
    if (state.squatTestingSide === 'frontal') {
      if (maxKneeMob >= 30) {
        const maxPct = Math.max(pctL, pctR);
        const valStr = `${maxPct.toFixed(1)}°`;

        if (maxPct < 3.0) {
          squatAsymmetryVal.textContent = 'None';
          squatAsymmetryVal.style.color = '#10b981'; // Emerald
        } else if (maxPct <= 8.0) {
          squatAsymmetryVal.textContent = `Mild (${valStr})`;
          squatAsymmetryVal.style.color = '#ffb300'; // Yellow-Amber
        } else if (maxPct <= 15.0) {
          squatAsymmetryVal.textContent = `Moderate (${valStr})`;
          squatAsymmetryVal.style.color = '#ff9f43'; // Amber
        } else {
          squatAsymmetryVal.textContent = `Severe (${valStr})`;
          squatAsymmetryVal.style.color = '#ef4444'; // Scarlet
        }
      } else {
        squatAsymmetryVal.textContent = 'None';
        squatAsymmetryVal.style.color = '#10b981'; // Emerald
      }
    }
  }
}

export async function resetSquatPeaks() {
  state.squatPeaks = getDefaultSquatPeaks();
  state.jointsOverhead = null;

  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
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

export function getDefaultSquatPeaks(existing = null) {
  const defaults = {
    kneeL: 0,
    kneeR: 0,
    hipL: 0,
    hipR: 0,
    ankleL: 0,
    ankleR: 0,
    maxKneeCaveL: 0,
    maxKneeCaveR: 0,
    valgusFirstTimestamp: null,
    valgusPeakTimestamp: null,
    valgusPeakScore: 0
  };
  if (existing) {
    return { ...defaults, ...existing };
  }
  return defaults;
}

export function getDefaultShoulderPeaks(existing = null) {
  const defaults = {
    excursionL: 0,
    excursionR: 0,
    startAngleL: null,
    startAngleR: null,
    endAngleL: null,
    endAngleR: null,
    jointsL: null,
    jointsR: null
  };
  if (existing) {
    return { ...defaults, ...existing };
  }
  return defaults;
}

export function updateShoulderSidebarUI() {
  const p = state.shoulderPeaks || getDefaultShoulderPeaks();
  if (shoulderPeakExcursionL) shoulderPeakExcursionL.textContent = `${Math.round(p.excursionL || 0)}°`;
  if (shoulderPeakExcursionR) shoulderPeakExcursionR.textContent = `${Math.round(p.excursionR || 0)}°`;
  if (shoulderStartAngleL) shoulderStartAngleL.textContent = p.startAngleL ? `${Math.round(p.startAngleL)}°` : '--';
  if (shoulderStartAngleR) shoulderStartAngleR.textContent = p.startAngleR ? `${Math.round(p.startAngleR)}°` : '--';
  if (shoulderEndAngleL) shoulderEndAngleL.textContent = p.endAngleL ? `${Math.round(p.endAngleL)}°` : '--';
  if (shoulderEndAngleR) shoulderEndAngleR.textContent = p.endAngleR ? `${Math.round(p.endAngleR)}°` : '--';
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
    if (btnModeShoulder) btnModeShoulder.classList.remove('active');
    
    if (postureSidebarContent) postureSidebarContent.classList.remove('hidden');
    if (squatSidebarContent) squatSidebarContent.classList.add('hidden');
    if (shoulderSidebarContent) shoulderSidebarContent.classList.add('hidden');
    
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
    if (btnModeShoulder) btnModeShoulder.classList.remove('active');
    
    if (squatSidebarContent) squatSidebarContent.classList.remove('hidden');
    if (postureSidebarContent) postureSidebarContent.classList.add('hidden');
    if (shoulderSidebarContent) shoulderSidebarContent.classList.add('hidden');
    
    updateSquatSideUI(); // Ensure side selector states are active on sidebar open

    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateSquatDashboardOffline();
    }
  });
}

if (btnModeShoulder) {
  btnModeShoulder.addEventListener('click', () => {
    state.currentMode = 'shoulder_flexion';
    btnModeShoulder.classList.add('active');
    if (btnModePosture) btnModePosture.classList.remove('active');
    if (btnModeSquat) btnModeSquat.classList.remove('active');
    
    if (shoulderSidebarContent) shoulderSidebarContent.classList.remove('hidden');
    if (postureSidebarContent) postureSidebarContent.classList.add('hidden');
    if (squatSidebarContent) squatSidebarContent.classList.add('hidden');
    
    updateShoulderSideUI();
    updateShoulderSidebarUI();
    
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateShoulderSidebarUI();
    }
  });
}

// Wire up Testing Side selector buttons
if (btnSquatSideLeft) {
  btnSquatSideLeft.addEventListener('click', () => {
    state.squatTestingSide = 'left';
    state.allowFrontalUpdateL = false;
    state.allowFrontalUpdateR = false;
    updateSquatSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}
if (btnSquatSideRight) {
  btnSquatSideRight.addEventListener('click', () => {
    state.squatTestingSide = 'right';
    state.allowFrontalUpdateL = false;
    state.allowFrontalUpdateR = false;
    updateSquatSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}
if (btnSquatSideFrontal) {
  btnSquatSideFrontal.addEventListener('click', () => {
    state.squatTestingSide = 'frontal';
    // Only allow updating left/right peak metrics during a frontal squat if they are currently 0 (missing)
    state.allowFrontalUpdateL = (!state.squatPeaks || state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0 && state.squatPeaks.ankleL === 0);
    state.allowFrontalUpdateR = (!state.squatPeaks || state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0 && state.squatPeaks.ankleR === 0);
    updateSquatSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}

// Wire up Shoulder Testing Side selectors
if (btnShoulderSideLeft) {
  btnShoulderSideLeft.addEventListener('click', () => {
    state.shoulderTestingSide = 'left';
    updateShoulderSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}
if (btnShoulderSideRight) {
  btnShoulderSideRight.addEventListener('click', () => {
    state.shoulderTestingSide = 'right';
    updateShoulderSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    }
  });
}

// Initial UI sync for side selectors
setTimeout(() => {
  updateSquatSideUI();
  updateShoulderSideUI();
  updateShoulderSidebarUI();
}, 200);

const btnResetPeaks = document.getElementById('btn-reset-peaks');
if (btnResetPeaks) {
  btnResetPeaks.addEventListener('click', resetSquatPeaks);
}

const btnResetShoulderPeaks = document.getElementById('btn-reset-shoulder-peaks');
if (btnResetShoulderPeaks) {
  btnResetShoulderPeaks.addEventListener('click', resetShoulderPeaksUI);
}

const btnSaveSquatPeaks = document.getElementById('btn-save-squat-peaks');
if (btnSaveSquatPeaks) {
  btnSaveSquatPeaks.addEventListener('click', async () => {
    const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;
    
    if (isWebcamLive) {
      if (!state.isRecording) {
        // Start live recording
        state.isRecordingAssessment = true;
        // Merge with existing peak values so we do not wipe out metrics for the opposite side!
        state.squatPeaks = getDefaultSquatPeaks(state.squatPeaks);
        
        if (state.squatTestingSide === 'left') {
          state.imageSquatL = null;
          state.squatPeaks.kneeL = 0;
          state.squatPeaks.hipL = 0;
          state.squatPeaks.ankleL = 0;
        } else if (state.squatTestingSide === 'right') {
          state.imageSquatR = null;
          state.squatPeaks.kneeR = 0;
          state.squatPeaks.hipR = 0;
          state.squatPeaks.ankleR = 0;
        } else {
          state.imageSquatFrontal = null;
          state.jointsOverhead = null;
          state.squatPeaks.maxKneeCaveL = 0;
          state.squatPeaks.maxKneeCaveR = 0;
          state.squatPeaks.valgusFirstTimestamp = null;
          state.squatPeaks.valgusPeakTimestamp = null;
          state.squatPeaks.valgusPeakScore = 0;
        }
        startVideoRecording();
        
        // Update button UI to recording style
        btnSaveSquatPeaks.innerHTML = `<span class="recording-dot"></span> 🛑 Stop & Save Assessment Video`;
        btnSaveSquatPeaks.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        btnSaveSquatPeaks.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        btnSaveSquatPeaks.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.6)';
        btnSaveSquatPeaks.classList.add('recording-pulse');
        
        // Add CSS keyframes for recording-pulse animation if not present
        if (!document.getElementById('recording-pulse-style')) {
          const style = document.createElement('style');
          style.id = 'recording-pulse-style';
          style.innerHTML = `
            @keyframes recording-pulse {
              0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
              70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
              100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
            }
            .recording-pulse {
              animation: recording-pulse 1.5s infinite !important;
            }
            .recording-dot {
              display: inline-block;
              width: 8px;
              height: 8px;
              background-color: #fff;
              border-radius: 50%;
              margin-right: 6px;
              animation: blink 1s infinite alternate;
            }
            @keyframes blink {
              0% { opacity: 0.2; }
              100% { opacity: 1; }
            }
          `;
          document.head.appendChild(style);
        }
        
        if (statusElement) {
          statusElement.textContent = "🎥 Video recording started... Perform your overhead squat test now!";
        }
        return;
      } else {
        // Stop live recording & finalize save
        // Restore button appearance
        btnSaveSquatPeaks.innerHTML = `Record Squat Assessment`;
        btnSaveSquatPeaks.style.background = 'linear-gradient(135deg, #BA0C2F, #8A0824)';
        btnSaveSquatPeaks.style.borderColor = 'rgba(186, 12, 47, 0.4)';
        btnSaveSquatPeaks.style.boxShadow = 'none';
        btnSaveSquatPeaks.classList.remove('recording-pulse');
        
        // Save the snapshots at the moment of clicking stop
        const capturedImg = canvasElement.toDataURL('image/png');
        if (state.squatTestingSide === 'left') {
          state.imageSquatL = capturedImg;
        } else if (state.squatTestingSide === 'right') {
          state.imageSquatR = capturedImg;
        } else if (state.squatTestingSide === 'frontal') {
          state.imageSquatFrontal = capturedImg;
          if (state.lastCalculatedResults) {
            state.jointsOverhead = JSON.parse(JSON.stringify(state.lastCalculatedResults));
          }
        }
        
        // Stop recording
        stopVideoRecording();
        return;
      }
    }

    // 1. Validation check for non-zero squat peaks (only run if webcam not active)
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

    try {
      // 3. If we have an active profile, sync these peaks directly to their portfolio record (skipping general gallery)
      if (state.activeProfileId) {
        const capturedImg = canvasElement.toDataURL('image/png');
        if (state.squatTestingSide === 'left') {
          state.imageSquatL = capturedImg;
        } else if (state.squatTestingSide === 'right') {
          state.imageSquatR = capturedImg;
        } else if (state.squatTestingSide === 'frontal') {
          state.imageSquatFrontal = capturedImg;
          // Capture and save the full skeletal joint coordinates for the Overhead Squat image when it is taken
          if (state.lastCalculatedResults) {
            state.jointsOverhead = JSON.parse(JSON.stringify(state.lastCalculatedResults));
          }
        }
        await autoSyncToActiveProfile(true);
        
        if (statusElement) {
          statusElement.textContent = `💾 Peak mobility metrics for "${label}" successfully saved to portfolio!`;
        }
        alert(`Peak mobility metrics saved successfully for ${activeProfileName}!`);
        openProfileDetailsModal(state.activeProfileId);
      } else {
        alert("You are currently in Guest Mode. To save these peak mobility scores to a player portfolio, please select or create a profile first, then click Save Peaks to Portfolio again.");
      }
    } catch (err) {
      console.error("Failed to save squat peak snapshot to IndexedDB:", err);
      alert("Could not save squat peaks snapshot. See developer console for errors.");
    }
  });
}

const btnSaveShoulderPeaks = document.getElementById('btn-save-shoulder-peaks');
if (btnSaveShoulderPeaks) {
  btnSaveShoulderPeaks.addEventListener('click', async () => {
    // Initialize shoulder peaks structure if not present
    if (!state.shoulderPeaks) {
      state.shoulderPeaks = getDefaultShoulderPeaks();
    }

    const side = state.shoulderTestingSide || 'left';
    const statusElement = document.getElementById('shoulder-recording-status');

    // Capture the current canvas context as the snapshot
    const capturedImg = canvasElement.toDataURL('image/png');
    let curAngle = 0;
    if (state.latestPoseResults && state.latestPoseResults.poseLandmarks) {
      const info = getShoulderWristAngle(state.latestPoseResults.poseLandmarks, side);
      if (info) {
        curAngle = info.angleDeg;
      }
    }
    if (curAngle === 0) {
      curAngle = state.lastCalculatedShoulderAngle || 0;
    }

    if (side === 'left') {
      state.imageShoulderLStart = capturedImg;
      state.imageShoulderLEnd = null;
      
      state.shoulderPeaks.startAngleL = 0;
      state.shoulderPeaks.endAngleL = curAngle;
      state.shoulderPeaks.excursionL = curAngle;

      state.shoulderPeaks.jointsL = {
        start: null,
        end: state.latestPoseResults && state.latestPoseResults.poseLandmarks ? JSON.parse(JSON.stringify(state.latestPoseResults.poseLandmarks)) : null
      };
      state.jointsShoulderL = state.shoulderPeaks.jointsL;
    } else {
      state.imageShoulderRStart = capturedImg;
      state.imageShoulderREnd = null;
      
      state.shoulderPeaks.startAngleR = 0;
      state.shoulderPeaks.endAngleR = curAngle;
      state.shoulderPeaks.excursionR = curAngle;

      state.shoulderPeaks.jointsR = {
        start: null,
        end: state.latestPoseResults && state.latestPoseResults.poseLandmarks ? JSON.parse(JSON.stringify(state.latestPoseResults.poseLandmarks)) : null
      };
      state.jointsShoulderR = state.shoulderPeaks.jointsR;
    }

    // Identify active subject or Guest Mode
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

    const label = state.activeProfileId ? `${activeProfileName} - Shoulder Flexion` : "Guest - Shoulder Flexion";

    try {
      if (state.activeProfileId) {
        // Shoulder peaks are synced directly via autoSyncToActiveProfile
        await autoSyncToActiveProfile(true);
        
        if (statusElement) {
          statusElement.textContent = `💾 Shoulder flexion angle of ${Math.round(curAngle)}° for "${label}" successfully saved to portfolio!`;
        }
        alert(`Shoulder flexion angle of ${Math.round(curAngle)}° saved successfully for ${activeProfileName}!`);
        openProfileDetailsModal(state.activeProfileId);
      } else {
        alert(`You are currently in Guest Mode. Your flexion angle is ${Math.round(curAngle)}°. To save these shoulder flexion scores to a player portfolio, please select or create a profile first, then click Capture Flexion Snapshot again.`);
      }
    } catch (err) {
      console.error("Failed to save shoulder peak snapshot:", err);
      alert("Could not save shoulder flexion snapshot. See developer console for errors.");
    }

    // Initial placeholder update
    setTimeout(() => {
      updateDashboardOfflinePlaceholders();
    }, 200);
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
  // Disable real-time computer vision inference overlays during standard interaction/playback of imported/uploaded videos
  if (state.uploadedMediaType === 'video') return;
  if (!state.isUploadedMedia || !uploadedVideo) return;
  
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
  const modalUnitInchBtn = document.getElementById('modal-unit-inch-btn');
  const modalUnitCmBtn = document.getElementById('modal-unit-cm-btn');

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
    if (state.isExportingFrameByFrame || state.isRecordingPlayLoop) {
      alert("An export is currently in progress. Please wait until the export completes before switching profiles.");
      if (profileSelect) profileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
      if (calProfileSelect) calProfileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
      return;
    }
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
      
      const sessionContainer = document.getElementById('profile-session-select-container');
      if (sessionContainer) sessionContainer.classList.add('hidden');
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
      state.squatPeaks = getDefaultSquatPeaks();

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
      
      const sessionContainer = document.getElementById('profile-session-select-container');
      if (sessionContainer) sessionContainer.classList.add('hidden');
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
        squatPeaks: getDefaultSquatPeaks(),
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
        state.squatPeaks = getDefaultSquatPeaks();
        
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

  const mainVideoPlayer = document.getElementById('profile-details-video-player');
  if (mainVideoPlayer) {
    // Real-time inference on player profile videos is disabled because they already contain beautiful, high-performance burned-in overlays from export.
    // This prevents redundant pose calculations, saves CPU/GPU resources, and avoids overlapping static dots or lag.

    // Custom fullscreen button toggle logic and double-click handlers
    const container = document.getElementById('profile-details-video-player-container');
    const customFullscreenBtn = document.getElementById('btn-profile-video-fullscreen');

    const toggleFullscreen = () => {
      const currentFullscreenElement = document.fullscreenElement || 
                                       document.webkitFullscreenElement || 
                                       document.mozFullScreenElement || 
                                       document.msFullscreenElement;

      if (!currentFullscreenElement) {
        if (container.requestFullscreen) {
          container.requestFullscreen().catch(e => console.error("[Fullscreen] requestFullscreen failed:", e));
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (container.mozRequestFullScreen) {
          container.mozRequestFullScreen();
        } else if (container.msRequestFullscreen) {
          container.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(e => console.error("[Fullscreen] exitFullscreen failed:", e));
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    };

    if (customFullscreenBtn) {
      customFullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
      });
    }

    // Support double-clicking on the container or video to toggle fullscreen
    if (container) {
      container.addEventListener('dblclick', (e) => {
        // Prevent toggling if user double clicks controls or the custom button
        if (e.target.closest('#btn-profile-video-fullscreen') || e.target.tagName.toLowerCase() === 'button') {
          return;
        }
        toggleFullscreen();
      });
    }

    // Update custom button UI when fullscreen state changes
    const updateFullscreenButtonUI = () => {
      const currentFullscreenElement = document.fullscreenElement || 
                                       document.webkitFullscreenElement || 
                                       document.mozFullScreenElement || 
                                       document.msFullscreenElement;

      const isFullscreen = (currentFullscreenElement === container);

      if (customFullscreenBtn) {
        if (isFullscreen) {
          customFullscreenBtn.title = "Exit Fullscreen";
          customFullscreenBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
            </svg>
          `;
        } else {
          customFullscreenBtn.title = "Expand Fullscreen";
          customFullscreenBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          `;
        }
      }
    };

    document.addEventListener('fullscreenchange', updateFullscreenButtonUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButtonUI);
    document.addEventListener('mozfullscreenchange', updateFullscreenButtonUI);
    document.addEventListener('MSFullscreenChange', updateFullscreenButtonUI);

    // Support Safari / iOS direct native fullscreen begin events fallback
    mainVideoPlayer.addEventListener('webkitbeginfullscreen', (e) => {
      e.preventDefault();
      if (container) {
        if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (container.requestFullscreen) {
          container.requestFullscreen().catch(e => {});
        }
      }
    });
  }


  if (btnProfileExportJson) {
    btnProfileExportJson.addEventListener('click', () => {
      compileAndDownloadCombinedSession();
    });
  }

  if (modalUnitInchBtn) {
    modalUnitInchBtn.addEventListener('click', () => {
      setUnitSystem(true);
    });
  }

  if (modalUnitCmBtn) {
    modalUnitCmBtn.addEventListener('click', () => {
      setUnitSystem(false);
    });
  }

  // 12. Initialize Image Lightbox Modal for expanding preview pictures
  const lightboxModal = document.getElementById('image-lightbox-modal');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');

  if (lightboxModal && btnCloseLightbox && lightboxImg) {
    window.expandLightboxImage = function(src, title) {
      if (!src) return;
      lightboxImg.src = src;
      if (lightboxTitle) {
        lightboxTitle.textContent = title;
      }
      lightboxModal.classList.add('active');
    };

    const closeLightbox = () => {
      lightboxModal.classList.remove('active');
    };

    btnCloseLightbox.addEventListener('click', closeLightbox);
    
    // Close lightbox on clicking backdrop
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) {
        closeLightbox();
      }
    });

    const setupPreviewClick = (containerId, imgId, titleText) => {
      const container = document.getElementById(containerId);
      if (container) {
        container.addEventListener('click', () => {
          // Dynamically query the image currently inside the container, supporting rebuilt innerHTML img elements
          const img = container.querySelector('img');
          if (img && img.src && !container.classList.contains('hidden')) {
            lightboxImg.src = img.src;
            if (lightboxTitle) {
              lightboxTitle.textContent = titleText;
            }
            lightboxModal.classList.add('active');
          }
        });
      }
    };

    setupPreviewClick('detail-preview-container-a', 'detail-preview-img-a', 'A-Pose (Stature)');
    setupPreviewClick('detail-preview-container-t', 'detail-preview-img-t', 'T-Pose (Wingspan)');
    setupPreviewClick('detail-preview-container-overhead', 'detail-preview-img-overhead', 'Overhead (Reach)');
    setupPreviewClick('detail-preview-container-squat-l', 'detail-preview-img-squat-l', 'Left Overhead Squat');
    setupPreviewClick('detail-preview-container-squat-r', 'detail-preview-img-squat-r', 'Right Overhead Squat');
    setupPreviewClick('detail-preview-container-squat-frontal', 'detail-preview-img-squat-frontal', 'Frontal Overhead Squat');
  }
}

export function compileImportedMetricsFromProfile(profile, sessionId = null) {
  if (!profile) return null;

  // Determine the source metrics block (either specific session, active session, or profile top-level fallback)
  let sourceObj = profile;
  if (profile.sessions && Array.isArray(profile.sessions) && profile.sessions.length > 0) {
    const targetId = sessionId || state.activeSessionId || profile.activeSessionId;
    const session = profile.sessions.find(s => String(s.id) === String(targetId)) || profile.sessions[0];
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
      squatPeaks: getDefaultSquatPeaks(profile.squatPeaks),
      shoulderPeaks: getDefaultShoulderPeaks(profile.shoulderPeaks),
      imageA: profile.imageA || null,
      imageT: profile.imageT || null,
      imageOverhead: profile.imageOverhead || null,
      imageSquatL: profile.imageSquatL || null,
      imageSquatR: profile.imageSquatR || null,
      imageSquatFrontal: profile.imageSquatFrontal || null,
      imageShoulderLStart: profile.imageShoulderLStart || null,
      imageShoulderLEnd: profile.imageShoulderLEnd || null,
      imageShoulderRStart: profile.imageShoulderRStart || null,
      imageShoulderREnd: profile.imageShoulderREnd || null,
      jointsOverhead: profile.jointsOverhead || null,
      jointsShoulderL: profile.jointsShoulderL || null,
      jointsShoulderR: profile.jointsShoulderR || null,
      videoSquatL: profile.videoSquatL || null,
      videoSquatR: profile.videoSquatR || null,
      videoSquatFrontal: profile.videoSquatFrontal || null,
      videoShoulderL: profile.videoShoulderL || null,
      videoShoulderR: profile.videoShoulderR || null
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
    state.videos = profile.videos || [];
    
    // Find active session
    let activeSession = profile.sessions.find(s => String(s.id) === String(state.activeSessionId));
    if (!activeSession) {
      activeSession = profile.sessions.find(s => String(s.id) === String(profile.activeSessionId));
    }
    if (!activeSession) {
      activeSession = profile.sessions[profile.sessions.length - 1];
    }
    
    state.activeSessionId = activeSession.id;
    state.metricsA = activeSession.metricsA || null;
    state.metricsT = activeSession.metricsT || null;
    state.metricsOverhead = activeSession.metricsOverhead || null;
    state.squatPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
    state.shoulderPeaks = getDefaultShoulderPeaks(activeSession.shoulderPeaks);
    state.imageA = activeSession.imageA || null;
    state.imageT = activeSession.imageT || null;
    state.imageOverhead = activeSession.imageOverhead || null;
    state.imageSquatL = activeSession.imageSquatL || null;
    state.imageSquatR = activeSession.imageSquatR || null;
    state.imageSquatFrontal = activeSession.imageSquatFrontal || null;
    state.imageShoulderLStart = activeSession.imageShoulderLStart || null;
    state.imageShoulderLEnd = activeSession.imageShoulderLEnd || null;
    state.imageShoulderRStart = activeSession.imageShoulderRStart || null;
    state.imageShoulderREnd = activeSession.imageShoulderREnd || null;
    state.videoSquatL = activeSession.videoSquatL || null;
    state.videoSquatR = activeSession.videoSquatR || null;
    state.videoSquatFrontal = activeSession.videoSquatFrontal || null;
    state.videoShoulderL = activeSession.videoShoulderL || null;
    state.videoShoulderR = activeSession.videoShoulderR || null;
    state.jointsOverhead = activeSession.jointsOverhead || null;
    state.jointsShoulderL = activeSession.jointsShoulderL || null;
    state.jointsShoulderR = activeSession.jointsShoulderR || null;
    
    updateShoulderSidebarUI();
    
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

    // Sidebar Session Selector Initialization & Synchronization
    const sessionContainer = document.getElementById('profile-session-select-container');
    const sessionSelect = document.getElementById('profile-session-select');
    if (sessionContainer && sessionSelect) {
      sessionContainer.classList.remove('hidden');
      sessionSelect.innerHTML = '';
      
      profile.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name || `Session (${new Date(s.timestamp).toLocaleDateString()})`;
        if (String(s.id) === String(state.activeSessionId)) {
          opt.selected = true;
        }
        sessionSelect.appendChild(opt);
      });
      
      const newOpt = document.createElement('option');
      newOpt.value = 'new_session';
      newOpt.textContent = '➕ Create New Session...';
      sessionSelect.appendChild(newOpt);
      
      sessionSelect.value = state.activeSessionId;

      sessionSelect.onchange = async (e) => {
        const val = e.target.value;
        if (val === 'new_session') {
          const newSessionName = prompt("Enter a name for the new session (e.g., 'Set 2 - Post-practice'):");
          if (newSessionName !== null) {
            const nameToUse = newSessionName.trim() || `Session ${profile.sessions.length + 1}`;
            const newSession = {
              id: "session_" + Date.now(),
              name: nameToUse,
              timestamp: Date.now(),
              metricsA: null,
              metricsT: null,
              metricsOverhead: null,
              squatPeaks: getDefaultSquatPeaks(),
              imageA: null,
              imageT: null,
              imageOverhead: null,
              imageSquatL: null,
              imageSquatR: null,
              imageSquatFrontal: null,
              videoSquatL: null,
              videoSquatR: null,
              videoSquatFrontal: null,
              jointsOverhead: null,
              pixelsPerCm: null
            };
            profile.sessions.push(newSession);
            profile.activeSessionId = newSession.id;
            state.activeSessionId = newSession.id;
            await snapshotStore.saveProfile(profile);
            await loadProfileIntoState(profile.id);
          } else {
            sessionSelect.value = state.activeSessionId;
          }
        } else {
          state.activeSessionId = val;
          profile.activeSessionId = val;
          await snapshotStore.saveProfile(profile);
          await loadProfileIntoState(profile.id);
        }
      };
    }

  } catch (err) {
    console.error("[loadProfile] Error loading profile into state:", err);
  }
}

export async function autoSyncToActiveProfile(onlySquat = false) {
  if (!state.activeProfileId || !state.dbInitialized) return;
  try {
    let profile = await snapshotStore.getProfile(state.activeProfileId);
    if (!profile) return;
    
    // Ensure session properties are initialized
    profile = ensureProfileSessions(profile);
    
    // Find active session block
    let session = profile.sessions.find(s => String(s.id) === String(state.activeSessionId));
    if (!session) {
      session = profile.sessions.find(s => String(s.id) === String(profile.activeSessionId));
    }
    if (!session) {
      session = profile.sessions[profile.sessions.length - 1];
    }
    
    // Sync current dashboard state into the active session with non-null guards to prevent accidental deletion
    session.timestamp = Date.now();
    if (state.pixelsPerCm !== null && state.pixelsPerCm !== undefined) session.pixelsPerCm = state.pixelsPerCm;
    
    if (!onlySquat) {
      if (state.metricsA !== undefined) session.metricsA = state.metricsA;
      if (state.metricsT !== undefined) session.metricsT = state.metricsT;
      if (state.metricsOverhead !== undefined) session.metricsOverhead = state.metricsOverhead;
      if (state.imageA !== undefined) session.imageA = state.imageA;
      if (state.imageT !== undefined) session.imageT = state.imageT;
      if (state.imageOverhead !== undefined) session.imageOverhead = state.imageOverhead;
    }
    
    if (state.imageSquatL !== undefined) session.imageSquatL = state.imageSquatL;
    if (state.imageSquatR !== undefined) session.imageSquatR = state.imageSquatR;
    if (state.imageSquatFrontal !== undefined) session.imageSquatFrontal = state.imageSquatFrontal;
    
    if (state.videoSquatL !== undefined) session.videoSquatL = state.videoSquatL;
    if (state.videoSquatR !== undefined) session.videoSquatR = state.videoSquatR;
    if (state.videoSquatFrontal !== undefined) session.videoSquatFrontal = state.videoSquatFrontal;
    if (state.jointsOverhead !== undefined) session.jointsOverhead = state.jointsOverhead;

    if (state.squatPeaks !== undefined) {
      session.squatPeaks = state.squatPeaks ? JSON.parse(JSON.stringify(state.squatPeaks)) : null;
    }

    if (state.imageShoulderLStart !== undefined) session.imageShoulderLStart = state.imageShoulderLStart;
    if (state.imageShoulderLEnd !== undefined) session.imageShoulderLEnd = state.imageShoulderLEnd;
    if (state.imageShoulderRStart !== undefined) session.imageShoulderRStart = state.imageShoulderRStart;
    if (state.imageShoulderREnd !== undefined) session.imageShoulderREnd = state.imageShoulderREnd;
    
    if (state.videoShoulderL !== undefined) session.videoShoulderL = state.videoShoulderL;
    if (state.videoShoulderR !== undefined) session.videoShoulderR = state.videoShoulderR;
    if (state.jointsShoulderL !== undefined) session.jointsShoulderL = state.jointsShoulderL;
    if (state.jointsShoulderR !== undefined) session.jointsShoulderR = state.jointsShoulderR;

    if (state.shoulderPeaks !== undefined) {
      session.shoulderPeaks = state.shoulderPeaks ? JSON.parse(JSON.stringify(state.shoulderPeaks)) : null;
    }
    
    // Keep profile-level active session and timestamp synced
    profile.timestamp = Date.now();
    profile.activeSessionId = session.id;
    profile.videos = state.videos || [];
    
    // Keep legacy flat fields updated on the main profile for redundant backup
    if (state.pixelsPerCm !== null && state.pixelsPerCm !== undefined) profile.pixelsPerCm = state.pixelsPerCm;
    
    if (!onlySquat) {
      if (state.metricsA !== undefined) profile.metricsA = state.metricsA;
      if (state.metricsT !== undefined) profile.metricsT = state.metricsT;
      if (state.metricsOverhead !== undefined) profile.metricsOverhead = state.metricsOverhead;
      if (state.imageA !== undefined) profile.imageA = state.imageA;
      if (state.imageT !== undefined) profile.imageT = state.imageT;
      if (state.imageOverhead !== undefined) profile.imageOverhead = state.imageOverhead;
    }
    
    if (state.imageSquatL !== undefined) profile.imageSquatL = state.imageSquatL;
    if (state.imageSquatR !== undefined) profile.imageSquatR = state.imageSquatR;
    if (state.imageSquatFrontal !== undefined) profile.imageSquatFrontal = state.imageSquatFrontal;
    
    if (state.videoSquatL !== undefined) profile.videoSquatL = state.videoSquatL;
    if (state.videoSquatR !== undefined) profile.videoSquatR = state.videoSquatR;
    if (state.videoSquatFrontal !== undefined) profile.videoSquatFrontal = state.videoSquatFrontal;
    if (state.jointsOverhead !== undefined) profile.jointsOverhead = state.jointsOverhead;

    if (state.squatPeaks !== undefined) {
      profile.squatPeaks = state.squatPeaks ? JSON.parse(JSON.stringify(state.squatPeaks)) : null;
    }

    if (state.imageShoulderLStart !== undefined) profile.imageShoulderLStart = state.imageShoulderLStart;
    if (state.imageShoulderLEnd !== undefined) profile.imageShoulderLEnd = state.imageShoulderLEnd;
    if (state.imageShoulderRStart !== undefined) profile.imageShoulderRStart = state.imageShoulderRStart;
    if (state.imageShoulderREnd !== undefined) profile.imageShoulderREnd = state.imageShoulderREnd;
    
    if (state.videoShoulderL !== undefined) profile.videoShoulderL = state.videoShoulderL;
    if (state.videoShoulderR !== undefined) profile.videoShoulderR = state.videoShoulderR;
    if (state.jointsShoulderL !== undefined) profile.jointsShoulderL = state.jointsShoulderL;
    if (state.jointsShoulderR !== undefined) profile.jointsShoulderR = state.jointsShoulderR;

    if (state.shoulderPeaks !== undefined) {
      profile.shoulderPeaks = state.shoulderPeaks ? JSON.parse(JSON.stringify(state.shoulderPeaks)) : null;
    }
    
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
    autoSyncToActiveProfile(true);
  }, 1500);
}

export async function openProfileDetailsModal(profileId) {
  if (!profileId) return;

  state.activeModalVideoProcessing = false; // Set active flag on modal open to route results (disabled for performance)

  // Pause background video player if playing to prevent resource contention / overlapping frames
  const uploadedVideo = document.getElementById('uploaded-video');
  if (uploadedVideo) {
    try {
      uploadedVideo.pause();
    } catch (e) {}
  }
  if (state.modalObjectUrls) {
    state.modalObjectUrls.forEach(url => URL.revokeObjectURL(url));
  }
  state.modalObjectUrls = [];

  try {
    let profile = await snapshotStore.getProfile(profileId);
    if (!profile) return;

    // 1. Silent schema upgrade
    const originalSessionCount = profile.sessions ? profile.sessions.length : 0;
    profile = ensureProfileSessions(profile);
    if (originalSessionCount === 0) {
      await snapshotStore.saveProfile(profile);
    }

    if (state.activeProfileId === profileId) {
      state.videos = profile.videos || [];
    }

    // 1.6 Populate User Selector Dropdown inside Details Modal
    const userSelect = document.getElementById('profile-detail-user-select');
    if (userSelect) {
      userSelect.innerHTML = '';
      
      let allProfiles = state.allProfiles || [];
      if (allProfiles.length === 0) {
        allProfiles = await snapshotStore.getAllProfiles();
        state.allProfiles = allProfiles;
      }
      
      allProfiles.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name || `Profile #${p.id}`;
        if (p.id === profileId) {
          option.selected = true;
        }
        userSelect.appendChild(option);
      });

      userSelect.onchange = async (e) => {
        const selectedProfileId = Number(e.target.value);
        state.activeProfileId = selectedProfileId;
        
        // Reset active session ID in state so the newly selected user's default/last session loads cleanly
        state.activeSessionId = null;
        
        // Load the profile into global state & update sidebar dropdown selectors
        await loadProfileIntoState(selectedProfileId);
        
        // Refresh details modal for the selected user
        openProfileDetailsModal(selectedProfileId);
      };
    }

    // Determine the active session
    let activeSession = profile.sessions.find(s => String(s.id) === String(state.activeSessionId));
    if (!activeSession) {
      activeSession = profile.sessions.find(s => String(s.id) === String(profile.activeSessionId));
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
        if (String(sess.id) === String(activeSession.id)) {
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

    // 2.5 Synchronize unit switcher classes inside details modal
    const modalUnitInchBtn = document.getElementById('modal-unit-inch-btn');
    const modalUnitCmBtn = document.getElementById('modal-unit-cm-btn');
    if (modalUnitInchBtn && modalUnitCmBtn) {
      if (state.useInches) {
        modalUnitInchBtn.classList.add('active');
        modalUnitCmBtn.classList.remove('active');
      } else {
        modalUnitInchBtn.classList.remove('active');
        modalUnitCmBtn.classList.add('active');
      }
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
          squatPeaks: getDefaultSquatPeaks(),
          shoulderPeaks: getDefaultShoulderPeaks(),
          imageA: null,
          imageT: null,
          imageOverhead: null,
          imageSquatL: null,
          imageSquatR: null,
          imageSquatFrontal: null,
          imageShoulderLStart: null,
          imageShoulderLEnd: null,
          imageShoulderRStart: null,
          imageShoulderREnd: null,
          videoSquatL: null,
          videoSquatR: null,
          videoSquatFrontal: null,
          videoShoulderL: null,
          videoShoulderR: null,
          jointsOverhead: null,
          jointsShoulderL: null,
          jointsShoulderR: null
        };

        profile.sessions.push(newSession);
        profile.activeSessionId = newSession.id;
        state.activeSessionId = newSession.id;

        // Reset live dashboard metrics
        state.metricsA = null;
        state.metricsT = null;
        state.metricsOverhead = null;
        state.squatPeaks = getDefaultSquatPeaks();
        state.shoulderPeaks = getDefaultShoulderPeaks();
        state.imageA = null;
        state.imageT = null;
        state.imageOverhead = null;
        state.imageSquatL = null;
        state.imageSquatR = null;
        state.imageSquatFrontal = null;
        state.imageShoulderLStart = null;
        state.imageShoulderLEnd = null;
        state.imageShoulderRStart = null;
        state.imageShoulderREnd = null;
        state.videoShoulderL = null;
        state.videoShoulderR = null;
        state.jointsOverhead = null;
        state.jointsShoulderL = null;
        state.jointsShoulderR = null;

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
            const freshActiveSession = freshProfileMigrated.sessions.find(s => String(s.id) === String(activeSession.id));
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

    // 5. Pose status cards (now 8 items)
    const poses = [
      { key: 'a', metricsKey: 'metricsA', imgKey: 'imageA', title: 'A-Pose (Stature)', color: 'var(--color-scarlet)' },
      { key: 't', metricsKey: 'metricsT', imgKey: 'imageT', title: 'T-Pose (Wingspan)', color: 'var(--color-cyan)' },
      { key: 'overhead', metricsKey: 'metricsOverhead', imgKey: 'imageOverhead', title: 'Overhead (Reach)', color: '#d4a017' },
      { key: 'squat-l', metricsKey: 'squatPeaks', imgKey: 'imageSquatL', title: 'Left Overhead Squat', color: '#9333ea', isSquat: true, squatSide: 'kneeL' },
      { key: 'squat-r', metricsKey: 'squatPeaks', imgKey: 'imageSquatR', title: 'Right Overhead Squat', color: '#a855f7', isSquat: true, squatSide: 'kneeR' },
      { key: 'squat-frontal', metricsKey: 'squatPeaks', imgKey: 'imageSquatFrontal', title: 'Frontal Overhead Squat', color: '#ec4899', isSquat: true, squatSide: 'frontal' },
      { key: 'shoulder-l', metricsKey: 'shoulderPeaks', imgKey: 'imageShoulderLStart', title: 'Left Shoulder Flexion', color: '#BA0C2F', isShoulder: true },
      { key: 'shoulder-r', metricsKey: 'shoulderPeaks', imgKey: 'imageShoulderRStart', title: 'Right Shoulder Flexion', color: '#BA0C2F', isShoulder: true }
    ];

    poses.forEach(p => {
      const statusEl = document.getElementById(`detail-status-${p.key}`);
      const imgEl = document.getElementById(`detail-preview-img-${p.key}`);
      const containerEl = document.getElementById(`detail-preview-container-${p.key}`);
      
      let hasData = false;
      let imgSrc = activeSession[p.imgKey] || null;
      let hasVideo = false;

      if (p.isSquat) {
        const videoKey = p.key === 'squat-l' ? 'videoSquatL' : (p.key === 'squat-r' ? 'videoSquatR' : 'videoSquatFrontal');
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);

        let hasPeaks = false;
        if (activeSession.squatPeaks) {
          if (p.key === 'squat-l') {
            hasPeaks = (activeSession.squatPeaks.kneeL > 0 || activeSession.squatPeaks.kneeLTime > 0 || activeSession.squatPeaks.hipL > 0 || activeSession.squatPeaks.ankleL > 0);
          } else if (p.key === 'squat-r') {
            hasPeaks = (activeSession.squatPeaks.kneeR > 0 || activeSession.squatPeaks.kneeRTime > 0 || activeSession.squatPeaks.hipR > 0 || activeSession.squatPeaks.ankleR > 0);
          } else if (p.key === 'squat-frontal') {
            hasPeaks = (activeSession.squatPeaks.maxKneeCaveL > 0 || activeSession.squatPeaks.maxKneeCaveR > 0);
          }
        }
        hasData = !!imgSrc || hasVideo || hasPeaks;
      } else if (p.isShoulder) {
        const videoKey = p.key === 'shoulder-l' ? 'videoShoulderL' : 'videoShoulderR';
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);
        
        let hasShoulderPeaks = false;
        if (activeSession.shoulderPeaks) {
          if (p.key === 'shoulder-l') {
            hasShoulderPeaks = (activeSession.shoulderPeaks.excursionL > 0 || activeSession.shoulderPeaks.startAngleL !== null || activeSession.shoulderPeaks.endAngleL !== null);
          } else {
            hasShoulderPeaks = (activeSession.shoulderPeaks.excursionR > 0 || activeSession.shoulderPeaks.startAngleR !== null || activeSession.shoulderPeaks.endAngleR !== null);
          }
        }
        hasData = !!imgSrc || hasVideo || hasShoulderPeaks;
      } else {
        hasData = !!imgSrc || !!activeSession[p.metricsKey];
      }

      if (hasData) {
        if (statusEl) {
          statusEl.textContent = "✅ Complete";
          statusEl.className = 'text-emerald';
        }
        if (containerEl) {
          containerEl.classList.remove('hidden');
          containerEl.innerHTML = ''; // Clear existing element

          if (p.isSquat && hasVideo) {
            const videoKey = p.key === 'squat-l' ? 'videoSquatL' : (p.key === 'squat-r' ? 'videoSquatR' : 'videoSquatFrontal');
            const sVideo = activeSession[videoKey];
            const videoUrl = URL.createObjectURL(sVideo.blob);
            state.modalObjectUrls.push(videoUrl);

            // Container for interactive preview
            const cardWrapper = document.createElement('div');
            cardWrapper.className = 'premium-video-preview-card';
            cardWrapper.style.cssText = 'position: relative; width: 100%; max-height: 120px; aspect-ratio: 16/9; overflow: hidden; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); background: #000; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);';

            // Muted, non-interactive video thumbnail seeked to 0.5s to act as a poster frame
            const previewVideo = document.createElement('video');
            previewVideo.src = videoUrl;
            previewVideo.muted = true;
            previewVideo.playsInline = true;
            previewVideo.style.cssText = 'width: 100%; height: 100%; object-fit: cover; filter: brightness(0.65) contrast(1.05); transition: all 0.3s ease; pointer-events: none;';
            
            // Wait for metadata to load, then seek to 0.5s for a nice poster frame
            previewVideo.addEventListener('loadedmetadata', () => {
              previewVideo.currentTime = Math.min(0.5, previewVideo.duration / 2);
            });

            // Glowing cyan scale-on-hover play button labeled "Play with Overlay"
            const playOverlay = document.createElement('div');
            playOverlay.className = 'play-overlay-button';
            playOverlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: rgba(15, 22, 38, 0.45); backdrop-filter: blur(1px); transition: all 0.3s ease;';

            // Play Icon SVG (cyan with glow)
            const playIconSvg = `
              <div class="glowing-play-circle" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid #00e5ff; display: flex; align-items: center; justify-content: center; color: #00e5ff; background: rgba(0, 229, 255, 0.05); box-shadow: 0 0 10px rgba(0, 229, 255, 0.2); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-left: 2px;">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </div>
              <span style="font-size: 10px; font-weight: 700; color: #00e5ff; letter-spacing: 0.5px; text-transform: uppercase; text-shadow: 0 0 8px rgba(0,229,255,0.4);">Play with Overlay</span>
            `;
            playOverlay.innerHTML = playIconSvg;

            cardWrapper.appendChild(previewVideo);
            cardWrapper.appendChild(playOverlay);
            containerEl.appendChild(cardWrapper);

            // Hover interactions
            cardWrapper.addEventListener('mouseenter', () => {
              cardWrapper.style.borderColor = 'rgba(0, 229, 255, 0.4)';
              cardWrapper.style.boxShadow = '0 0 12px rgba(0, 229, 255, 0.2)';
              previewVideo.style.filter = 'brightness(0.8) scale(1.04)';
              const circle = playOverlay.querySelector('.glowing-play-circle');
              if (circle) {
                circle.style.transform = 'scale(1.15)';
                circle.style.background = '#00e5ff';
                circle.style.color = '#000';
                circle.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.6)';
              }
            });

            cardWrapper.addEventListener('mouseleave', () => {
              cardWrapper.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              cardWrapper.style.boxShadow = 'none';
              previewVideo.style.filter = 'brightness(0.65) contrast(1.05)';
              const circle = playOverlay.querySelector('.glowing-play-circle');
              if (circle) {
                circle.style.transform = 'scale(1)';
                circle.style.background = 'rgba(0, 229, 255, 0.05)';
                circle.style.color = '#00e5ff';
                circle.style.boxShadow = '0 0 10px rgba(0, 229, 255, 0.2)';
              }
            });

            // Bind click handler to select and play inside central player
            cardWrapper.addEventListener('click', (e) => {
              e.stopPropagation();
              
              const mainVideoPlayer = document.getElementById('profile-details-video-player');
              const videoPlaceholder = document.getElementById('profile-details-video-placeholder');
              
              // 1. Find corresponding playlist item & click it (triggers selectVideo, syncing player and highlighting playlist item)
              const playlistRow = document.querySelector(`.profile-video-row-item[data-video-id="${sVideo.id}"]`);
              if (playlistRow) {
                playlistRow.click();
              } else {
                // Fallback direct binding if playlist item is not found (should not happen)
                if (p.key === 'squat-l') {
                  state.squatTestingSide = 'left';
                  state.allowFrontalUpdateL = false;
                  state.allowFrontalUpdateR = false;
                } else if (p.key === 'squat-r') {
                  state.squatTestingSide = 'right';
                  state.allowFrontalUpdateL = false;
                  state.allowFrontalUpdateR = false;
                } else if (p.key === 'squat-frontal') {
                  state.squatTestingSide = 'frontal';
                  state.allowFrontalUpdateL = (!state.squatPeaks || (state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0));
                  state.allowFrontalUpdateR = (!state.squatPeaks || (state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0));
                }
                if (mainVideoPlayer) {
                  const canvas = document.getElementById('profile-details-video-canvas');
                  if (canvas) {
                    const ctx = canvas.getContext('2d');
                    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
                  }
                  mainVideoPlayer.src = videoUrl;
                  mainVideoPlayer.style.display = 'block';
                  if (videoPlaceholder) {
                    videoPlaceholder.style.display = 'none';
                  }
                  const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
                  if (btnFullscreen) {
                    btnFullscreen.style.display = 'flex';
                  }
                  mainVideoPlayer.play().catch(err => console.log("[VideoPlay] Autoplay blocked:", err));
                }
              }

              // 2. Smoothly scroll central player container into view
              const playerContainer = document.getElementById('profile-details-video-player-container');
              if (playerContainer) {
                playerContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Flash the player border to draw user attention premium-style
                playerContainer.style.borderColor = '#00e5ff';
                playerContainer.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.35)';
                setTimeout(() => {
                  playerContainer.style.borderColor = 'rgba(255,255,255,0.08)';
                  playerContainer.style.boxShadow = 'none';
                }, 1200);
              }
            });
          } else if (p.isShoulder) {
            // Support single snapshot image preview
            if (imgSrc) {
              const myImgEl = document.createElement('img');
              myImgEl.src = imgSrc;
              myImgEl.alt = `${p.title} Preview`;
              myImgEl.style.cssText = 'width: 100%; height: auto; max-height: 120px; object-fit: contain; display: block; border-radius: 4px; cursor: pointer; transition: transform 0.2s, border-color 0.2s;';
              myImgEl.onmouseover = () => {
                myImgEl.style.transform = 'scale(1.02)';
                myImgEl.style.borderColor = 'rgba(0, 229, 255, 0.45)';
              };
              myImgEl.onmouseout = () => {
                myImgEl.style.transform = 'scale(1)';
                myImgEl.style.borderColor = 'rgba(255,255,255,0.05)';
              };
              myImgEl.onclick = (e) => {
                e.stopPropagation();
                if (window.expandLightboxImage) {
                  window.expandLightboxImage(imgSrc, `${p.title} Snapshot`);
                }
              };
              containerEl.appendChild(myImgEl);
            }
            
            // Check if there is a recorded shoulder video to play as well!
            const videoKey = p.key === 'shoulder-l' ? 'videoShoulderL' : 'videoShoulderR';
            const sVideo = activeSession[videoKey];
            if (sVideo && sVideo.blob) {
              const videoUrl = URL.createObjectURL(sVideo.blob);
              state.modalObjectUrls.push(videoUrl);

              const playOverlayBtn = document.createElement('button');
              playOverlayBtn.className = 'btn';
              playOverlayBtn.textContent = '▶ Play Video Playout';
              playOverlayBtn.style.cssText = 'width: 100%; margin-top: 6px; padding: 4px 8px; font-size: 0.75rem; border-radius: 4px; font-weight: 600; cursor: pointer; background: rgba(0, 229, 255, 0.1); border: 1px solid rgba(0, 229, 255, 0.25); color: #00e5ff;';
              
              playOverlayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mainVideoPlayer = document.getElementById('profile-details-video-player');
                const videoPlaceholder = document.getElementById('profile-details-video-placeholder');
                
                // Seek player to video and highlight playlist item
                const playlistRow = document.querySelector(`.profile-video-row-item[data-video-id="${sVideo.id}"]`);
                if (playlistRow) {
                  playlistRow.click();
                } else {
                  if (mainVideoPlayer) {
                    mainVideoPlayer.src = videoUrl;
                    mainVideoPlayer.style.display = 'block';
                    if (videoPlaceholder) {
                      videoPlaceholder.style.display = 'none';
                    }
                    mainVideoPlayer.play().catch(e => {});
                  }
                }
              });
              containerEl.appendChild(playOverlayBtn);
            }
          } else if (imgSrc) {
            const myImgEl = document.createElement('img');
            myImgEl.src = imgSrc;
            myImgEl.alt = `${p.title} Preview`;
            myImgEl.style.cssText = 'width: 100%; height: auto; max-height: 120px; object-fit: contain; display: block; border-radius: 4px;';
            containerEl.appendChild(myImgEl);
          } else {
            containerEl.classList.add('hidden');
          }
        }

        // Show delete button
        const deleteBtn = document.getElementById(`btn-delete-pose-${p.key}`);
        if (deleteBtn) {
          deleteBtn.classList.remove('hidden');
          deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm(`Are you sure you want to permanently delete all data (image, video, metrics) for ${p.title}? This cannot be undone.`)) {
              return;
            }
            try {
              const freshProfile = await snapshotStore.getProfile(profileId);
              if (!freshProfile) return;
              
              const freshProfileMigrated = ensureProfileSessions(freshProfile);
              const freshActiveSession = freshProfileMigrated.sessions.find(s => String(s.id) === String(activeSession.id)) || freshProfileMigrated.sessions[0];
              
              // 1. Clear the image
              freshActiveSession[p.imgKey] = null;
              
              // 2. Pose-specific clearing
              if (p.isSquat) {
                // Clear video reference and filter from playlist
                const videoKey = p.key === 'squat-l' ? 'videoSquatL' : (p.key === 'squat-r' ? 'videoSquatR' : 'videoSquatFrontal');
                const sVideo = freshActiveSession[videoKey];
                if (sVideo) {
                   freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                   freshActiveSession[videoKey] = null;
                }
                
                // Clear peaks
                if (freshActiveSession.squatPeaks) {
                  if (p.key === 'squat-l') {
                    freshActiveSession.squatPeaks.kneeL = 0;
                    freshActiveSession.squatPeaks.kneeLTime = 0;
                    freshActiveSession.squatPeaks.hipL = 0;
                    freshActiveSession.squatPeaks.ankleL = 0;
                  } else if (p.key === 'squat-r') {
                    freshActiveSession.squatPeaks.kneeR = 0;
                    freshActiveSession.squatPeaks.kneeRTime = 0;
                    freshActiveSession.squatPeaks.hipR = 0;
                    freshActiveSession.squatPeaks.ankleR = 0;
                  } else if (p.key === 'squat-frontal') {
                    freshActiveSession.squatPeaks.maxKneeCaveL = 0;
                    freshActiveSession.squatPeaks.maxKneeCaveR = 0;
                    freshActiveSession.jointsOverhead = null;
                  }
                }
              } else if (p.isShoulder) {
                // Clear video reference and filter from playlist
                const videoKey = p.key === 'shoulder-l' ? 'videoShoulderL' : 'videoShoulderR';
                const sVideo = freshActiveSession[videoKey];
                if (sVideo) {
                  freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                  freshActiveSession[videoKey] = null;
                }

                if (p.key === 'shoulder-l') {
                  freshActiveSession.imageShoulderLStart = null;
                  freshActiveSession.imageShoulderLEnd = null;
                  if (freshActiveSession.shoulderPeaks) {
                    freshActiveSession.shoulderPeaks.excursionL = 0;
                    freshActiveSession.shoulderPeaks.startAngleL = null;
                    freshActiveSession.shoulderPeaks.endAngleL = null;
                    freshActiveSession.shoulderPeaks.jointsL = null;
                  }
                } else {
                  freshActiveSession.imageShoulderRStart = null;
                  freshActiveSession.imageShoulderREnd = null;
                  if (freshActiveSession.shoulderPeaks) {
                    freshActiveSession.shoulderPeaks.excursionR = 0;
                    freshActiveSession.shoulderPeaks.startAngleR = null;
                    freshActiveSession.shoulderPeaks.endAngleR = null;
                    freshActiveSession.shoulderPeaks.jointsR = null;
                  }
                }
              } else {
                // Clear metrics
                freshActiveSession[p.metricsKey] = null;
              }
              
              // 3. Mirror to legacy fields for backwards compatibility
              freshProfileMigrated.metricsA = freshActiveSession.metricsA;
              freshProfileMigrated.metricsT = freshActiveSession.metricsT;
              freshProfileMigrated.metricsOverhead = freshActiveSession.metricsOverhead;
              freshProfileMigrated.squatPeaks = freshActiveSession.squatPeaks;
              freshProfileMigrated.shoulderPeaks = freshActiveSession.shoulderPeaks;
              freshProfileMigrated.imageA = freshActiveSession.imageA;
              freshProfileMigrated.imageT = freshActiveSession.imageT;
              freshProfileMigrated.imageOverhead = freshActiveSession.imageOverhead;
              freshProfileMigrated.imageSquatL = freshActiveSession.imageSquatL;
              freshProfileMigrated.imageSquatR = freshActiveSession.imageSquatR;
              freshProfileMigrated.imageSquatFrontal = freshActiveSession.imageSquatFrontal;
              freshProfileMigrated.imageShoulderLStart = freshActiveSession.imageShoulderLStart;
              freshProfileMigrated.imageShoulderLEnd = freshActiveSession.imageShoulderLEnd;
              freshProfileMigrated.imageShoulderRStart = freshActiveSession.imageShoulderRStart;
              freshProfileMigrated.imageShoulderREnd = freshActiveSession.imageShoulderREnd;
              freshProfileMigrated.jointsOverhead = freshActiveSession.jointsOverhead || null;
              freshProfileMigrated.jointsShoulderL = freshActiveSession.jointsShoulderL || null;
              freshProfileMigrated.jointsShoulderR = freshActiveSession.jointsShoulderR || null;
              
              await snapshotStore.saveProfile(freshProfileMigrated);
              state.allProfiles = await snapshotStore.getAllProfiles();
              if (state.activeProfileId === profileId) {
                await loadProfileIntoState(profileId);
              }
              
              alert(`${p.title} data deleted successfully.`);
              openProfileDetailsModal(profileId);
            } catch (err) {
              console.error(`[DeletePoseData] Failed to delete data for ${p.key}:`, err);
              alert("Failed to delete posture data: " + err.message);
            }
          };
        }
      } else {
        if (statusEl) {
          statusEl.textContent = "❌ Missing";
          statusEl.className = 'text-red';
        }
        if (containerEl) containerEl.classList.add('hidden');
        if (imgEl) imgEl.src = "";

        // Hide delete button
        const deleteBtn = document.getElementById(`btn-delete-pose-${p.key}`);
        if (deleteBtn) {
          deleteBtn.classList.add('hidden');
          deleteBtn.onclick = null;
        }
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
            const freshActiveSession = freshProfileMigrated.sessions.find(s => String(s.id) === String(activeSession.id)) || freshProfileMigrated.sessions[0];
            
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
              freshActiveSession.squatPeaks = getDefaultSquatPeaks();
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

            // Save shoulder peaks mobility records in session
            if (!freshActiveSession.shoulderPeaks) {
              freshActiveSession.shoulderPeaks = getDefaultShoulderPeaks();
            }
            const shoulderInputs = document.querySelectorAll('.profile-shoulder-edit-input');
            shoulderInputs.forEach(input => {
              const side = input.getAttribute('data-side');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseFloat(rawVal);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              if (side === 'L') {
                freshActiveSession.shoulderPeaks.excursionL = val;
              } else {
                freshActiveSession.shoulderPeaks.excursionR = val;
              }
            });
            
            // Mirror back to legacy fields for redundancy
            freshProfileMigrated.metricsA = freshActiveSession.metricsA;
            freshProfileMigrated.metricsT = freshActiveSession.metricsT;
            freshProfileMigrated.metricsOverhead = freshActiveSession.metricsOverhead;
            freshProfileMigrated.squatPeaks = freshActiveSession.squatPeaks;
            freshProfileMigrated.shoulderPeaks = freshActiveSession.shoulderPeaks;
            freshProfileMigrated.imageA = freshActiveSession.imageA;
            freshProfileMigrated.imageT = freshActiveSession.imageT;
            freshProfileMigrated.imageOverhead = freshActiveSession.imageOverhead;
            freshProfileMigrated.imageSquatL = freshActiveSession.imageSquatL;
            freshProfileMigrated.imageSquatR = freshActiveSession.imageSquatR;
            freshProfileMigrated.imageSquatFrontal = freshActiveSession.imageSquatFrontal;
            freshProfileMigrated.jointsOverhead = freshActiveSession.jointsOverhead || null;

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
    
    const sPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
    // Safe Migration/Reset: Since the absolute maximum possible angular deviation from perpendicular is 90.0 degrees,
    // any legacy peak values > 90.0 are leftover centimeter/inch records and are automatically reset to 0.
    if (sPeaks.maxKneeCaveL > 90.0) sPeaks.maxKneeCaveL = 0;
    if (sPeaks.maxKneeCaveR > 90.0) sPeaks.maxKneeCaveR = 0;

    if (dsqKnee) dsqKnee.innerHTML = renderSquatPeakEdit('knee', sPeaks.kneeL, sPeaks.kneeR);
    if (dsqHip) dsqHip.innerHTML = renderSquatPeakEdit('hip', sPeaks.hipL, sPeaks.hipR);
    if (dsqAnkle) dsqAnkle.innerHTML = renderSquatPeakEdit('ankle', sPeaks.ankleL, sPeaks.ankleR);

    // 9.5 Shoulder Flexion Peaks
    const dshExcursionL = document.getElementById('detail-shoulder-excursion-l');
    const dshExcursionR = document.getElementById('detail-shoulder-excursion-r');
    const shPeaks = getDefaultShoulderPeaks(activeSession.shoulderPeaks);

    if (dshExcursionL) {
      if (!state.isEditingProfileMetrics) {
        dshExcursionL.innerHTML = shPeaks.excursionL ? `${shPeaks.excursionL.toFixed(1)}°` : '0°';
      } else {
        dshExcursionL.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-shoulder-edit-input profile-edit-input shoulder" 
                   data-side="L" 
                   value="${shPeaks.excursionL ? shPeaks.excursionL.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dshExcursionR) {
      if (!state.isEditingProfileMetrics) {
        dshExcursionR.innerHTML = shPeaks.excursionR ? `${shPeaks.excursionR.toFixed(1)}°` : '0°';
      } else {
        dshExcursionR.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-shoulder-edit-input profile-edit-input shoulder" 
                   data-side="R" 
                   value="${shPeaks.excursionR ? shPeaks.excursionR.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }

    const dsqDepth = document.getElementById('detail-squat-depth');
    if (dsqDepth) {
      const maxKneeMob = Math.max(sPeaks.kneeL || 0, sPeaks.kneeR || 0);
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

      dsqDepth.textContent = depthStatus;
      dsqDepth.className = `squat-peak-detail-val ${statusClass}`;
    }

    // Peak-level Knee Cave-In Summary rendering (handles both Static Snapshot and Frontal Video Timeline scans)
    const detailSquatAsymmetrySummary = document.getElementById('detail-squat-asymmetry-summary');
    if (detailSquatAsymmetrySummary) {
      let imageHtml = "";
      let videoHtml = "";

      // 1. Static Image Knee Alignment
      let hasImage = false;
      if (activeSession.jointsOverhead) {
        hasImage = true;
        const valgus = calculateValgusFromJoints(activeSession.jointsOverhead);
        const imgL = valgus.pctL;
        const imgR = valgus.pctR;
        const maxImgCave = Math.max(imgL, imgR);
        const lStr = `${imgL.toFixed(1)}°`;
        const rStr = `${imgR.toFixed(1)}°`;
        
        let color = "#10b981"; // Emerald
        let statusText = `Excellent Alignment: Both knees perpendicular to baseline (L: ${lStr}, R: ${rStr}).`;
        if (maxImgCave > 15.0) {
          color = "#ef4444"; // Scarlet
          statusText = `Severe Deviation: Significant knee cave-in detected (L: ${lStr}, R: ${rStr}). Focus on stability.`;
        } else if (maxImgCave > 8.0) {
          color = "#ff9f43"; // Amber
          statusText = `Moderate Deviation: Knees cave inward past baseline (L: ${lStr}, R: ${rStr}).`;
        } else if (maxImgCave >= 3.0) {
          color = "#ffb300"; // Yellow-Amber
          statusText = `Mild Deviation: Minor knee tracking variance (L: ${lStr}, R: ${rStr}).`;
        }

        imageHtml = `
          <div style="padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.015); text-align: left;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #d4a017;"></span> Static Overhead Snapshot
            </div>
            <div style="font-size: 13px; color: ${color}; font-weight: 500;">
              ${statusText}
            </div>
          </div>
        `;
      }

      // 2. Video Knee Alignment & Valgus Timestamps
      let hasVideoData = false;
      if (sPeaks.maxKneeCaveL > 0 || sPeaks.maxKneeCaveR > 0) {
        hasVideoData = true;
        const vidL = sPeaks.maxKneeCaveL || 0;
        const vidR = sPeaks.maxKneeCaveR || 0;
        const maxVidCave = Math.max(vidL, vidR);
        const lStr = `${vidL.toFixed(1)}°`;
        const rStr = `${vidR.toFixed(1)}°`;

        let color = "#10b981"; // Emerald
        let statusTitle = "✅ Stable Knee Alignment (Video Scan)";
        let explanationText = `Knees tracking cleanly over feet. Peak deviation: L: ${lStr}, R: ${rStr}.`;
        let timestampText = "";

        if (maxVidCave > 8.0) {
          const isSevere = maxVidCave > 15.0;
          color = isSevere ? "#ef4444" : "#ff9f43"; // Scarlet or Amber
          statusTitle = isSevere ? "🚨 Severe Knee Valgus (Cave-In) Detected" : "⚠️ Moderate Knee Valgus (Cave-In) Detected";
          explanationText = `Knees caved inward past safe tracking boundaries. Peak: L: ${lStr}, R: ${rStr}.`;
          
          const tFirst = sPeaks.valgusFirstTimestamp;
          const tPeak = sPeaks.valgusPeakTimestamp;
          
          if (tFirst !== null && tFirst !== undefined) {
            timestampText = `
              <div style="margin-top: 6px; font-size: 11px; color: #9ca3af; display: flex; flex-direction: column; gap: 2px;">
                <span>⏱️ Valgus first appeared at: <strong>${tFirst.toFixed(1)}s</strong> in the video timeline.</span>
                ${tPeak !== null && tPeak !== undefined ? `<span>🎯 Peak Valgus reached at: <strong>${tPeak.toFixed(1)}s</strong> (deviation of ${maxVidCave.toFixed(1)}°).</span>` : ""}
              </div>
            `;
          } else {
            timestampText = `
              <div style="margin-top: 6px; font-size: 11px; color: #9ca3af;">
                🎯 Peak deviation of <strong>${maxVidCave.toFixed(1)}°</strong> recorded during scan.
              </div>
            `;
          }
        } else if (maxVidCave >= 3.0) {
          color = "#ffb300"; // Yellow-Amber
          statusTitle = "⚠️ Mild Knee Tracking Deviation";
          explanationText = `Slight knee deviation during squat video. Peak: L: ${lStr}, R: ${rStr}.`;
        }

        videoHtml = `
          <div style="padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.015); text-align: left;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #ec4899;"></span> Frontal Squat Video Timeline
            </div>
            <div style="font-size: 13px; color: ${color}; font-weight: 600;">
              ${statusTitle}
            </div>
            <div style="font-size: 12px; color: #ccc; margin-top: 2px;">
              ${explanationText}
            </div>
            ${timestampText}
          </div>
        `;
      }

      // Assemble final combined layout
      if (!hasImage && !hasVideoData) {
        detailSquatAsymmetrySummary.innerHTML = `
          <span style="color: #888; font-style: italic;">Knee Alignment & Valgus Tracking: No frontal squat image or video scan completed yet.</span>
        `;
        detailSquatAsymmetrySummary.style.color = "#aaa";
        detailSquatAsymmetrySummary.style.borderColor = "rgba(255, 255, 255, 0.03)";
        detailSquatAsymmetrySummary.style.background = "rgba(255, 255, 255, 0.01)";
        detailSquatAsymmetrySummary.style.padding = "6px 12px";
        detailSquatAsymmetrySummary.style.border = "1px solid rgba(255,255,255,0.03)";
      } else {
        detailSquatAsymmetrySummary.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
            ${videoHtml}
            ${imageHtml}
          </div>
        `;
        detailSquatAsymmetrySummary.style.border = "none";
        detailSquatAsymmetrySummary.style.background = "transparent";
        detailSquatAsymmetrySummary.style.padding = "0";
      }
    }

    // 10. Populate Saved Videos & Interactive Playlist Manager

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
          videoRow.setAttribute('data-video-id', video.id);
          videoRow.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 4px; padding: 0.5rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; cursor: pointer; transition: all 0.2s;';
          
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

            // Automatically detect and set the squat testing side from video name
            const lowerName = (video.name || '').toLowerCase();
            if (lowerName.includes('left')) {
              state.squatTestingSide = 'left';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('right')) {
              state.squatTestingSide = 'right';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('frontal') || lowerName.includes('front')) {
              state.squatTestingSide = 'frontal';
              state.allowFrontalUpdateL = (!state.squatPeaks || (state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0));
              state.allowFrontalUpdateR = (!state.squatPeaks || (state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0));
            } else {
              // Default fallback
              state.squatTestingSide = state.squatTestingSide || 'frontal';
            }

            if (mainVideoPlayer) {
              const canvas = document.getElementById('profile-details-video-canvas');
              if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
              mainVideoPlayer.src = videoUrl;
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
              const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
              if (btnFullscreen) {
                btnFullscreen.style.display = 'flex';
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
              const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
              if (btnFullscreen) {
                btnFullscreen.style.display = 'flex';
              }
            }

            // Automatically detect and set the squat testing side for the pre-selected video
            const lowerName = (video.name || '').toLowerCase();
            if (lowerName.includes('left')) {
              state.squatTestingSide = 'left';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('right')) {
              state.squatTestingSide = 'right';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('frontal') || lowerName.includes('front')) {
              state.squatTestingSide = 'frontal';
              state.allowFrontalUpdateL = (!state.squatPeaks || (state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0));
              state.allowFrontalUpdateR = (!state.squatPeaks || (state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0));
            } else {
              // Default fallback
              state.squatTestingSide = state.squatTestingSide || 'frontal';
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
                
                // Clear any corresponding session-level squat video references
                const freshProfileMigrated = ensureProfileSessions(freshProfile);
                if (freshProfileMigrated.sessions && Array.isArray(freshProfileMigrated.sessions)) {
                  freshProfileMigrated.sessions.forEach(s => {
                    if (s.videoSquatL && s.videoSquatL.id === video.id) s.videoSquatL = null;
                    if (s.videoSquatR && s.videoSquatR.id === video.id) s.videoSquatR = null;
                    if (s.videoSquatFrontal && s.videoSquatFrontal.id === video.id) s.videoSquatFrontal = null;
                    if (s.videoShoulderL && s.videoShoulderL.id === video.id) s.videoShoulderL = null;
                    if (s.videoShoulderR && s.videoShoulderR.id === video.id) s.videoShoulderR = null;
                  });
                }
                
                await snapshotStore.saveProfile(freshProfileMigrated);
                state.allProfiles = await snapshotStore.getAllProfiles();
                if (state.activeProfileId === profileId) {
                  await loadProfileIntoState(profileId);
                }
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

  state.activeModalVideoProcessing = false;
  state.isModalVideoInferenceLoopRunning = false;

  const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.style.display = 'none';
  }

  // Safely exit fullscreen if the modal is closed in fullscreen mode
  const currentFullscreenElement = document.fullscreenElement || 
                                   document.webkitFullscreenElement || 
                                   document.mozFullScreenElement || 
                                   document.msFullscreenElement;
  if (currentFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(e => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  const mainVideoPlayer = document.getElementById('profile-details-video-player');
  if (mainVideoPlayer) {
    try {
      mainVideoPlayer.pause();
    } catch (e) {}
  }

  // Delay revoking the Object URLs and resetting the player src by 150ms 
  // to ensure any currently in-flight asynchronous pose.send() call fully terminates first.
  // This prevents WebGL context destruction / invalid texture crashes inside MediaPipe's WASM engine.
  setTimeout(() => {
    const player = document.getElementById('profile-details-video-player');
    if (player) {
      player.src = "";
    }
    if (state.modalObjectUrls) {
      state.modalObjectUrls.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      });
      state.modalObjectUrls = [];
    }
  }, 150);

  state.isEditingProfileMetrics = false;

  const canvas = document.getElementById('profile-details-video-canvas');
  if (canvas) {
    canvas.style.display = 'none';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function startModalVideoInferenceLoop() {
  if (state.isModalVideoInferenceLoopRunning) return;
  state.isModalVideoInferenceLoopRunning = true;

  async function modalVideoInferenceLoop() {
    const video = document.getElementById('profile-details-video-player');
    if (!state.activeModalVideoProcessing || !video || video.paused || video.ended || !video.src || video.readyState < 2) {
      state.isModalVideoInferenceLoopRunning = false;
      return;
    }

    const startTime = Date.now();
    try {
      await pose.send({ image: video });
    } catch (err) {
      console.warn("[ModalVideoInference] MediaPipe parsing error:", err);
    }

    const elapsed = Date.now() - startTime;
    const delay = Math.max(50 - elapsed, 1); // target ~20fps (50ms per frame) to prevent CPU starvation
    if (state.activeModalVideoProcessing) {
      setTimeout(modalVideoInferenceLoop, delay);
    } else {
      state.isModalVideoInferenceLoopRunning = false;
    }
  }

  modalVideoInferenceLoop();
}

export async function triggerSingleModalVideoInference() {
  const video = document.getElementById('profile-details-video-player');
  if (!video || !video.src || video.readyState < 2) return;
  try {
    await pose.send({ image: video });
  } catch (err) {
    console.warn("[ModalVideoSingleInference] MediaPipe parsing error:", err);
  }
}

export function drawModalVideoPoseOverlay(results) {
  const canvas = document.getElementById('profile-details-video-canvas');
  if (!canvas) return;

  const video = document.getElementById('profile-details-video-player');
  if (!video) return;

  // Clear if no landmarks
  if (!results || !results.poseLandmarks) {
    canvas.style.display = 'none';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Ensure canvas dimensions match the display style of the video element
  if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
  }

  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Temporarily set canvasWidth/Height so calculatePoseMetrics handles correct scale factor
  const oldWidth = state.canvasWidth;
  const oldHeight = state.canvasHeight;
  state.canvasWidth = video.clientWidth || 640;
  state.canvasHeight = video.clientHeight || 480;

  const calculated = calculatePoseMetrics(results);

  // Restore immediately
  state.canvasWidth = oldWidth;
  state.canvasHeight = oldHeight;

  if (calculated) {
    let isShoulderVideo = false;
    const activeItem = document.querySelector('.profile-video-row-item.active-playlist-item');
    if (activeItem) {
      const titleEl = activeItem.querySelector('.playlist-video-name');
      if (titleEl) {
        const txt = titleEl.textContent.toLowerCase();
        if (txt.includes('shoulder') || txt.includes('flexion')) {
          isShoulderVideo = true;
        }
      }
    }

    if (isShoulderVideo) {
      const activeItemName = activeItem.querySelector('.playlist-video-name').textContent.toLowerCase();
      const side = activeItemName.includes('right') ? 'right' : 'left';
      
      const angleInfo = getShoulderWristAngle(results.poseLandmarks, side);
      if (angleInfo) {
        // Draw standard skeletal mesh elements
        drawFullSkeletalMesh(calculated.all_landmarks, ctx);
        
        // Draw vertical reference line straight down from the shoulder
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(angleInfo.shoulder.x, angleInfo.shoulder.y);
        ctx.lineTo(angleInfo.shoulder.x, angleInfo.shoulder.y + 120); // vertical down
        ctx.stroke();
        ctx.restore();

        // Draw angle arc at the shoulder
        const r = 40;
        ctx.save();
        ctx.strokeStyle = '#BA0C2F'; // Scarlet red
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const armAngleRad = Math.atan2(angleInfo.wrist.y - angleInfo.shoulder.y, angleInfo.wrist.x - angleInfo.shoulder.x);
        ctx.arc(angleInfo.shoulder.x, angleInfo.shoulder.y, r, Math.PI / 2, armAngleRad, armAngleRad < Math.PI / 2);
        ctx.stroke();
        ctx.restore();

        // Draw a premium crimson glowing line for the active arm (shoulder to wrist)
        ctx.save();
        ctx.strokeStyle = '#BA0C2F';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#BA0C2F';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(angleInfo.shoulder.x, angleInfo.shoulder.y);
        ctx.lineTo(angleInfo.wrist.x, angleInfo.wrist.y);
        ctx.stroke();
        ctx.restore();

        // Draw floating angle badge near the wrist
        drawAngleBadge(ctx, angleInfo.wrist, Math.round(angleInfo.angleDeg), '#BA0C2F');
      }
    } else {
      // Draw standard skeletal mesh elements
      drawFullSkeletalMesh(calculated.all_landmarks, ctx);

      // Draw skeletal bones and joint points
      drawSkeletalFramework(calculated, ctx);

      // Draw Angle Badges
      drawAngleBadge(ctx, calculated.knee_l, calculated.kneeAngleL, '#10b981');
      drawAngleBadge(ctx, calculated.hip_l, calculated.hipAngleL, '#d4a017');
      drawAngleBadge(ctx, calculated.ankle_l, calculated.ankleAngleL, '#06b6d4');

      drawAngleBadge(ctx, calculated.knee_r, calculated.kneeAngleR, '#10b981');
      drawAngleBadge(ctx, calculated.hip_r, calculated.hipAngleR, '#d4a017');
      drawAngleBadge(ctx, calculated.ankle_r, calculated.ankleAngleR, '#06b6d4');

      // Frontal Knee Valgus Badges
      const valgus = calculateValgusFromJoints(calculated);
      const kneeMobL = 180 - (calculated.kneeAngleL || 180);
      const kneeMobR = 180 - (calculated.kneeAngleR || 180);
      if (kneeMobL >= 15 && valgus.pctL > 4.0) {
        drawValgusBadge(ctx, calculated.knee_l, valgus.pctL);
      }
      if (kneeMobR >= 15 && valgus.pctR > 4.0) {
        drawValgusBadge(ctx, calculated.knee_r, valgus.pctR);
      }
    }
  }
}

// =====================================================================
// SCARLET VIDEO RECORDING COMPONENT (HIGH-DEFINITION SIDE-BY-SIDE GRID)
// Placed at the bottom to prevent interfering with biomechanical loops
// =====================================================================

let scarletMediaRecorder = null;
let scarletRecordedChunks = [];
let scarletIsRecording = false;
let scarletRecordingCanvas = null;
let scarletRecordingCtx = null;
let scarletAnimationId = null;

function initScarletRecorder() {
  const recordBtn = document.getElementById('record-btn');
  const canvasOverlay = document.getElementById('overlay');
  const videoElement = document.querySelector('video');

  if (!recordBtn || !canvasOverlay || !videoElement) {
    setTimeout(initScarletRecorder, 500);
    return;
  }

  function renderRecordingFrame() {
    if (!scarletIsRecording) return;

    // Grid Layout Dimensions: 640px camera stream + 400px wider dashboard grid sidebar = 1040x480 video canvas
    const feedWidth = canvasOverlay.width || 640;
    const feedHeight = canvasOverlay.height || 480;
    const metricsWidth = 400; 
    
    if (scarletRecordingCanvas.width !== (feedWidth + metricsWidth) || scarletRecordingCanvas.height !== feedHeight) {
      scarletRecordingCanvas.width = feedWidth + metricsWidth;
      scarletRecordingCanvas.height = feedHeight;
    }

    // Force crisp anti-aliasing rendering options to clean up text pixelation
    scarletRecordingCtx.imageSmoothingEnabled = true;
    scarletRecordingCtx.imageSmoothingQuality = 'high';

    // Base background setup
    scarletRecordingCtx.fillStyle = "#121212"; 
    scarletRecordingCtx.fillRect(0, 0, scarletRecordingCanvas.width, scarletRecordingCanvas.height);

    // 1. DRAW LEFT SIDE: Live Video Feed
    const isYoloActive = (typeof state !== 'undefined' && state?.yoloModeActive);
    const facingMode = (typeof state !== 'undefined' ? state?.currentFacingMode : 'user');

    if (!isYoloActive) {
      scarletRecordingCtx.save();
      if (facingMode === "user" && videoElement.classList.contains('mirror-x')) {
        scarletRecordingCtx.translate(feedWidth, 0);
        scarletRecordingCtx.scale(-1, 1);
      }
      scarletRecordingCtx.drawImage(videoElement, 0, 0, feedWidth, feedHeight);
      scarletRecordingCtx.restore();
    }

    // 2. OVERLAY SKELETON: MediaPipe lines
    scarletRecordingCtx.drawImage(canvasOverlay, 0, 0, feedWidth, feedHeight);

    // 3. DRAW RIGHT SIDE: Cleaned Grid UI Sidebar Panel
    const xStart = feedWidth;
    
    // Solid Sidebar Background Fill
    scarletRecordingCtx.fillStyle = "#1A1A1A"; 
    scarletRecordingCtx.fillRect(xStart, 0, metricsWidth, feedHeight);
    
    // Scarlet Red Border Separation Line
    scarletRecordingCtx.strokeStyle = "#BA0C2F"; 
    scarletRecordingCtx.lineWidth = 4;
    scarletRecordingCtx.beginPath();
    scarletRecordingCtx.moveTo(xStart, 0);
    scarletRecordingCtx.lineTo(xStart, feedHeight);
    scarletRecordingCtx.stroke();

    // Side Header block text
    scarletRecordingCtx.fillStyle = "#BA0C2F";
    scarletRecordingCtx.font = "bold 18px 'Segoe UI', Helvetica, sans-serif";
    scarletRecordingCtx.fillText("SCARLET BIOMECHANICS", xStart + 24, 38);
    
    scarletRecordingCtx.fillStyle = "#888888";
    scarletRecordingCtx.font = "11px 'Segoe UI', Helvetica, sans-serif";
    scarletRecordingCtx.fillText("REAL-TIME ANALYTICS SESSION GRID", xStart + 25, 56);
    
    // Divider line below header
    scarletRecordingCtx.strokeStyle = "#2D2D2D";
    scarletRecordingCtx.lineWidth = 1;
    scarletRecordingCtx.beginPath();
    scarletRecordingCtx.moveTo(xStart + 20, 70);
    scarletRecordingCtx.lineTo(xStart + metricsWidth - 20, 70);
    scarletRecordingCtx.stroke();

    // Helper to draw modern full-width cards (used for Stature metrics)
    const drawFullWidthCard = (title, displayElement, cardY, accentColor = "#008542") => {
      const valueText = displayElement?.textContent || "0.0 cm";
      const cardWidth = metricsWidth - 40;
      const cardHeight = 44;
      const cardX = xStart + 20;

      scarletRecordingCtx.fillStyle = "#242424";
      scarletRecordingCtx.beginPath();
      if (scarletRecordingCtx.roundRect) scarletRecordingCtx.roundRect(cardX, cardY, cardWidth, cardHeight, 6);
      else scarletRecordingCtx.rect(cardX, cardY, cardWidth, cardHeight);
      scarletRecordingCtx.fill();

      scarletRecordingCtx.fillStyle = accentColor;
      scarletRecordingCtx.beginPath();
      if (scarletRecordingCtx.roundRect) scarletRecordingCtx.roundRect(cardX, cardY, 5, cardHeight, [6, 0, 0, 6]);
      else scarletRecordingCtx.fillRect(cardX, cardY, 5, cardHeight);
      scarletRecordingCtx.fill();

      scarletRecordingCtx.fillStyle = "#E0E0E0";
      scarletRecordingCtx.font = "500 13px 'Segoe UI', Helvetica, sans-serif";
      scarletRecordingCtx.fillText(title, cardX + 18, cardY + 26);

      scarletRecordingCtx.fillStyle = accentColor;
      scarletRecordingCtx.font = "bold 15px monospace";
      scarletRecordingCtx.textAlign = "right";
      scarletRecordingCtx.fillText(valueText, cardX + cardWidth - 15, cardY + 27);
      scarletRecordingCtx.textAlign = "left";
    };

    // Helper to draw clean dual columns side-by-side (Left / Right variables combined horizontally)
    const drawDualColumnRow = (leftTitle, leftElement, rightTitle, rightElement, rowY) => {
      const cardWidth = (metricsWidth - 50) / 2; // Split space into two equal halves with gap spacing
      const cardHeight = 44;
      
      // LEFT COMPONENT COLUMN
      const leftX = xStart + 20;
      const leftVal = leftElement?.textContent || "0.0°";
      
      scarletRecordingCtx.fillStyle = "#242424";
      scarletRecordingCtx.beginPath();
      if (scarletRecordingCtx.roundRect) scarletRecordingCtx.roundRect(leftX, rowY, cardWidth, cardHeight, 6);
      else scarletRecordingCtx.rect(leftX, rowY, cardWidth, cardHeight);
      scarletRecordingCtx.fill();

      scarletRecordingCtx.fillStyle = "#FFD700"; // Yellow Gold Indicator Strip
      scarletRecordingCtx.beginPath();
      if (scarletRecordingCtx.roundRect) scarletRecordingCtx.roundRect(leftX, rowY, 5, cardHeight, [6, 0, 0, 6]);
      else scarletRecordingCtx.fillRect(leftX, rowY, 5, cardHeight);
      scarletRecordingCtx.fill();

      scarletRecordingCtx.fillStyle = "#E0E0E0";
      scarletRecordingCtx.font = "500 12px 'Segoe UI', Helvetica, sans-serif";
      scarletRecordingCtx.fillText(leftTitle, leftX + 14, rowY + 26);

      scarletRecordingCtx.fillStyle = "#FFD700";
      scarletRecordingCtx.font = "bold 14px monospace";
      scarletRecordingCtx.textAlign = "right";
      scarletRecordingCtx.fillText(leftVal, leftX + cardWidth - 10, rowY + 27);
      scarletRecordingCtx.textAlign = "left";

      // RIGHT COMPONENT COLUMN
      const rightX = leftX + cardWidth + 10;
      const rightVal = rightElement?.textContent || "0.0°";

      scarletRecordingCtx.fillStyle = "#242424";
      scarletRecordingCtx.beginPath();
      if (scarletRecordingCtx.roundRect) scarletRecordingCtx.roundRect(rightX, rowY, cardWidth, cardHeight, 6);
      else scarletRecordingCtx.rect(rightX, rowY, cardWidth, cardHeight);
      scarletRecordingCtx.fill();

      scarletRecordingCtx.fillStyle = "#FFD700";
      scarletRecordingCtx.beginPath();
      if (scarletRecordingCtx.roundRect) scarletRecordingCtx.roundRect(rightX, rowY, 5, cardHeight, [6, 0, 0, 6]);
      else scarletRecordingCtx.fillRect(rightX, rowY, 5, cardHeight);
      scarletRecordingCtx.fill();

      scarletRecordingCtx.fillStyle = "#E0E0E0";
      scarletRecordingCtx.font = "500 12px 'Segoe UI', Helvetica, sans-serif";
      scarletRecordingCtx.fillText(rightTitle, rightX + 14, rowY + 26);

      scarletRecordingCtx.fillStyle = "#FFD700";
      scarletRecordingCtx.font = "bold 14px monospace";
      scarletRecordingCtx.textAlign = "right";
      scarletRecordingCtx.fillText(rightVal, rightX + cardWidth - 10, rowY + 27);
      scarletRecordingCtx.textAlign = "left";
    };

    // Safely pull element states
    const getEl = (variableName) => typeof variableName !== 'undefined' ? variableName : null;

    // Render metrics vertically optimized using side-by-side grid containers
    drawFullWidthCard("Stature (Metric):", getEl(heightCmDisp), 85, "#008542");
    drawFullWidthCard("Stature (Stature):", getEl(heightFtDisp), 139, "#008542");
    
    // Draw joints split horizontally across columns to maximize viewport layout bounds
    drawDualColumnRow("Left Knee:", getEl(kneeAngleLDisp), "Right Knee:", getEl(kneeAngleRDisp), 205);
    drawDualColumnRow("Left Hip:", getEl(hipAngleLDisp), "Right Hip:", getEl(hipAngleRDisp), 261);
    if (state.currentMode === 'shoulder_flexion') {
      drawDualColumnRow("Left Shoulder:", getEl(shoulderLiveAngleL), "Right Shoulder:", getEl(shoulderLiveAngleR), 317);
    } else {
      drawDualColumnRow("Left Elbow:", getEl(elbowAngleLDisp), "Right Elbow:", getEl(elbowAngleRDisp), 317);
    }

    // Loop frame renders smoothly
    scarletAnimationId = requestAnimationFrame(renderRecordingFrame);
  }

  recordBtn.addEventListener('click', () => {
    if (!scarletIsRecording) {
      if (!scarletRecordingCanvas) {
        scarletRecordingCanvas = document.createElement('canvas');
        scarletRecordingCtx = scarletRecordingCanvas.getContext('2d');
      }

      scarletRecordedChunks = [];
      scarletIsRecording = true;
      
      renderRecordingFrame();

      const stream = scarletRecordingCanvas.captureStream(30); 
      let options = { mimeType: 'video/webm; codecs=vp9' };
      try {
        scarletMediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        scarletMediaRecorder = new MediaRecorder(stream);
      }

      scarletMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) scarletRecordedChunks.push(e.data);
      };

      scarletMediaRecorder.onstop = () => {
        const blob = new Blob(scarletRecordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `Scarlet-HD-GridDashboard-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);
      };

      scarletMediaRecorder.start(100);
      
      recordBtn.textContent = '🛑 Stop Recording Video';
      recordBtn.style.backgroundColor = '#BA0C2F'; 
      
    } else {
      scarletIsRecording = false;
      if (scarletAnimationId) cancelAnimationFrame(scarletAnimationId);
      if (scarletMediaRecorder && scarletMediaRecorder.state !== 'inactive') scarletMediaRecorder.stop();
      
      recordBtn.textContent = 'Start Recording Video';
      recordBtn.style.backgroundColor = '#008542'; 
    }
  });
}

window.addEventListener('load', initScarletRecorder);
