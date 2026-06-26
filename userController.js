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

// Uploaded Media Elements
const uploadedVideo = document.getElementById('uploaded-video');
const uploadedImage = document.getElementById('uploaded-image');
const uploadMediaBtn = document.getElementById('upload-media-btn');
const mediaUploadInput = document.getElementById('media-upload-input');

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
const tabPortfolioBtn = document.getElementById('tab-portfolio-btn');

const panelAruco = document.getElementById('panel-aruco');
const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const panelPortfolio = document.getElementById('panel-portfolio');
const arucoStatusText = document.getElementById('aruco-status-text');

const inputPremeasuredScale = document.getElementById('input-premeasured-scale');
const btnApplyScale = document.getElementById('btn-apply-scale');
const textareaPortfolioJson = document.getElementById('textarea-portfolio-json');
const btnImportPortfolio = document.getElementById('btn-import-portfolio');
const btnExportCombined = document.getElementById('btn-export-combined');
const btnExportVideo = document.getElementById('btn-export-video');

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
  
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 8 * scale);
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
  state.latestPoseResults = results;
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // Draw background video/webcam frame if YOLO background masking is NOT active
  if (!state.yoloModeActive && results && results.image) {
    canvasCtx.save();
    if (!state.isUploadedMedia && state.currentFacingMode === "user") {
      canvasCtx.translate(canvasElement.width, 0);
      canvasCtx.scale(-1, 1);
    }
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();
  }

  const now = Date.now();
  const dt = now - state.lastFrameTime;
  state.lastFrameTime = now;

  const isStaticImage = state.isUploadedMedia && state.uploadedMediaType === 'image';
  if (isStaticImage && state.lastProcessedScaleFactor === state.pixelsPerCm && state.lastCalculatedResults) {
    const calculated = state.lastCalculatedResults;
    const {
      shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
      shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
      head_top, ground_y, all_landmarks, liveMetrics
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

      // Draw active pose badge
      if (liveMetrics.pose) {
        drawPoseBadge(liveMetrics.pose);
      }

      // Draw live stats HUD overlay on top-right of canvas
      drawLiveStatsCard(canvasCtx, calculated);
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

  // Draw ArUco box overlay if detected and active tab is 'aruco'
  if (state.latestArucoMarker && state.activeCalMethod === 'aruco') {
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
    const lm = results.poseLandmarks;
    const keyIndices = [11, 12, 23, 24, 25, 26, 27, 28]; // shoulders, hips, knees, ankles
    let totalVisibility = 0;
    let highVisCount = 0;
    for (const idx of keyIndices) {
      if (lm[idx]) {
        const vis = lm[idx].visibility || 0;
        totalVisibility += vis;
        if (vis > 0.55) {
          highVisCount++;
        }
      }
    }
    const avgVis = totalVisibility / keyIndices.length;
    // Real person requires average visibility >= 0.55 and at least 5 key joints with high visibility (0.55+)
    if (highVisCount >= 5 && avgVis >= 0.55) {
      hasValidPerson = true;
    }
  }

  if (!hasValidPerson) {
    // Call offline placeholder function to keep the dashboard from showing ceiling measurements!
    updateDashboardOfflinePlaceholders();

    // Reset cached pixels height indicators to prevent calibrating on empty or false-positive frames
    state.lastSkeletalHeightPx = 0;
    state.lastVerticalHeightPx = 0;

    // Reset status elements
    if (state.autoActive) {
      statusElement.textContent = "🔍 Waiting for subject to enter and align in view...";
      state.holdTimerMs = 0; // Reset sequence hold timer
    } else {
      statusElement.textContent = "🔍 Scanning for a person... Align yourself in view of the camera.";
    }

    // Set all sidebar landmarks to Offline
    if (typeof LANDMARK_NAMES !== 'undefined') {
      LANDMARK_NAMES.forEach((name, idx) => {
        const statusSpan = document.getElementById(`lm-status-${idx}`);
        if (statusSpan) {
          statusSpan.classList.remove('text-emerald', 'text-amber');
          statusSpan.classList.add('text-slate');
          statusSpan.textContent = "Offline";
        }
      });
    }

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
    drawRoundedRect(canvasCtx, bannerX, bannerY, bannerW, bannerH, 6);
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

    canvasCtx.restore();
    return;
  }

  if (typeof calculatePoseMetrics === 'function') {
    const calculated = calculatePoseMetrics(results);

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
      } else {
        if (state.latestPoseResults) {
          onPoseResults(state.latestPoseResults);
        } else {
          // If no results yet, clear canvas and draw manual calibration box if active
          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
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
    exportCombinedBtn.style.display = 'none';
  }

  if (btnExportVideo) {
    btnExportVideo.classList.remove('hidden');
    btnExportVideo.classList.add('visible-block');
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
    videoElement.classList.toggle('mirror-x', state.currentFacingMode === "user");
    
    // Wait for video metadata to load and then start playing
    videoElement.onloadedmetadata = () => {
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
          if (state.importedPortfolioMetrics) {
            state.latestArucoMarker = null;
            if (state.activeCalMethod === 'aruco' && arucoStatusText && state.pixelsPerCm) {
              arucoStatusText.innerHTML = `✅ Calibrated via Portfolio Stature (<strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>)`;
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
              state.pixelsPerCm = smoothedScale;
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
      statusElement.textContent = "Active tracking. Present your printed ArUco marker to calibrate scale!";
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
      exportCombinedBtn.style.display = 'none';
    } else {
      exportCombinedBtn.style.display = 'block';
    }
  }

  if (btnExportVideo) {
    if (isVideo) {
      btnExportVideo.classList.remove('hidden');
      btnExportVideo.classList.add('visible-block');
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
        if (state.isRecording) {
          stopVideoRecording();
        }
      };
    }
  } else {
    // Image
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
    if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || uploadedVideo.paused || uploadedVideo.ended) {
      state.isVideoInferenceLoopRunning = false;
      return;
    }
    state.isVideoInferenceLoopRunning = true;

    const startTime = Date.now();
    try {
      if (!state.isSnapshotFrozen) {
        if (state.importedPortfolioMetrics) {
          state.latestArucoMarker = null;
          if (state.activeCalMethod === 'aruco' && arucoStatusText && state.pixelsPerCm) {
            arucoStatusText.innerHTML = `✅ Calibrated via Portfolio Stature (<strong class="text-cyan">${state.pixelsPerCm.toFixed(1)} px/cm</strong>)`;
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

            const smoothedScale = smooth('scale_factor', edgeLengthPx / MARKER_PHYSICAL_SIZE_CM);
            state.pixelsPerCm = smoothedScale;
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
        setModalMetric('modal-val-wingspan', m.wingspan ? formatLength(m.wingspan) : "--.-");

        setModalMetric('modal-val-thigh-l', m.thigh_l !== undefined ? formatLength(m.thigh_l) : "--.-");
        setModalMetric('modal-val-thigh-r', m.thigh_r !== undefined ? formatLength(m.thigh_r) : "--.-");
        setModalMetric('modal-val-shin-l', m.shin_l !== undefined ? formatLength(m.shin_l) : "--.-");
        setModalMetric('modal-val-shin-r', m.shin_r !== undefined ? formatLength(m.shin_r) : "--.-");
        setModalMetric('modal-val-foot-l', m.foot_l !== undefined ? formatLength(m.foot_l) : "--.-");
        setModalMetric('modal-val-foot-r', m.foot_r !== undefined ? formatLength(m.foot_r) : "--.-");

        setModalMetric('modal-val-torso-l', m.torso_l !== undefined ? formatLength(m.torso_l) : "--.-");
        setModalMetric('modal-val-torso-r', m.torso_r !== undefined ? formatLength(m.torso_r) : "--.-");
        setModalMetric('modal-val-upperarm-l', m.upperarm_l !== undefined ? formatLength(m.upperarm_l) : "--.-");
        setModalMetric('modal-val-upperarm-r', m.upperarm_r !== undefined ? formatLength(m.upperarm_r) : "--.-");
        setModalMetric('modal-val-forearm-l', m.forearm_l !== undefined ? formatLength(m.forearm_l) : "--.-");
        setModalMetric('modal-val-forearm-r', m.forearm_r !== undefined ? formatLength(m.forearm_r) : "--.-");

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

// Multi-unit system controls (Inches/Cm togglers)
const unitInchBtn = document.getElementById('unit-inch-btn');
const unitCmBtn = document.getElementById('unit-cm-btn');

unitInchBtn.addEventListener('click', () => {
  state.useInches = true;
  unitInchBtn.classList.add('active');
  unitCmBtn.classList.remove('active');
  updateHeightInputUnit();
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
  
  [tabArucoBtn, tabHeightBtn, tabPortfolioBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('btn-tab-active', btn === activeBtn);
      btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
    }
  });

  [panelAruco, panelCard, panelHeight, panelPortfolio].forEach(panel => {
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

  // Clear lock on switch if transitioning away from manual/height
  if (method !== 'aruco' && state.calLocked) {
    if (method === 'card') {
      lockCalButton.textContent = "Lock 20cm Calibration";
      lockCalButton.classList.add('cal-btn-unlocked');
      lockCalButton.classList.remove('cal-btn-locked');
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
    btnApplyScale.style.backgroundColor = '#10b981';
    btnApplyScale.style.boxShadow = '0 0 12px #10b981';
    btnApplyScale.textContent = "Scale Applied! ✅";
    
    setTimeout(() => {
      btnApplyScale.style.backgroundColor = '';
      btnApplyScale.style.boxShadow = '';
      btnApplyScale.textContent = "Apply Scale";
    }, 2000);

    // Update global scale indicators
    if (arucoStatusText) {
      arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-cyan">${state.pixelsPerCm.toFixed(2)} px/cm</strong>`;
    }
    
    statusElement.textContent = `Scale calibration locked to pasted premeasured factor: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
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

  // Determine the best supported mimeType
  let mimeType = '';
  const types = [
    'video/mp4;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) {
      mimeType = t;
      break;
    }
  }

  const options = mimeType ? { mimeType } : {};
  try {
    state.mediaRecorder = new MediaRecorder(stream, options);
  } catch (err) {
    console.error("MediaRecorder initialization failed:", err);
    alert("Could not initialize MediaRecorder. Please check browser compatibility.");
    return;
  }

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.recordedChunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = () => {
    if (state.recordedChunks.length === 0) {
      console.warn("No recorded chunks gathered!");
      return;
    }
    const blob = new Blob(state.recordedChunks, {
      type: mimeType || 'video/webm'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const subjectInput = document.getElementById('subject-name-input');
    const subjectName = (subjectInput && subjectInput.value.trim()) || "Subject";
    const cleanSubjectName = subjectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const ext = (mimeType && mimeType.includes('mp4')) ? 'mp4' : 'webm';
    a.download = `scarlet_biomechanics_${cleanSubjectName}_recording.${ext}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);

    state.isRecording = false;
    updateRecordButtonUI();
    statusElement.textContent = "Video recording exported successfully!";
  };

  state.isRecording = true;
  state.mediaRecorder.start(250); // Slice data every 250ms
  updateRecordButtonUI();
  statusElement.textContent = "🔴 Video recording in progress... Click the red button to stop and save.";
}

export function stopVideoRecording() {
  if (!state.isRecording || !state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;
  state.mediaRecorder.stop();
}

export function toggleVideoRecording() {
  if (state.isRecording) {
    stopVideoRecording();
  } else {
    startVideoRecording();
  }
}

export function updateRecordButtonUI() {
  if (!btnExportVideo) return;
  if (state.isRecording) {
    btnExportVideo.innerHTML = `
      <span class="recording-dot"></span>
      Stop & Export Video
    `;
    btnExportVideo.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
    btnExportVideo.classList.add('recording-pulse');
  } else {
    btnExportVideo.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
      </svg>
      Record & Export Video
    `;
    btnExportVideo.style.background = 'linear-gradient(135deg, #ec4899, #818cf8)';
    btnExportVideo.classList.remove('recording-pulse');
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

  // 1. Restore Subject Name
  const subjectInput = document.getElementById('subject-name-input');
  if (report.subjectName) {
    if (subjectInput) subjectInput.value = report.subjectName;
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
      arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong class="text-cyan">${state.pixelsPerCm.toFixed(2)} px/cm</strong>`;
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

  state.metricsT = {
    wingspan: importedMetrics.wingspan,
    kneeAngleL: (detectedPose === "T-Pose" && activeKneeL !== null && activeKneeL !== undefined) ? activeKneeL : (profs.tPose?.kneeL || report.metrics?.anglesT?.kneeAngleL || 180),
    kneeAngleR: (detectedPose === "T-Pose" && activeKneeR !== null && activeKneeR !== undefined) ? activeKneeR : (profs.tPose?.kneeR || report.metrics?.anglesT?.kneeAngleR || 180),
    hipAngleL: (detectedPose === "T-Pose" && activeHipL !== null && activeHipL !== undefined) ? activeHipL : (profs.tPose?.hipL || report.metrics?.anglesT?.hipAngleL || 180),
    hipAngleR: (detectedPose === "T-Pose" && activeHipR !== null && activeHipR !== undefined) ? activeHipR : (profs.tPose?.hipR || report.metrics?.anglesT?.hipAngleR || 180),
    elbowAngleL: (detectedPose === "T-Pose" && activeElbowL !== null && activeElbowL !== undefined) ? activeElbowL : (profs.tPose?.elbowL || report.metrics?.anglesT?.elbowAngleL || 180),
    elbowAngleR: (detectedPose === "T-Pose" && activeElbowR !== null && activeElbowR !== undefined) ? activeElbowR : (profs.tPose?.elbowR || report.metrics?.anglesT?.elbowAngleR || 180),
  };

  state.metricsOverhead = {
    fingerToToeL: importedMetrics.fingerToToeL,
    fingerToToeR: importedMetrics.fingerToToeR,
    kneeAngleL: (detectedPose === "Overhead Reach" && activeKneeL !== null && activeKneeL !== undefined) ? activeKneeL : (profs.overhead?.kneeL || report.metrics?.anglesOverhead?.kneeAngleL || 180),
    kneeAngleR: (detectedPose === "Overhead Reach" && activeKneeR !== null && activeKneeR !== undefined) ? activeKneeR : (profs.overhead?.kneeR || report.metrics?.anglesOverhead?.kneeAngleR || 180),
    hipAngleL: (detectedPose === "Overhead Reach" && activeHipL !== null && activeHipL !== undefined) ? activeHipL : (profs.overhead?.hipL || report.metrics?.anglesOverhead?.hipAngleL || 180),
    hipAngleR: (detectedPose === "Overhead Reach" && activeHipR !== null && activeHipR !== undefined) ? activeHipR : (profs.overhead?.hipR || report.metrics?.anglesOverhead?.hipAngleR || 180),
    elbowAngleL: (detectedPose === "Overhead Reach" && activeElbowL !== null && activeElbowL !== undefined) ? activeElbowL : (profs.overhead?.elbowL || report.metrics?.anglesOverhead?.elbowAngleL || 180),
    elbowAngleR: (detectedPose === "Overhead Reach" && activeElbowR !== null && activeElbowR !== undefined) ? activeElbowR : (profs.overhead?.elbowR || report.metrics?.anglesOverhead?.elbowAngleR || 180),
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

  // High-end feedback animation on Import button
  if (btnImportPortfolio) {
    btnImportPortfolio.style.backgroundColor = '#10b981';
    btnImportPortfolio.style.boxShadow = '0 0 16px #10b981';
    btnImportPortfolio.textContent = "Session Imported Successfully! ✅";
    setTimeout(() => {
      btnImportPortfolio.style.backgroundColor = '';
      btnImportPortfolio.style.boxShadow = '';
      btnImportPortfolio.textContent = "Import Prior Portfolio";
    }, 2000);
  }
}

const heightCalBtn = document.getElementById('height-cal-btn');
const inputUserHeight = document.getElementById('input-user-height');

heightCalBtn.addEventListener('click', () => {
  if (state.isCountingDown || state.isCaptureCountingDown) return; // Prevent clicks during active countdowns

  // Reset imported portfolio metrics when manually recalibrating
  state.importedPortfolioMetrics = null;

  const activeHeightPx = state.lastSkeletalHeightPx > 10 ? state.lastSkeletalHeightPx : state.lastVerticalHeightPx;
  if (activeHeightPx > 10) {
    if (state.isUploadedMedia) {
      // Recalculate pixel height instantly for uploaded files
      const captureHeightPx = state.lastSkeletalHeightPx > 10 ? state.lastSkeletalHeightPx : state.lastVerticalHeightPx;
      const inputVal = parseFloat(inputUserHeight.value) || (state.useInches ? 68.9 : 175.0);
      let actualHeightCm = inputVal;
      if (state.useInches) {
        actualHeightCm = inputVal * 2.54; // Convert to cm for calibration scale factor
      }

      state.pixelsPerCm = captureHeightPx / actualHeightCm;
      state.calLocked = true;
      heightCalBtn.textContent = "✅ Calibrated!";
      heightCalBtn.classList.add('btn-success-green');
      heightCalBtn.classList.remove('btn-warning');
      statusElement.textContent = `Skeletal-calibrated scale locked (Instant Upload Calibration): ${state.pixelsPerCm.toFixed(2)} px/cm.`;
      
      // Trigger camera snapshot visual flash!
      triggerFlashEffect();
      return;
    }

    // Start 3-second countdown
    state.isCountingDown = true;
    state.countdownValue = 3;
    heightCalBtn.textContent = "Get in Position (3s)...";
    heightCalBtn.classList.add('btn-warning');
    heightCalBtn.classList.remove('btn-success-green');
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
        heightCalBtn.classList.add('btn-success-green');
        heightCalBtn.classList.remove('btn-warning');
        statusElement.textContent = `Skeletal-calibrated scale locked: ${state.pixelsPerCm.toFixed(2)} px/cm.`;
        
        // Trigger camera snapshot visual flash!
        triggerFlashEffect();
      }
    }, 1000);
  } else {
    if (state.isUploadedMedia) {
      alert("Please ensure a person is fully visible in your uploaded image or video first!");
    } else {
      alert("Please click 'Start Biomechanical Tracking' and stand in view of the camera first!");
    }
  }
});

// YOLO-style background isolation click handler
yoloToggleBtn.addEventListener('click', () => {
  state.yoloModeActive = !state.yoloModeActive;
  if (state.yoloModeActive) {
    yoloToggleBtn.textContent = "Disable YOLO Background Isolation";
    yoloToggleBtn.classList.add('active');
    
    // Hide standard video underneath so canvas can show the background cutout
    videoElement.classList.add('video-dimmed');
    videoElement.classList.remove('video-visible');
  } else {
    yoloToggleBtn.textContent = "Enable YOLO Background Isolation";
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

  const suffix = state.useInches ? "inches" : "cm";
  const place = `--.- ${suffix}`;

  thighLDisp.textContent = place;
  thighRDisp.textContent = place;
  shinLDisp.textContent = place;
  shinRDisp.textContent = place;
  footLDisp.textContent = place;
  footRDisp.textContent = place;
  torsoLDisp.textContent = place;
  torsoRDisp.textContent = place;
  upperarmLDisp.textContent = place;
  upperarmRDisp.textContent = place;
  forearmLDisp.textContent = place;
  forearmRDisp.textContent = place;
  
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
  
  kneeAngleLDisp.textContent = `--°`;
  kneeAngleRDisp.textContent = `--°`;
  hipAngleLDisp.textContent = `--°`;
  hipAngleRDisp.textContent = `--°`;
  elbowAngleLDisp.textContent = `--°`;
  elbowAngleRDisp.textContent = `--°`;
}

// Initial placeholder update
setTimeout(() => {
  updateDashboardOfflinePlaceholders();
}, 200);
