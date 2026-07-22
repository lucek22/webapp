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
import { setupAnkleDorsiEvents, processAnkleDorsi, calculateShinTilt, updateDorsiLiveUI, registerAnkleDorsiCallbacks } from './ankleDorsi.js';

import {
  drawJoint,
  drawBone,
  drawSkeletalFramework,
  drawFullSkeletalMesh,
  drawAngleBadge,
  drawValgusBadge,
  drawVarusBadge,
  drawHandMesh,
  drawRoundedRect
} from './canvasRenderer.js';

import {
  initializeProfilesSelector,
  getActiveProfileName,
  loadProfileIntoState,
  openProfileDetailsModal,
  closeProfileDetailsModal,
  autoSyncToActiveProfile,
  autoSyncToActiveProfileDebounced,
  drawModalVideoPoseOverlay,
  registerProfileCallbacks,
  populateDropdown
} from './profileManager.js';

// Import specialized submodules
import {
  setupShoulderListeners,
  resetShoulderPeaksUI,
  getShoulderWristAngle,
  updateShoulderSideUI,
  updateShoulderSidebarUI,
  getDefaultShoulderPeaks,
  processShoulderFlexionFromPreprocessedFrames
} from './shoulderController.js';

import {
  setupShoulderRotationListeners,
  updateShoulderRotationSideUI,
  updateShoulderRotationSidebarUI,
  getDefaultShoulderRotation,
  processShoulderRotationFromPreprocessedFrames,
  resetShoulderRotationPeaksUI,
  ShoulderRotationMeasurer,
  registerShoulderRotationCallbacks
} from './shoulderRotationController.js';

import {
  setupHipRotationListeners,
  updateHipRotationSideUI,
  updateHipRotationSidebarUI,
  getDefaultHipRotation,
  processHipRotationFromPreprocessedFrames,
  resetHipRotationPeaksUI,
  HipRotationMeasurer,
  registerHipRotationCallbacks
} from './hipRotationController.js';

import {
  setupThoracicExtensionListeners,
  updateThoracicExtensionSidebarUI,
  resetThoracicExtensionUI,
  calculateThoracicExtensionAngle,
  getDefaultThoracicExtension,
  setThoracicExtensionStatus,
  registerThoracicCallbacks
} from './thoracicController.js';

import {
  setupSquatListeners,
  resetSquatPeaks,
  calculateValgusFromJoints,
  calculateVarusFromJoints,
  getDefaultSquatPeaks,
  scanVideoForSquatPeaks,
  updateSquatDashboardOffline,
  updateSquatDashboardUI,
  updateSquatSideUI,
  registerSquatCallbacks
} from './squatController.js';

import {
  setupVideoControls,
  toggleVideoRecording,
  hideAnalysisProgressOverlay,
  hideExportProgressOverlay,
  saveImportedVideoToProfile,
  saveVideoToActiveProfile,
  showAnalysisProgressOverlay,
  showExportProgressOverlay,
  startVideoRecording,
  stopVideoRecording
} from './videoController.js';

// Re-export public APIs from specialized modules for backward compatibility
export {
  initializeProfilesSelector,
  getActiveProfileName,
  loadProfileIntoState,
  openProfileDetailsModal,
  closeProfileDetailsModal,
  autoSyncToActiveProfile,
  autoSyncToActiveProfileDebounced,
  drawModalVideoPoseOverlay
};

export {
  drawJoint,
  drawBone,
  drawSkeletalFramework,
  drawFullSkeletalMesh,
  drawAngleBadge,
  drawValgusBadge,
  drawVarusBadge,
  drawHandMesh,
  drawRoundedRect
};

export {
  resetShoulderPeaksUI,
  getShoulderWristAngle,
  updateShoulderSideUI,
  updateShoulderSidebarUI,
  getDefaultShoulderPeaks,
  processShoulderFlexionFromPreprocessedFrames,
  resetSquatPeaks,
  calculateValgusFromJoints,
  calculateVarusFromJoints,
  getDefaultSquatPeaks,
  scanVideoForSquatPeaks,
  updateSquatDashboardOffline,
  updateSquatDashboardUI,
  updateSquatSideUI,
  toggleVideoRecording,
  hideAnalysisProgressOverlay,
  hideExportProgressOverlay,
  saveImportedVideoToProfile,
  saveVideoToActiveProfile,
  showAnalysisProgressOverlay,
  showExportProgressOverlay,
  startVideoRecording,
  stopVideoRecording
};

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

// Profile DOMS for switching between modes

const profileSearchBar = document.getElementById('profile-search-wrapper');
const profileDropdown = document.getElementById('profile-controls-row');
const newProfileContainter = document.getElementById('new-profile-input-container');


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

// UI Exercise Mode Dropdown
const selectTestMode = document.getElementById('select-test-mode');
const postureSidebarContent = document.getElementById('posture-sidebar-content');
const squatSidebarContent = document.getElementById('squat-sidebar-content');
const shoulderSidebarContent = document.getElementById('shoulder-sidebar-content');
const ankledorsiSidebarContent = document.getElementById('ankledorsi-sidebar-content');

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

// UI Shoulder Rotation Elements
const shoulderRotationSidebarContent = document.getElementById('shoulder-rotation-sidebar-content');

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

// UI Hip Rotation Elements
const hipRotationSidebarContent = document.getElementById('hip-rotation-sidebar-content');

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


// UI Calibration Toggles & Panels
const tabHeightBtn = document.getElementById('tab-height-btn');
const tabPortfolioBtn = document.getElementById('tab-portfolio-btn');
const tabImportBtn = document.getElementById('tab-import-btn');

const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const panelPortfolio = document.getElementById('panel-portfolio');
const panelImport = document.getElementById('panel-import');

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

// =====================================================================
// CANVAS DRAWING COMPONENT UTILITIES (NOW IN canvasRenderer.js)
// =====================================================================

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
    { label: "Knee L / R", val: `${Math.round(calculated.kneeAngleL || 0)}° / ${Math.round(calculated.kneeAngleR || 0)}°` },
    { label: "Hip L / R", val: `${Math.round(calculated.hipAngleL || 0)}° / ${Math.round(calculated.hipAngleR || 0)}°` },
    { label: "Elbow L / R", val: `${Math.round(calculated.elbowAngleL || 0)}° / ${Math.round(calculated.elbowAngleR || 0)}°` }
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
        if (state.currentMode === 'ankledorsi') {
          processAnkleDorsi(calculated);
        } else {
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
          const activeKneeMob = Math.max(kneeMobL, kneeMobR);
          const activeHipMob = Math.max(hipMobL, hipMobR);
          const activeAnkleMob = Math.max(ankleMobL, ankleMobR);

          state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, activeKneeMob);
          state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, activeHipMob);
          state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, activeAnkleMob);
          if (calculated && calculated.shoulder_l && calculated.hip_l) {
            const dx = Math.abs(calculated.shoulder_l.x - calculated.hip_l.x);
            const dy = Math.abs(calculated.hip_l.y - calculated.shoulder_l.y);
            if (dy > 10) {
              const trunkLeanDeg = Math.atan2(dx, dy) * (180 / Math.PI);
              if (activeKneeMob >= 15) {
                if (trunkLeanDeg > (state.squatPeaks.maxForwardLeanL || 0)) {
                  state.squatPeaks.maxForwardLeanL = trunkLeanDeg;
                  state.squatPeaks.forwardLeanKneeL = activeKneeMob;
                  const timeSec = uploadedVideo ? uploadedVideo.currentTime : null;
                  state.squatPeaks.forwardLeanTimestampL = timeSec;
                }
              }
            }
          }
        } else if (state.squatTestingSide === 'right') {
          const activeKneeMob = Math.max(kneeMobR, kneeMobL);
          const activeHipMob = Math.max(hipMobR, hipMobL);
          const activeAnkleMob = Math.max(ankleMobR, ankleMobL);

          state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, activeKneeMob);
          state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, activeHipMob);
          state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, activeAnkleMob);
          if (calculated && calculated.shoulder_r && calculated.hip_r) {
            const dx = Math.abs(calculated.shoulder_r.x - calculated.hip_r.x);
            const dy = Math.abs(calculated.hip_r.y - calculated.shoulder_r.y);
            if (dy > 10) {
              const trunkLeanDeg = Math.atan2(dx, dy) * (180 / Math.PI);
              if (activeKneeMob >= 15) {
                if (trunkLeanDeg > (state.squatPeaks.maxForwardLeanR || 0)) {
                  state.squatPeaks.maxForwardLeanR = trunkLeanDeg;
                  state.squatPeaks.forwardLeanKneeR = activeKneeMob;
                  const timeSec = uploadedVideo ? uploadedVideo.currentTime : null;
                  state.squatPeaks.forwardLeanTimestampR = timeSec;
                }
              }
            }
          }
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

        // Track frontal Knee Valgus/Cave-In & Varus peaks during active squat movement (knee flexion >= 30 degrees)
        if (state.squatTestingSide === 'frontal') {
          const valgus = calculateValgusFromJoints(calculated);
          const varus = calculateVarusFromJoints(calculated);
          if (kneeMobL >= 30 || kneeMobR >= 30) {
            if (kneeMobL >= 30) {
              state.squatPeaks.maxKneeCaveL = Math.max(state.squatPeaks.maxKneeCaveL || 0, valgus.pctL);
              state.squatPeaks.maxKneeBowL = Math.max(state.squatPeaks.maxKneeBowL || 0, varus.pctL);
            }
            if (kneeMobR >= 30) {
              state.squatPeaks.maxKneeCaveR = Math.max(state.squatPeaks.maxKneeCaveR || 0, valgus.pctR);
              state.squatPeaks.maxKneeBowR = Math.max(state.squatPeaks.maxKneeBowR || 0, varus.pctR);
            }
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
      const body_xs = [shoulder_l, shoulder_r, hip_l, hip_r, knee_l, knee_r, ankle_l, ankle_r]
        .filter(p => p !== null && p !== undefined && p.x !== undefined)
        .map(p => p.x);
      if (body_xs.length === 0) body_xs.push(320);
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
        const activeKneeMob = Math.max(kneeMobL, kneeMobR);
        const activeHipMob = Math.max(hipMobL, hipMobR);
        const activeAnkleMob = Math.max(ankleMobL, ankleMobR);

        state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, activeKneeMob);
        state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, activeHipMob);
        state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, activeAnkleMob);
      } else if (state.squatTestingSide === 'right') {
        const activeKneeMob = Math.max(kneeMobR, kneeMobL);
        const activeHipMob = Math.max(hipMobR, hipMobL);
        const activeAnkleMob = Math.max(ankleMobR, ankleMobL);

        state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, activeKneeMob);
        state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, activeHipMob);
        state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, activeAnkleMob);
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
        statusElement.textContent = "All poses captured and saved to profile successfully!";
        
        // Compile and download consolidated session report JSON is disabled to prevent download friction
        // compileAndDownloadCombinedSession();
        
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
        statusElement.textContent = "Waiting for subject to enter and align in view...";
        state.holdTimerMs = 0; // Reset sequence hold timer
      } else {
        statusElement.textContent = "Scanning for a person... Align yourself in view of the camera.";
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
      canvasCtx.fillText("  SUBJECT NOT DETECTED IN FRAME", canvasElement.width / 2, bannerY + bannerH / 2);
      canvasCtx.restore();
    }

    canvasCtx.restore();
    return;
  }

  if (typeof calculatePoseMetrics === 'function') {
    if (!calculated) {
      calculated = calculatePoseMetrics(results);
    }

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
      if (state.currentMode === 'ankledorsi') {
        const side = state.ankleDorsi.activeSide;
        const activeAnkle = side === 'left' ? ankle_l : ankle_r;
        const activeKnee = side === 'left' ? knee_l : knee_r;
        
        // Draw Tibial Inclination angle badge at the midpoint of the shin
        if (activeAnkle && activeKnee && state.ankleDorsi.isRecording) {
          const shinMidpoint = {
            x: (activeAnkle.x + activeKnee.x) / 2,
            y: (activeAnkle.y + activeKnee.y) / 2
          };
          const liveShinTilt = (side === 'left') ? calculateShinTilt(ankle_l, knee_l) : calculateShinTilt(ankle_r, knee_r);
          drawAngleBadge(canvasCtx, shinMidpoint, liveShinTilt, '#06b6d4'); // Cyan for Tibial Inclination
        }
      } else if (state.currentMode === 'squat') {
        drawAngleBadge(canvasCtx, knee_l, kneeAngleL, '#10b981');
        drawAngleBadge(canvasCtx, hip_l, hipAngleL, '#d4a017');
        drawAngleBadge(canvasCtx, ankle_l, ankleAngleL, '#06b6d4');

        drawAngleBadge(canvasCtx, knee_r, kneeAngleR, '#10b981');
        drawAngleBadge(canvasCtx, hip_r, hipAngleR, '#d4a017');
        drawAngleBadge(canvasCtx, ankle_r, ankleAngleR, '#06b6d4');

        // Frontal Knee Valgus & Varus Badges
        const valgus = calculateValgusFromJoints(calculated);
        const varus = calculateVarusFromJoints(calculated);
        const kneeMobL = 180 - (kneeAngleL || 180);
        const kneeMobR = 180 - (kneeAngleR || 180);
        if (kneeMobL >= 15) {
          if (valgus.pctL > 4.0) {
            drawValgusBadge(canvasCtx, knee_l, valgus.pctL);
          } else if (varus.pctL > 4.0) {
            drawVarusBadge(canvasCtx, knee_l, varus.pctL);
          }
        }
        if (kneeMobR >= 15) {
          if (valgus.pctR > 4.0) {
            drawValgusBadge(canvasCtx, knee_r, valgus.pctR);
          } else if (varus.pctR > 4.0) {
            drawVarusBadge(canvasCtx, knee_r, varus.pctR);
          }
        }
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
      const kneeMobL = 180 - (kneeAngleL || 180);
      const kneeMobR = 180 - (kneeAngleR || 180);
      const hipMobL = 180 - (hipAngleL || 180);
      const hipMobR = 180 - (hipAngleR || 180);
      const ankleMobL = Math.max(0, 115 - (ankleAngleL || 115));
      const ankleMobR = Math.max(0, 115 - (ankleAngleR || 115));

      // Always update peaks state when a valid frame is processed in squat mode
      const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;
      const shouldUpdatePeaks = !isWebcamLive || !!state.isRecordingAssessment || !!state.isExportingFrameByFrame;

      if (state.currentMode === 'squat' && shouldUpdatePeaks) {
        if (state.squatTestingSide === 'left') {
          const activeKneeMob = Math.max(kneeMobL, kneeMobR);
          const activeHipMob = Math.max(hipMobL, hipMobR);
          const activeAnkleMob = Math.max(ankleMobL, ankleMobR);

          state.squatPeaks.kneeL = Math.max(state.squatPeaks.kneeL, activeKneeMob);
          state.squatPeaks.hipL = Math.max(state.squatPeaks.hipL, activeHipMob);
          state.squatPeaks.ankleL = Math.max(state.squatPeaks.ankleL, activeAnkleMob);
        } else if (state.squatTestingSide === 'right') {
          const activeKneeMob = Math.max(kneeMobR, kneeMobL);
          const activeHipMob = Math.max(hipMobR, hipMobL);
          const activeAnkleMob = Math.max(ankleMobR, ankleMobL);

          state.squatPeaks.kneeR = Math.max(state.squatPeaks.kneeR, activeKneeMob);
          state.squatPeaks.hipR = Math.max(state.squatPeaks.hipR, activeHipMob);
          state.squatPeaks.ankleR = Math.max(state.squatPeaks.ankleR, activeAnkleMob);
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
      } else if (state.currentMode === 'ankledorsi') {
        processAnkleDorsi(calculated);
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
      } else if (state.currentMode === 'shoulder_rotation') {
        const side = state.shoulderRotationTestingSide || 'left';
        
        // Ensure live measurer is initialized
        if (!state.liveShoulderRotationMeasurer) {
          state.liveShoulderRotationMeasurer = new ShoulderRotationMeasurer();
        }
        
        // Get current video playhead or index-based timestamp
        const videoElement = document.getElementById('uploaded-video');
        const ts = (videoElement && !videoElement.paused) ? videoElement.currentTime : (Date.now() / 1000);
        
        const isRecording = !!state.isShoulderRotationRecording;
        const angle = state.liveShoulderRotationMeasurer.processFrame(results.poseLandmarks, side, ts, isRecording);
        
        if (angle !== null) {
          if (side === 'left') {
            if (shoulderRotationLiveAngleL) shoulderRotationLiveAngleL.textContent = `${Math.round(angle)}°`;
            if (shoulderRotationLiveAngleR) shoulderRotationLiveAngleR.textContent = '--°';
          } else {
            if (shoulderRotationLiveAngleR) shoulderRotationLiveAngleR.textContent = `${Math.round(angle)}°`;
            if (shoulderRotationLiveAngleL) shoulderRotationLiveAngleL.textContent = '--°';
          }

          if (shoulderRotationStatusVal) {
            if (isRecording) {
              shoulderRotationStatusVal.textContent = 'Recording Peak Angles...';
              shoulderRotationStatusVal.className = 'text-amber';
            } else {
              shoulderRotationStatusVal.textContent = 'Active Tracking (Ready)';
              shoulderRotationStatusVal.className = 'text-emerald';
            }
          }

          const shoulderIdx = side === 'left' ? 11 : 12;
          const elbowIdx = side === 'left' ? 13 : 14;
          const wristIdx = side === 'left' ? 15 : 16;
          
          const rawShoulder = results.poseLandmarks[shoulderIdx];
          const rawElbow = results.poseLandmarks[elbowIdx];
          const rawWrist = results.poseLandmarks[wristIdx];
          
          if (rawShoulder && rawElbow && rawWrist) {
            const height = state.canvasHeight || 480;
            const shoulder = { x: getCanvasX(rawShoulder.x), y: rawShoulder.y * height };
            const elbow = { x: getCanvasX(rawElbow.x), y: rawElbow.y * height };
            const wrist = { x: getCanvasX(rawWrist.x), y: rawWrist.y * height };

            // 1. Draw horizontal reference line (0° forearm position) starting from the elbow
            canvasCtx.save();
            canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            canvasCtx.setLineDash([5, 5]);
            canvasCtx.lineWidth = 1.5;
            canvasCtx.beginPath();
            canvasCtx.moveTo(elbow.x, elbow.y);
            const sign = state.liveShoulderRotationMeasurer.facingDirection === 'right' ? 1 : -1;
            const forearmLen = Math.sqrt((wrist.x - elbow.x) ** 2 + (wrist.y - elbow.y) ** 2) || 80;
            canvasCtx.lineTo(elbow.x + sign * forearmLen, elbow.y); // Horizontal baseline
            canvasCtx.stroke();
            canvasCtx.restore();

            // 2. Draw angle arc at the elbow
            const r = Math.min(30, forearmLen / 2);
            canvasCtx.save();
            canvasCtx.strokeStyle = '#00e5ff'; // Glowing cyan
            canvasCtx.lineWidth = 2.5;
            canvasCtx.beginPath();
            const forearmAngleRad = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
            const baselineAngleRad = Math.atan2(0, sign);
            canvasCtx.arc(elbow.x, elbow.y, r, baselineAngleRad, forearmAngleRad, forearmAngleRad < baselineAngleRad);
            canvasCtx.stroke();
            canvasCtx.restore();

            // 3. Draw premium glowing line for the forearm (elbow to wrist)
            canvasCtx.save();
            canvasCtx.strokeStyle = '#00e5ff';
            canvasCtx.lineWidth = 4;
            canvasCtx.shadowColor = '#00e5ff';
            canvasCtx.shadowBlur = 10;
            canvasCtx.beginPath();
            canvasCtx.moveTo(elbow.x, elbow.y);
            canvasCtx.lineTo(wrist.x, wrist.y);
            canvasCtx.stroke();
            canvasCtx.restore();

            // 4. Draw vertical upper arm line (shoulder to elbow)
            canvasCtx.save();
            canvasCtx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
            canvasCtx.lineWidth = 3;
            canvasCtx.beginPath();
            canvasCtx.moveTo(shoulder.x, shoulder.y);
            canvasCtx.lineTo(elbow.x, elbow.y);
            canvasCtx.stroke();
            canvasCtx.restore();

            // 5. Draw floating angle badge near the wrist
            drawAngleBadge(canvasCtx, wrist, Math.round(angle), '#00e5ff');
          }

          if (isRecording) {
            const res = state.liveShoulderRotationMeasurer.getResults();
            if (!state.shoulderRotation) {
              state.shoulderRotation = getDefaultShoulderRotation();
            }
            if (side === 'left') {
              state.shoulderRotation.maxExternalRotationL = res.maxExternalRotation;
              state.shoulderRotation.maxInternalRotationL = res.maxInternalRotation;
              state.shoulderRotation.timeSeriesL = res.timeSeries;
            } else {
              state.shoulderRotation.maxExternalRotationR = res.maxExternalRotation;
              state.shoulderRotation.maxInternalRotationR = res.maxInternalRotation;
              state.shoulderRotation.timeSeriesR = res.timeSeries;
            }

            updateShoulderRotationSidebarUI();
          }
        } else {
          if (shoulderRotationStatusVal) {
            shoulderRotationStatusVal.textContent = 'Offline';
            shoulderRotationStatusVal.className = 'text-slate';
          }
        }
      } else if (state.currentMode === 'thoracic_extension') {
        if (!state.thoracicExtension) {
          state.thoracicExtension = getDefaultThoracicExtension();
        }

        const isRec = !!state.thoracicExtension.isRecording;

        if (isRec) {
          const angle = calculateThoracicExtensionAngle(results.poseLandmarks);
          if (angle !== null) {
            state.thoracicExtension.liveAngle = angle;
            
            if (angle > (state.thoracicExtension.peakAngle || 0)) {
              state.thoracicExtension.peakAngle = angle;
              autoSyncToActiveProfileDebounced();
            }
            
            updateThoracicExtensionSidebarUI();
            setThoracicExtensionStatus('Recording Peak Angles...', 'text-amber');

            canvasCtx.save();
            canvasCtx.strokeStyle = '#f59e0b';
            canvasCtx.lineWidth = 3;
            canvasCtx.setLineDash([6, 6]);
            canvasCtx.beginPath();
            const shoulderMid = results.poseLandmarks[11] && results.poseLandmarks[12] ? {
              x: (getCanvasX(results.poseLandmarks[11].x) + getCanvasX(results.poseLandmarks[12].x)) / 2,
              y: ((results.poseLandmarks[11].y + results.poseLandmarks[12].y) / 2) * (state.canvasHeight || 480)
            } : null;
            const hipMid = results.poseLandmarks[23] && results.poseLandmarks[24] ? {
              x: (getCanvasX(results.poseLandmarks[23].x) + getCanvasX(results.poseLandmarks[24].x)) / 2,
              y: ((results.poseLandmarks[23].y + results.poseLandmarks[24].y) / 2) * (state.canvasHeight || 480)
            } : null;
            if (shoulderMid && hipMid) {
              canvasCtx.moveTo(shoulderMid.x, shoulderMid.y);
              canvasCtx.lineTo(hipMid.x, hipMid.y);
              canvasCtx.stroke();
            }
            canvasCtx.restore();
            drawAngleBadge(canvasCtx, { x: shoulderMid?.x || 0, y: shoulderMid?.y || 0 }, Math.round(angle), '#f59e0b');
          } else {
            setThoracicExtensionStatus('Offline');
          }
        } else {
          // NOT RECORDING - do not measure or draw thoracic extension lines/badges on canvas
          state.thoracicExtension.liveAngle = 0;
          updateThoracicExtensionSidebarUI();
          if (results.poseLandmarks) {
            setThoracicExtensionStatus('Ready to Record', 'text-emerald');
          } else {
            setThoracicExtensionStatus('Awaiting Subject', 'text-slate');
          }
        }
      } else if (state.currentMode === 'hip_rotation') {
        const side = state.hipRotationTestingSide || 'left';
        
        // Ensure live measurer is initialized
        if (!state.liveHipRotationMeasurer) {
          state.liveHipRotationMeasurer = new HipRotationMeasurer();
        }
        
        // Get current video playhead or index-based timestamp
        const videoElement = document.getElementById('uploaded-video');
        const ts = (videoElement && !videoElement.paused) ? videoElement.currentTime : (Date.now() / 1000);
        
        const isRecording = !!state.isHipRotationRecording;
        const angle = state.liveHipRotationMeasurer.processFrame(results.poseLandmarks, side, ts, isRecording);
        
        if (angle !== null) {
          if (side === 'left') {
            if (hipRotationLiveAngleL) hipRotationLiveAngleL.textContent = `${Math.round(angle)}°`;
            if (hipRotationLiveAngleR) hipRotationLiveAngleR.textContent = '--°';
          } else {
            if (hipRotationLiveAngleR) hipRotationLiveAngleR.textContent = `${Math.round(angle)}°`;
            if (hipRotationLiveAngleL) hipRotationLiveAngleL.textContent = '--°';
          }

          if (hipRotationStatusVal) {
            if (isRecording) {
              hipRotationStatusVal.textContent = 'Recording Peak Angles...';
              hipRotationStatusVal.className = 'text-amber';
            } else {
              hipRotationStatusVal.textContent = 'Active Tracking (Ready)';
              hipRotationStatusVal.className = 'text-emerald';
            }
          }

          // Draw rich visual overlays for Hip Rotation
          const hipIdx = side === 'left' ? 23 : 24;
          const kneeIdx = side === 'left' ? 25 : 26;
          const ankleIdx = side === 'left' ? 27 : 28;
          
          const rawHip = results.poseLandmarks[hipIdx];
          const rawKnee = results.poseLandmarks[kneeIdx];
          const rawAnkle = results.poseLandmarks[ankleIdx];
          
          if (rawHip && rawKnee && rawAnkle) {
            const height = state.canvasHeight || 480;
            const hipLoc = { x: getCanvasX(rawHip.x), y: rawHip.y * height };
            const kneeLoc = { x: getCanvasX(rawKnee.x), y: rawKnee.y * height };
            const ankleLoc = { x: getCanvasX(rawAnkle.x), y: rawAnkle.y * height };

            // 1. Draw vertical reference line (0° tibia position) starting from the knee
            canvasCtx.save();
            canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            canvasCtx.setLineDash([5, 5]);
            canvasCtx.lineWidth = 1.5;
            canvasCtx.beginPath();
            canvasCtx.moveTo(kneeLoc.x, kneeLoc.y);
            const tibiaLen = Math.sqrt((ankleLoc.x - kneeLoc.x) ** 2 + (ankleLoc.y - kneeLoc.y) ** 2) || 80;
            canvasCtx.lineTo(kneeLoc.x, kneeLoc.y + tibiaLen); // Vertically straight down
            canvasCtx.stroke();
            canvasCtx.restore();

            // 2. Draw angle arc at the knee
            const r = Math.min(30, tibiaLen / 2);
            canvasCtx.save();
            canvasCtx.strokeStyle = '#10b981'; // Glowing emerald for Hip Rotation
            canvasCtx.lineWidth = 2.5;
            canvasCtx.beginPath();
            const tibiaAngleRad = Math.atan2(ankleLoc.y - kneeLoc.y, ankleLoc.x - kneeLoc.x);
            const baselineAngleRad = Math.PI / 2; // Straight down (y positive is down)
            canvasCtx.arc(kneeLoc.x, kneeLoc.y, r, baselineAngleRad, tibiaAngleRad, tibiaAngleRad < baselineAngleRad);
            canvasCtx.stroke();
            canvasCtx.restore();

            // 3. Draw premium glowing line for the tibia (knee to ankle)
            canvasCtx.save();
            canvasCtx.strokeStyle = '#10b981';
            canvasCtx.lineWidth = 4;
            canvasCtx.shadowColor = '#10b981';
            canvasCtx.shadowBlur = 10;
            canvasCtx.beginPath();
            canvasCtx.moveTo(kneeLoc.x, kneeLoc.y);
            canvasCtx.lineTo(ankleLoc.x, ankleLoc.y);
            canvasCtx.stroke();
            canvasCtx.restore();

            // 4. Draw upper leg femur line (hip to knee)
            canvasCtx.save();
            canvasCtx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
            canvasCtx.lineWidth = 3;
            canvasCtx.beginPath();
            canvasCtx.moveTo(hipLoc.x, hipLoc.y);
            canvasCtx.lineTo(kneeLoc.x, kneeLoc.y);
            canvasCtx.stroke();
            canvasCtx.restore();

            // 5. Draw floating angle badge near the ankle
            drawAngleBadge(canvasCtx, ankleLoc, Math.round(angle), '#10b981');
          } else {
            // Fallback: draw standard skeleton mesh
            if (results.poseLandmarks) {
              drawFullSkeletalMesh(canvasCtx, results.poseLandmarks);
            }
          }

          if (isRecording) {
            const res = state.liveHipRotationMeasurer.getResults();
            if (!state.hipRotation) {
              state.hipRotation = getDefaultHipRotation();
            }
            if (side === 'left') {
              state.hipRotation.maxExternalRotationL = res.maxExternalRotation;
              state.hipRotation.maxInternalRotationL = res.maxInternalRotation;
              state.hipRotation.maxExternalRotationTimeL = res.maxExternalRotationTime;
              state.hipRotation.maxInternalRotationTimeL = res.maxInternalRotationTime;
              state.hipRotation.timeSeriesL = res.timeSeries;
            } else {
              state.hipRotation.maxExternalRotationR = res.maxExternalRotation;
              state.hipRotation.maxInternalRotationR = res.maxInternalRotation;
              state.hipRotation.maxExternalRotationTimeR = res.maxExternalRotationTime;
              state.hipRotation.maxInternalRotationTimeR = res.maxInternalRotationTime;
              state.hipRotation.timeSeriesR = res.timeSeries;
            }

            updateHipRotationSidebarUI();
          }
        } else {
          if (hipRotationStatusVal) {
            hipRotationStatusVal.textContent = 'Offline';
            hipRotationStatusVal.className = 'text-slate';
          }
        }
      }

      // Draw real-time biometrics to dashboard and ruler if calibrated
      if (state.pixelsPerCm && liveMetrics) {
        renderDashboard(liveMetrics);

        // Position ruler on whichever side has more margin
        const body_xs = [shoulder_l, shoulder_r, hip_l, hip_r, knee_l, knee_r, ankle_l, ankle_r]
          .filter(p => p !== null && p !== undefined && p.x !== undefined)
          .map(p => p.x);
        if (body_xs.length === 0) body_xs.push(320);
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

        statusElement.textContent = `Calibrated Tracking active. Real-time biometrics rendering.`;
      } else {
        statusElement.textContent = " Scale not calibrated yet. Lock your 200mm marker calibration first.";
      }
    } else {
      statusElement.textContent = "Scanning for a person... Align your printed marker first.";
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
  
  statusElement.textContent = "SNAPSHOT CAPTURED! Biomechanical statistics frozen on screen.";
  
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
  
  canvasCtx.fillText(`${currentCap} CAPTURED!`, canvasElement.width / 2, panelY + 18);
  
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
  canvasCtx.fillText('SNAPSHOT FROZEN', 0, 0);
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
        if (state.latestPoseResults && !state.activeModalVideoProcessing) {
          // If YOLO mode is active, we let the async callback handle drawing to avoid WebGL recycled resource flashing
          if (!state.yoloModeActive) {
            onPoseResults(state.latestPoseResults);
          }
        } else if (!state.latestPoseResults) {
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
        
        if (state.latestHandResults && drawHandMesh && !state.activeModalVideoProcessing) {
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

export function stopActiveROMRecordings() {
  // Safe safeguard: stop any active video recording
  if (state.isRecording && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    try { state.mediaRecorder.stop(); } catch(e){}
    state.isRecording = false;
  }

  if (state.thoracicExtension) {
    state.thoracicExtension.isRecording = false;
    const btnSaveThoracic = document.getElementById('btn-save-thoracic-results');
    if (btnSaveThoracic) {
      btnSaveThoracic.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
        Record Movement
      `;
      btnSaveThoracic.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btnSaveThoracic.style.borderColor = '';
      btnSaveThoracic.classList.remove('recording-pulse');
    }
    setThoracicExtensionStatus('Ready to Record', 'text-emerald');
    updateThoracicExtensionSidebarUI();
  }

  if (state.ankleDorsi) {
    state.ankleDorsi.isRecording = false;
    const btnSaveDorsi = document.getElementById('btn-save-dorsi-results');
    if (btnSaveDorsi) {
      btnSaveDorsi.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
        Record Movement
      `;
      btnSaveDorsi.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btnSaveDorsi.style.borderColor = '';
      btnSaveDorsi.classList.remove('recording-pulse');
    }
    updateDorsiLiveUI();
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
  stopActiveROMRecordings();

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

    let consecutiveErrors = 0;

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
          consecutiveErrors = 0;
        }
      }
      catch (err) {
        console.error("Camera inference loop error:", err);
        consecutiveErrors++;

        if (consecutiveErrors >= 5) {
          console.error("Critical: Multiple consecutive camera inference failures detected. Stopping loop to prevent system freeze.");
          state.isCameraInferenceLoopRunning = false;
          
          // Stop camera track to release hardware lock
          try {
            if (state.activeStream) {
              state.activeStream.getTracks().forEach(track => track.stop());
              state.activeStream = null;
            }
          } catch (e) {
            console.warn("Could not release active camera stream:", e);
          }
          
          if (startButton) {
            startButton.classList.remove('hidden');
          }
          
          const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
          let extraTip = "";
          if (isFirefox) {
            extraTip = `<br><br><strong style="color: #f59e0b;">Firefox Specific Tip:</strong> Firefox sometimes restricts WebGL context creation due to driver blacklists or performance settings. You can force-enable it by navigating to <code>about:config</code> in a new tab, searching for <code>webgl.force-enabled</code>, and setting it to <code>true</code>.`;
          }
          
          if (statusElement) {
            statusElement.innerHTML = `
              <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); padding: 1.25rem; border-radius: 12px; margin-top: 1rem; text-align: left; color: #fecaca; line-height: 1.6; font-family: system-ui, -apple-system, sans-serif;">
                <h4 style="margin-top: 0; margin-bottom: 0.5rem; color: #f87171; font-size: 1.1rem; display: flex; align-items: center; gap: 8px; font-weight: 700;">
                  <svg width="22" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #ef4444;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  Tracking Initialization Failed (WebGL Error)
                </h4>
                <p style="margin-bottom: 0.85rem; font-size: 0.92rem; color: #fca5a5;">
                  Our real-time biometric analysis engine requires browser-level WebGL graphics acceleration. Your browser or GPU driver currently has hardware acceleration disabled or context creation refused.
                </p>
                <div style="font-size: 0.88rem; background: rgba(0,0,0,0.3); padding: 0.85rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                  <strong>How to fix this in under a minute:</strong>
                  <ol style="margin: 0.5rem 0 0 1.25rem; padding: 0; display: flex; flex-direction: column; gap: 4px;">
                    <li>Open your browser settings (e.g., in Chrome: <code>Settings &gt; System</code>; in Firefox: <code>Settings &gt; General &gt; Performance</code>).</li>
                    <li>Toggle <strong>"Use graphics/hardware acceleration when available"</strong> to ON.</li>
                    <li>Relaunch your browser and reload this page to activate high-precision tracking.</li>
                  </ol>
                  ${extraTip}
                </div>
              </div>
            `;
          }
          return;
        }
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
      statusElement.innerHTML = `<span class="text-red font-bold">Camera Permission Denied!</span><br>Please click the camera/lock icon in your browser address bar and change camera permissions to 'Allow'.`;
    } else if (err.name === 'NotReadableError') {
      statusElement.innerHTML = `<span class="text-red font-bold">Camera in use by another app!</span><br>Another app (Zoom, Teams, FaceTime, or a terminal script) is currently locking your camera. Please close it and try again.`;
    } else {
      statusElement.innerHTML = `<span class="text-red font-bold">Error: ${err.message}</span><br>Please make sure you are loading this page via 'http://localhost:8000' and not 'file://' (which blocks camera access).`;
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
        <h2 style="font-size: 20px; font-weight: 700; margin: 0; background: linear-gradient(135deg, #818cf8, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Import Video Recording</h2>
        <p style="font-size: 13px; color: #9ca3af; margin: 0; word-break: break-all;">${file.name} (${fileSizeMB} MB)</p>
      </div>
      
      <p style="font-size: 14px; font-weight: 600; color: #e5e7eb; margin: 0 0 14px 0;">Select destination for this recording:</p>
      
      <div id="import-options-container" style="display: flex; flex-direction: column; gap: 10px; max-height: 420px; overflow-y: auto; padding-right: 4px;">
        <!-- Option 1: Saved Video Recordings Playlist -->
        <div class="import-opt-group" style="display: flex; flex-direction: column; gap: 6px;">
          <div class="import-opt-card" data-value="playlist" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
            <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
              <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">Saved Video Recordings Playlist</div>
              <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Adds video to subject's saved playlist without updating active test slots.</div>
            </div>
          </div>
        </div>

        <!-- Option 2: Overhead Squat Parent -->
        <div class="import-opt-group" style="display: flex; flex-direction: column; gap: 6px;">
          <div class="import-opt-card" data-value="squat-parent" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
            <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
              <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;"> Overhead Squat Video</div>
              <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Analyze knee mobility, depth peaks, and frontal valgus/varus alignment.</div>
            </div>
          </div>
          <div class="import-sub-options-panel" style="display: none; margin-left: 38px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 14px; flex-direction: column; gap: 10px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: 500; margin-bottom: 2px;">Select perspective option:</div>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="squat-sub" value="squat-l" checked style="width: 14px; height: 14px; accent-color: #818cf8;"> Left Sagittal Squat
            </label>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="squat-sub" value="squat-r" style="width: 14px; height: 14px; accent-color: #818cf8;"> Right Sagittal Squat
            </label>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="squat-sub" value="squat-frontal" style="width: 14px; height: 14px; accent-color: #818cf8;"> Frontal Squat (Knee Valgus)
            </label>
          </div>
        </div>

        <!-- Option 3: Shoulder Flexion Parent -->
        <div class="import-opt-group" style="display: flex; flex-direction: column; gap: 6px;">
          <div class="import-opt-card" data-value="shoulder-parent" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
            <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
              <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">Shoulder Flexion Video</div>
              <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Compute shoulder flexion range of motion and extension angles.</div>
            </div>
          </div>
          <div class="import-sub-options-panel" style="display: none; margin-left: 38px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 14px; flex-direction: column; gap: 10px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: 500; margin-bottom: 2px;">Select side to test:</div>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="shoulder-sub" value="shoulder-l" checked style="width: 14px; height: 14px; accent-color: #818cf8;"> Left Shoulder Flexion
            </label>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="shoulder-sub" value="shoulder-r" style="width: 14px; height: 14px; accent-color: #818cf8;"> Right Shoulder Flexion
            </label>
          </div>
        </div>

        <!-- Option 4: Shoulder Rotation Parent -->
        <div class="import-opt-group" style="display: flex; flex-direction: column; gap: 6px;">
          <div class="import-opt-card" data-value="shoulder-rotation-parent" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
            <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
              <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">Shoulder Rotation Video</div>
              <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Compute shoulder internal and external rotation angles (sagittal view).</div>
            </div>
          </div>
          <div class="import-sub-options-panel" style="display: none; margin-left: 38px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 14px; flex-direction: column; gap: 10px;">
            <div style="font-size: 12px; color: #9ca3af; font-weight: 500; margin-bottom: 2px;">Select side to test:</div>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="shoulder-rotation-sub" value="shoulder-rotation-l" checked style="width: 14px; height: 14px; accent-color: #818cf8;"> Left Shoulder Rotation
            </label>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; color: #e5e7eb;">
              <input type="radio" name="shoulder-rotation-sub" value="shoulder-rotation-r" style="width: 14px; height: 14px; accent-color: #818cf8;"> Right Shoulder Rotation
            </label>
          </div>
        </div>

        <!-- Option 5: Analyze Video (No save) -->
        <div class="import-opt-group" style="display: flex; flex-direction: column; gap: 6px;">
          <div class="import-opt-card" data-value="analyze-only" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease;">
            <div class="import-radio" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s ease;">
              <div class="import-radio-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #fff; display: none;"></div>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #f3f4f6;">Analyze Video (Don't Save)</div>
              <div style="font-size: 11px; color: #9ca3af; margin-top: 1px;">Loads transiently on the viewport for temporary analysis without database commit.</div>
            </div>
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

        // Hide all sub panels
        const subPanels = card.querySelectorAll('.import-sub-options-panel');
        subPanels.forEach(p => {
          p.style.display = 'none';
        });

        // Show sub panel if applicable
        const subPanel = optCard.parentElement.querySelector('.import-sub-options-panel');
        if (subPanel) {
          subPanel.style.display = 'flex';
        }

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
        let finalValue = selectedValue;
        if (selectedValue === 'squat-parent') {
          const checkedRadio = card.querySelector('input[name="squat-sub"]:checked');
          finalValue = checkedRadio ? checkedRadio.value : 'squat-l';
        } else if (selectedValue === 'shoulder-parent') {
          const checkedRadio = card.querySelector('input[name="shoulder-sub"]:checked');
          finalValue = checkedRadio ? checkedRadio.value : 'shoulder-l';
        } else if (selectedValue === 'shoulder-rotation-parent') {
          const checkedRadio = card.querySelector('input[name="shoulder-rotation-sub"]:checked');
          finalValue = checkedRadio ? checkedRadio.value : 'shoulder-rotation-l';
        }
        closeWithResult(finalValue);
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

          statusElement.textContent = "Preparing imported video for high-fidelity export and peak analysis...";
          
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
              state.squatPeaks.maxForwardLeanL = 0;
              state.squatPeaks.forwardLeanTimestampL = null;
              state.squatPeaks.forwardLeanKneeL = null;
              state.imageSquatL = null; // Clear pre-existing static overlay
            } else if (importTarget === 'squat-r') {
              state.squatTestingSide = 'right';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
              state.squatPeaks.kneeR = 0;
              state.squatPeaks.hipR = 0;
              state.squatPeaks.ankleR = 0;
              state.squatPeaks.maxForwardLeanR = 0;
              state.squatPeaks.forwardLeanTimestampR = null;
              state.squatPeaks.forwardLeanKneeR = null;
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
            setExerciseMode('squat');
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
            setExerciseMode('shoulder');
          } else if (importTarget === 'shoulder-rotation-l' || importTarget === 'shoulder-rotation-r') {
            state.currentMode = 'shoulder_rotation';
            state.shoulderRotation = getDefaultShoulderRotation(state.shoulderRotation);
            if (importTarget === 'shoulder-rotation-l') {
              state.shoulderRotationTestingSide = 'left';
              state.shoulderRotation.maxExternalRotationL = 0;
              state.shoulderRotation.maxInternalRotationL = 0;
              state.shoulderRotation.timeSeriesL = [];
              state.imageShoulderRotationL = null;
            } else if (importTarget === 'shoulder-rotation-r') {
              state.shoulderRotationTestingSide = 'right';
              state.shoulderRotation.maxExternalRotationR = 0;
              state.shoulderRotation.maxInternalRotationR = 0;
              state.shoulderRotation.timeSeriesR = [];
              state.imageShoulderRotationR = null;
            }

            // Sync the active mode and side selectors in the UI
            setExerciseMode('shoulder-rotation');
          } else if (importTarget === 'playlist') {
            setExerciseMode('posture');
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
            statusElement.textContent = ` Video ended at ${uploadedVideo.currentTime.toFixed(1)}s. Finishing export...`;
            setTimeout(() => {
              stopVideoRecording();
            }, 100);
          } else {
            // Wait 2.5 seconds to let the MediaPipe processing pipeline catch up and drain fully to prevent end truncation
            statusElement.textContent = " Finalizing export, compiling remaining frames... please wait.";
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
  let consecutiveErrors = 0;

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
        consecutiveErrors = 0;
      }
    } catch (err) {
      console.error("Uploaded video processing error:", err);
      consecutiveErrors++;

      if (consecutiveErrors >= 5) {
        console.error("Critical: Multiple consecutive failures in uploaded video processing. Pausing video.");
        state.isVideoInferenceLoopRunning = false;
        try {
          uploadedVideo.pause();
        } catch (e) {}

        if (statusElement) {
          statusElement.innerHTML = `<span class="text-red font-bold">Inference Engine Error!</span> WebGL context lost or driver crash. Please enable hardware acceleration in browser settings and reload.`;
        }
        return;
      }
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
      statusElement.textContent = " Snapshot deleted successfully.";
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
    
    lockCalButton.textContent = "Scale Locked!";
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
      openProfileDetailsModal(state.activeProfileId, true);
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
  
  [tabHeightBtn, tabPortfolioBtn, tabImportBtn].forEach(btn => {
    if (btn) {
      btn.classList.toggle('btn-tab-active', btn === activeBtn);
      btn.classList.toggle('btn-tab-inactive', btn !== activeBtn);
    }
  });

  [panelHeight, panelPortfolio, panelImport].forEach(panel => {
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

  if (method === 'height') {
    state.pixelsPerCm = null; // Calculated dynamically in frame loop
    state.calLocked = true;   // Automatically consider locked/calibrated
  } else {
    state.pixelsPerCm = null;
    state.calLocked = false;
  }
}

if (tabHeightBtn) {
  tabHeightBtn.addEventListener('click', () => {
    switchCalibrationTab('height', tabHeightBtn, panelHeight);
  });
}

if (tabPortfolioBtn) {
  tabPortfolioBtn.addEventListener('click', () => {
    switchCalibrationTab('portfolio', tabPortfolioBtn, panelPortfolio);
  });
}

if (tabImportBtn) {
  tabImportBtn.addEventListener('click', () => {
    switchCalibrationTab('import', tabImportBtn, panelImport);
  });
}

// Set initial tab state on load
switchCalibrationTab('height', tabHeightBtn || null, panelHeight);

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
    btnApplyScale.textContent = "Scale Applied! ";
    
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
  btnImportPortfolio.addEventListener('click', async () => {
    const rawVal = textareaPortfolioJson.value.trim();
    if (!rawVal) {
      alert("Please paste a session JSON report in the text area.");
      return;
    }

    try {
      const data = JSON.parse(rawVal);
      await importPriorPortfolio(data);
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
    if (!pt || pt.x === undefined || pt.y === undefined) return;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, jointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 1 * scale);
    ctx.stroke();
  };

  const drawOffscreenBone = (p1, p2, color) => {
    if (!p1 || p1.x === undefined || p1.y === undefined || !p2 || p2.x === undefined || p2.y === undefined) return;
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
    const body_xs = [shoulder_l, shoulder_r, hip_l, hip_r, knee_l, knee_r, ankle_l, ankle_r]
      .filter(p => p !== null && p !== undefined && p.x !== undefined)
      .map(p => p.x);
    if (body_xs.length === 0) body_xs.push(width / 2);
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
    statusElement.textContent = "No active uploaded video found for high-fidelity export.";
    return;
  }

  // Prevent double triggers
  if (state.isExportingFrameByFrame || state.isRecordingPlayLoop) return;

  statusElement.textContent = " Initiating High-Fidelity Pre-processing...";
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
    statusElement.textContent = "Failed to retrieve video duration. Cannot pre-process.";
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

  let consecutiveErrors = 0;
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
        consecutiveErrors = 0;
      } catch (err) {
        console.warn(`MediaPipe processing error at t=${currentTime.toFixed(3)}s:`, err);
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          throw new Error("Biomechanical tracking failed consecutively. This is typically due to a WebGL context crash or lack of hardware acceleration in your browser.");
        }
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
      statusElement.textContent = ` Analyzing biomechanical movements... ${progressPercent.toFixed(0)}%`;

      // 6. Step forward
      currentTime += dt;
    }

    // Pre-processing complete!
    if (state.isExportingFrameByFrame) {
      statusElement.textContent = "Pre-processing complete. Initializing zero-lag playout record...";
      state.isExportingFrameByFrame = false;
      updateRecordButtonUI();

      if (state.currentMode === 'shoulder_flexion') {
        try {
          await processShoulderFlexionFromPreprocessedFrames();
        } catch (err) {
          console.error("[ShoulderProcessing] Error processing preprocessed frames:", err);
        }
      }

      if (state.currentMode === 'shoulder_rotation') {
        try {
          await processShoulderRotationFromPreprocessedFrames();
        } catch (err) {
          console.error("[ShoulderRotationProcessing] Error processing preprocessed frames:", err);
        }
      }

      if (state.currentMode === 'hip_rotation') {
        try {
          await processHipRotationFromPreprocessedFrames();
        } catch (err) {
          console.error("[HipRotationProcessing] Error processing preprocessed frames:", err);
        }
      }

      // Start the Playout phase!
      await startRealTimePlaybackExport();
    }
  } catch (err) {
    console.error("High-Fidelity Pre-processing failed:", err);
    statusElement.textContent = "High-Fidelity Pre-processing failed. Reverting to manual recording.";
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

  statusElement.textContent = "Starting recording playout at 1.0x speed...";
  
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
  
  statusElement.textContent = "Recording playout is active. Analyzing from cached timeline... please do not close this tab.";
  updateRecordButtonUI();
}



export async function importPriorPortfolio(report) {
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

  // 1. Create a brand new player profile based on the imported subject name
  let nameVal = report.subjectName || "Imported Subject";
  let baseName = nameVal;
  let counter = 1;
  while (state.allProfiles.some(p => p.name.toLowerCase() === nameVal.toLowerCase())) {
    nameVal = `${baseName} (Imported ${counter})`;
    counter++;
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
    pixelsPerCm: report.pixelsPerCm || null
  };

  const subjectInput = document.getElementById('subject-name-input');
  if (subjectInput) {
    subjectInput.value = nameVal;
  }

  if (state.dbInitialized) {
    try {
      const newId = await snapshotStore.saveProfile(newProfile);
      state.allProfiles = await snapshotStore.getAllProfiles();
      
      // Sync dropdown select elements
      const profileSelect = document.getElementById('profile-select');
      if (profileSelect) {
        populateDropdown(state.allProfiles);
        profileSelect.value = String(newId);
      }
      const calProfileSelect = document.getElementById('cal-profile-select');
      if (calProfileSelect) {
        calProfileSelect.value = String(newId);
      }
      
      await loadProfileIntoState(newId);
      
      console.log(`[importPriorPortfolio] Created and saved new imported profile: ${nameVal} (ID: ${newId})`);
    } catch (err) {
      console.error("[importPriorPortfolio] Failed to save newly created profile:", err);
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

  const squatMobility = report.overheadSquatMobility || {};
  state.squatPeaks = {
    kneeL: squatMobility.peakKneeFlexionL || 0,
    kneeR: squatMobility.peakKneeFlexionR || 0,
    hipL: squatMobility.peakHipFlexionL || 0,
    hipR: squatMobility.peakHipFlexionR || 0,
    ankleL: squatMobility.peakAnkleDorsiflexionL || 0,
    ankleR: squatMobility.peakAnkleDorsiflexionR || 0
  };

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
    await autoSyncToActiveProfile();
  }

  // High-end feedback animation on Import button
  if (btnImportPortfolio) {
    btnImportPortfolio.classList.add('btn-success-glow');
    btnImportPortfolio.textContent = "Session Imported Successfully! ";
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
  if (!isNaN(inputVal) && inputVal > 0) {
    const heightCm = state.useInches ? inputVal * 2.54 : inputVal;
    state.inputHeightCm = heightCm;

    // Persist updated height if a profile is loaded
    if (state.activeProfileId && state.allProfiles && snapshotStore) {
      const profile = state.allProfiles.find(p => p.id === state.activeProfileId);
      if (profile && profile.heightCm !== heightCm) {
        profile.heightCm = heightCm;
        snapshotStore.saveProfile(profile).catch(err => {
          console.error("Failed to save updated profile height:", err);
        });
      }
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

    statusElement.textContent = "Hands-Free Auto Capture started! Please stand in A-Pose (arms resting relaxed at sides).";
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

// BIND UNIFIED EXERCISE MODE SELECTION SELECTOR
function setExerciseMode(mode) {
  if (!mode) return;
  stopActiveROMRecordings();
  state.currentMode = (mode === 'shoulder' ? 'shoulder_flexion' : (mode === 'shoulder-rotation' ? 'shoulder_rotation' : (mode === 'hip-rotation' ? 'hip_rotation' : (mode === 'ankle-dorsi' ? 'ankledorsi' : mode === 'thoracic-extension' ? 'thoracic_extension' : mode))));

  if (selectTestMode) {
    // Normalise key names to match dropdown option values
    let optValue = mode;
    if (mode === 'shoulder_flexion') optValue = 'shoulder';
    if (mode === 'shoulder_rotation') optValue = 'shoulder-rotation';
    if (mode === 'hip_rotation') optValue = 'hip-rotation';
    if (mode === 'thoracic_extension') optValue = 'thoracic-extension';
    if (mode === 'ankledorsi' || mode === 'ankle-dorsi') optValue = 'ankle-dorsi';
    selectTestMode.value = optValue;
  }

  // Hide all sidebar sections first
  if (postureSidebarContent) postureSidebarContent.classList.add('hidden');
  if (squatSidebarContent) squatSidebarContent.classList.add('hidden');
  if (shoulderSidebarContent) shoulderSidebarContent.classList.add('hidden');
  if (shoulderRotationSidebarContent) shoulderRotationSidebarContent.classList.add('hidden');
  if (hipRotationSidebarContent) hipRotationSidebarContent.classList.add('hidden');
  const thoracicSidebarContent = document.getElementById('thoracic-sidebar-content');
  if (thoracicSidebarContent) thoracicSidebarContent.classList.add('hidden');
  if (ankledorsiSidebarContent) ankledorsiSidebarContent.classList.add('hidden');

  // Show and sync active sidebar
  if (state.currentMode === 'posture') {
    if (postureSidebarContent) postureSidebarContent.classList.remove('hidden');
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateDashboardOfflinePlaceholders();
    }
  } else if (state.currentMode === 'squat') {
    if (squatSidebarContent) squatSidebarContent.classList.remove('hidden');
    updateSquatSideUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateSquatDashboardOffline();
    }
  } else if (state.currentMode === 'ankledorsi') {
    if (ankledorsiSidebarContent) ankledorsiSidebarContent.classList.remove('hidden');
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateDorsiLiveUI();
    }
  } else if (state.currentMode === 'shoulder_flexion') {
    if (shoulderSidebarContent) shoulderSidebarContent.classList.remove('hidden');
    updateShoulderSideUI();
    updateShoulderSidebarUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateShoulderSidebarUI();
    }
  } else if (state.currentMode === 'shoulder_rotation') {
    if (shoulderRotationSidebarContent) shoulderRotationSidebarContent.classList.remove('hidden');
    updateShoulderRotationSideUI();
    updateShoulderRotationSidebarUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateShoulderRotationSidebarUI();
    }
  } else if (state.currentMode === 'thoracic_extension') {
    if (thoracicSidebarContent) thoracicSidebarContent.classList.remove('hidden');
    updateThoracicExtensionSidebarUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateThoracicExtensionSidebarUI();
    }
  } else if (state.currentMode === 'hip_rotation') {
    if (hipRotationSidebarContent) hipRotationSidebarContent.classList.remove('hidden');
    updateHipRotationSideUI();
    updateHipRotationSidebarUI();
    if (state.latestPoseResults) {
      onPoseResults(state.latestPoseResults);
    } else {
      updateHipRotationSidebarUI();
    }
  }
}

// Bind dropdown selection change event
if (selectTestMode) {
  // Always reset select value and active mode to posture (Anthropometric Scan) on page load
  selectTestMode.value = 'posture';
  setExerciseMode('posture');

  selectTestMode.addEventListener('change', (e) => {
    setExerciseMode(e.target.value);
  });
}

// =====================================================================
// SUB-CONTROLLER BUTTONS AND EVENT LISTENERS (NOW MODULARIZED)
// =====================================================================
// =====================================================================
// PROFILE MANAGEMENT AND DETAILS MODAL LOGIC (NOW IN profileManager.js)
// =====================================================================
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
      
      recordBtn.textContent = 'Stop Recording Video';
      recordBtn.style.backgroundColor = '#BA0C2F'; 
      
    } else {
      scarletIsRecording = false;
      if (scarletAnimationId) cancelAnimationFrame(scarletAnimationId);
      if (scarletMediaRecorder && scarletMediaRecorder.state !== 'inactive') scarletMediaRecorder.stop();
      
      recordBtn.textContent = 'Start Recording Video';
      recordBtn.style.backgroundColor = ''; 
    }
  });
}

// =====================================================================
// INITIALIZE MODULAR SUB-CONTROLLER LISTENERS
// =====================================================================
registerProfileCallbacks({
  renderDashboard,
  updateDashboardOfflinePlaceholders,
  setUnitSystem,
  importPriorPortfolio
});

registerSquatCallbacks({
  startVideoRecording,
  stopVideoRecording,
  showAnalysisProgressOverlay,
  hideAnalysisProgressOverlay,
  updateRecordButtonUI,
  getPoseModel: () => pose
});

registerShoulderRotationCallbacks({
  startVideoRecording,
  stopVideoRecording
});

registerHipRotationCallbacks({
  startVideoRecording,
  stopVideoRecording
});

registerAnkleDorsiCallbacks({
  startVideoRecording,
  stopVideoRecording
});

registerThoracicCallbacks({
  startVideoRecording,
  stopVideoRecording
});

setupShoulderListeners(onPoseResults, updateDashboardOfflinePlaceholders);
setupShoulderRotationListeners(onPoseResults);
setupHipRotationListeners(onPoseResults);
setupThoracicExtensionListeners(onPoseResults);
setupSquatListeners(onPoseResults, updateDashboardOfflinePlaceholders);
setupAnkleDorsiEvents(onPoseResults);
setupVideoControls(pose, hands, onPoseResults, drawHandMesh);

// Initial UI sync for side selectors
setTimeout(() => {
  updateSquatSideUI();
  updateShoulderSideUI();
  updateShoulderSidebarUI();
  updateShoulderRotationSideUI();
  updateShoulderRotationSidebarUI();
  updateHipRotationSideUI();
  updateHipRotationSidebarUI();
  updateThoracicExtensionSidebarUI();
  updateDorsiLiveUI();
}, 200);

window.addEventListener('load', initScarletRecorder);
