// =========================================================
// OVERHEAD SQUAT CONTROLLER MODULE
// =========================================================

import { state, getCanvasX, snapshotStore } from './helpers.js';
import { autoSyncToActiveProfile, openProfileDetailsModal } from './profileManager.js';

// DOM Elements
const canvasElement = document.getElementById('overlay');
const statusElement = document.getElementById('status');
const videoElement = document.getElementById('webcam');
const uploadedVideo = document.getElementById('uploaded-video');

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
const btnSaveSquatPeaks = document.getElementById('btn-save-squat-peaks');

// Callbacks to prevent circular imports
let startVideoRecordingFn = null;
let stopVideoRecordingFn = null;
let showAnalysisProgressOverlayFn = null;
let hideAnalysisProgressOverlayFn = null;
let updateRecordButtonUIFn = null;
let getPoseModelFn = null;

export function registerSquatCallbacks(config) {
  startVideoRecordingFn = config.startVideoRecording;
  stopVideoRecordingFn = config.stopVideoRecording;
  showAnalysisProgressOverlayFn = config.showAnalysisProgressOverlay;
  hideAnalysisProgressOverlayFn = config.hideAnalysisProgressOverlay;
  updateRecordButtonUIFn = config.updateRecordButtonUI;
  getPoseModelFn = config.getPoseModel;
}

export function calculateValgusAndVarus(joints) {
  let valgusL = 0;
  let valgusR = 0;
  let varusL = 0;
  let varusR = 0;

  if (!joints) return { valgusL, valgusR, varusL, varusR };

  const leftKnee = joints[25];
  const leftHip = joints[23];
  const leftAnkle = joints[27];

  const rightKnee = joints[26];
  const rightHip = joints[24];
  const rightAnkle = joints[28];

  // Left Leg (Screen Right, X is larger)
  if (leftKnee && leftHip && leftAnkle) {
    const hipX = getCanvasX(leftHip.x);
    const ankleX = getCanvasX(leftAnkle.x);
    const kneeX = getCanvasX(leftKnee.x);
    
    const midX = (hipX + ankleX) / 2;
    const thresh = Math.abs(hipX - ankleX) * 0.15;
    const denom = Math.abs(hipX - ankleX) * 0.35;

    // Valgus (Cave-In): Knee moves inward (smaller X, toward center)
    if (kneeX < midX - thresh) {
      const dev = (midX - thresh) - kneeX;
      valgusL = Math.min(100, (dev / denom) * 100);
    }
    // Varus (Bow-Out): Knee moves outward (larger X, away from center)
    if (kneeX > midX + thresh) {
      const dev = kneeX - (midX + thresh);
      varusL = Math.min(100, (dev / denom) * 100);
    }
  }

  // Right Leg (Screen Left, X is smaller)
  if (rightKnee && rightHip && rightAnkle) {
    const hipX = getCanvasX(rightHip.x);
    const ankleX = getCanvasX(rightAnkle.x);
    const kneeX = getCanvasX(rightKnee.x);

    const midX = (hipX + ankleX) / 2;
    const thresh = Math.abs(hipX - ankleX) * 0.15;
    const denom = Math.abs(hipX - ankleX) * 0.35;

    // Valgus (Cave-In): Knee moves inward (larger X, toward center)
    if (kneeX > midX + thresh) {
      const dev = kneeX - (midX + thresh);
      valgusR = Math.min(100, (dev / denom) * 100);
    }
    // Varus (Bow-Out): Knee moves outward (smaller X, away from center)
    if (kneeX < midX - thresh) {
      const dev = (midX - thresh) - kneeX;
      varusR = Math.min(100, (dev / denom) * 100);
    }
  }

  return { valgusL, valgusR, varusL, varusR };
}

export function calculateValgusFromJoints(joints) {
  const { valgusL, valgusR } = calculateValgusAndVarus(joints);
  return { pctL: valgusL, pctR: valgusR };
}

export function calculateVarusFromJoints(joints) {
  const { varusL, varusR } = calculateValgusAndVarus(joints);
  return { pctL: varusL, pctR: varusR };
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
    valgusPeakScore: 0,
    maxKneeBowL: 0,
    maxKneeBowR: 0,
    varusFirstTimestamp: null,
    varusPeakTimestamp: null,
    varusPeakScore: 0
  };
  if (existing) {
    return { ...defaults, ...existing };
  }
  return defaults;
}

export function updateSquatDashboardOffline() {
  const p = state.squatPeaks || getDefaultSquatPeaks();
  
  if (squatPeakKneeL) squatPeakKneeL.textContent = p.kneeL ? `${Math.round(p.kneeL)}°` : '--';
  if (squatPeakKneeR) squatPeakKneeR.textContent = p.kneeR ? `${Math.round(p.kneeR)}°` : '--';
  if (squatPeakHipL) squatPeakHipL.textContent = p.hipL ? `${Math.round(p.hipL)}°` : '--';
  if (squatPeakHipR) squatPeakHipR.textContent = p.hipR ? `${Math.round(p.hipR)}°` : '--';
  if (squatPeakAnkleL) squatPeakAnkleL.textContent = p.ankleL ? `${Math.round(p.ankleL)}°` : '--';
  if (squatPeakAnkleR) squatPeakAnkleR.textContent = p.ankleR ? `${Math.round(p.ankleR)}°` : '--';

  if (squatLiveKneeL) squatLiveKneeL.textContent = '--';
  if (squatLiveKneeR) squatLiveKneeR.textContent = '--';
  if (squatLiveHipL) squatLiveHipL.textContent = '--';
  if (squatLiveHipR) squatLiveHipR.textContent = '--';
  if (squatLiveAnkleL) squatLiveAnkleL.textContent = '--';
  if (squatLiveAnkleR) squatLiveAnkleR.textContent = '--';
}

export function updateSquatSideUI() {
  const side = state.squatTestingSide || 'left';
  
  if (btnSquatSideLeft && btnSquatSideRight) {
    if (side === 'left') {
      btnSquatSideLeft.classList.add('active-left');
      btnSquatSideRight.classList.remove('active-right');
      if (btnSquatSideFrontal) btnSquatSideFrontal.classList.remove('active-frontal');
      
      btnSquatSideLeft.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnSquatSideLeft.style.color = 'white';
      btnSquatSideRight.style.background = 'transparent';
      btnSquatSideRight.style.color = '#a7b1b7';
      if (btnSquatSideFrontal) {
        btnSquatSideFrontal.style.background = 'transparent';
        btnSquatSideFrontal.style.color = '#a7b1b7';
      }
    } else if (side === 'right') {
      btnSquatSideRight.classList.add('active-right');
      btnSquatSideLeft.classList.remove('active-left');
      if (btnSquatSideFrontal) btnSquatSideFrontal.classList.remove('active-frontal');
      
      btnSquatSideRight.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
      btnSquatSideRight.style.color = 'white';
      btnSquatSideLeft.style.background = 'transparent';
      btnSquatSideLeft.style.color = '#a7b1b7';
      if (btnSquatSideFrontal) {
        btnSquatSideFrontal.style.background = 'transparent';
        btnSquatSideFrontal.style.color = '#a7b1b7';
      }
    } else if (side === 'frontal') {
      if (btnSquatSideFrontal) btnSquatSideFrontal.classList.add('active-frontal');
      btnSquatSideLeft.classList.remove('active-left');
      btnSquatSideRight.classList.remove('active-right');
      
      if (btnSquatSideFrontal) {
        btnSquatSideFrontal.style.background = 'linear-gradient(135deg, #BA0C2F 0%, #8c051e 100%)';
        btnSquatSideFrontal.style.color = 'white';
      }
      btnSquatSideLeft.style.background = 'transparent';
      btnSquatSideLeft.style.color = '#a7b1b7';
      btnSquatSideRight.style.background = 'transparent';
      btnSquatSideRight.style.color = '#a7b1b7';
    }
  }

  const angleBoxes = document.querySelectorAll('#squat-sidebar-content .angle-box');
  angleBoxes.forEach(box => {
    if (side === 'left') {
      if (box.classList.contains('left-border')) {
        box.classList.add('active-left');
        box.classList.remove('inactive-side');
      } else {
        box.classList.add('inactive-side');
        box.classList.remove('active-right', 'active-frontal');
      }
    } else if (side === 'right') {
      if (box.classList.contains('right-border')) {
        box.classList.add('active-right');
        box.classList.remove('inactive-side');
      } else {
        box.classList.add('inactive-side');
        box.classList.remove('active-left', 'active-frontal');
      }
    } else if (side === 'frontal') {
      if (box.classList.contains('frontal-border')) {
        box.classList.add('active-frontal');
        box.classList.remove('inactive-side');
      } else {
        box.classList.add('inactive-side');
        box.classList.remove('active-left', 'active-right');
      }
    }
  });
}

export function updateSquatDashboardUI(kneeMobL, kneeMobR, hipMobL, hipMobR, ankleMobL, ankleMobR, calculated) {
  const p = state.squatPeaks || getDefaultSquatPeaks();
  const activeSide = state.squatTestingSide || 'left';

  const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;
  const shouldUpdatePeaks = !isWebcamLive || !!state.isRecordingAssessment || !!state.isExportingFrameByFrame;

  if (shouldUpdatePeaks) {
    if (activeSide === 'left') {
      if (kneeMobL > 0 && (p.kneeL === 0 || kneeMobL > p.kneeL)) { // Note: larger knee mobility means a deeper squat!
        p.kneeL = kneeMobL;
      }
      if (hipMobL > 0 && (p.hipL === 0 || hipMobL > p.hipL)) { // Note: deeper squat has larger hip mobility!
        p.hipL = hipMobL;
      }
      if (ankleMobL > 0 && (p.ankleL === 0 || ankleMobL > p.ankleL)) {
        p.ankleL = ankleMobL;
      }
    } else if (activeSide === 'right') {
      if (kneeMobR > 0 && (p.kneeR === 0 || kneeMobR > p.kneeR)) {
        p.kneeR = kneeMobR;
      }
      if (hipMobR > 0 && (p.hipR === 0 || hipMobR > p.hipR)) {
        p.hipR = hipMobR;
      }
      if (ankleMobR > 0 && (p.ankleR === 0 || ankleMobR > p.ankleR)) {
        p.ankleR = ankleMobR;
      }
    } else if (activeSide === 'frontal') {
      const landmarks = calculated ? calculated.landmarks : null;
      if (landmarks) {
        const valgus = calculateValgusFromJoints(landmarks);
        const varus = calculateVarusFromJoints(landmarks);
        
        if (valgus.pctL > p.maxKneeCaveL) {
          p.maxKneeCaveL = valgus.pctL;
        }
        if (valgus.pctR > p.maxKneeCaveR) {
          p.maxKneeCaveR = valgus.pctR;
        }

        const activeScore = Math.max(valgus.pctL, valgus.pctR);
        if (activeScore > 5) {
          const timeSec = uploadedVideo ? uploadedVideo.currentTime : null;
          if (p.valgusFirstTimestamp === null && timeSec !== null) {
            p.valgusFirstTimestamp = timeSec;
          }
          if (activeScore > p.valgusPeakScore) {
            p.valgusPeakScore = activeScore;
            p.valgusPeakTimestamp = timeSec;
          }
        }

        if (varus.pctL > (p.maxKneeBowL || 0)) {
          p.maxKneeBowL = varus.pctL;
        }
        if (varus.pctR > (p.maxKneeBowR || 0)) {
          p.maxKneeBowR = varus.pctR;
        }

        const activeVarusScore = Math.max(varus.pctL, varus.pctR);
        if (activeVarusScore > 5) {
          const timeSec = uploadedVideo ? uploadedVideo.currentTime : null;
          if (p.varusFirstTimestamp === null && timeSec !== null) {
            p.varusFirstTimestamp = timeSec;
          }
          if (activeVarusScore > p.varusPeakScore) {
            p.varusPeakScore = activeVarusScore;
            p.varusPeakTimestamp = timeSec;
          }
        }
      }
    }
  }

  // Sync to side display
  if (squatPeakKneeL) squatPeakKneeL.textContent = p.kneeL ? `${Math.round(p.kneeL)}°` : '--';
  if (squatPeakKneeR) squatPeakKneeR.textContent = p.kneeR ? `${Math.round(p.kneeR)}°` : '--';
  if (squatPeakHipL) squatPeakHipL.textContent = p.hipL ? `${Math.round(p.hipL)}°` : '--';
  if (squatPeakHipR) squatPeakHipR.textContent = p.hipR ? `${Math.round(p.hipR)}°` : '--';
  if (squatPeakAnkleL) squatPeakAnkleL.textContent = p.ankleL ? `${Math.round(p.ankleL)}°` : '--';
  if (squatPeakAnkleR) squatPeakAnkleR.textContent = p.ankleR ? `${Math.round(p.ankleR)}°` : '--';

  if (activeSide === 'left') {
    if (squatLiveKneeL) squatLiveKneeL.textContent = kneeMobL > 0 ? `${Math.round(kneeMobL)}°` : '--';
    if (squatLiveKneeR) squatLiveKneeR.textContent = '--';
    if (squatLiveHipL) squatLiveHipL.textContent = hipMobL > 0 ? `${Math.round(hipMobL)}°` : '--';
    if (squatLiveHipR) squatLiveHipR.textContent = '--';
    if (squatLiveAnkleL) squatLiveAnkleL.textContent = ankleMobL > 0 ? `${Math.round(ankleMobL)}°` : '--';
    if (squatLiveAnkleR) squatLiveAnkleR.textContent = '--';
  } else if (activeSide === 'right') {
    if (squatLiveKneeR) squatLiveKneeR.textContent = kneeMobR > 0 ? `${Math.round(kneeMobR)}°` : '--';
    if (squatLiveKneeL) squatLiveKneeL.textContent = '--';
    if (squatLiveHipR) squatLiveHipR.textContent = hipMobR > 0 ? `${Math.round(hipMobR)}°` : '--';
    if (squatLiveHipL) squatLiveHipL.textContent = '--';
    if (squatLiveAnkleR) squatLiveAnkleR.textContent = ankleMobR > 0 ? `${Math.round(ankleMobR)}°` : '--';
    if (squatLiveAnkleL) squatLiveAnkleL.textContent = '--';
  } else if (activeSide === 'frontal') {
    const valgus = calculateValgusFromJoints(calculated ? calculated.landmarks : null);
    const varus = calculateVarusFromJoints(calculated ? calculated.landmarks : null);

    if (squatLiveKneeL) {
      if (valgus.pctL > 5) {
        squatLiveKneeL.textContent = `Valgus: ${Math.round(valgus.pctL)}%`;
      } else if (varus.pctL > 5) {
        squatLiveKneeL.textContent = `Varus: ${Math.round(varus.pctL)}%`;
      } else {
        squatLiveKneeL.textContent = 'None';
      }
    }
    if (squatLiveKneeR) {
      if (valgus.pctR > 5) {
        squatLiveKneeR.textContent = `Valgus: ${Math.round(valgus.pctR)}%`;
      } else if (varus.pctR > 5) {
        squatLiveKneeR.textContent = `Varus: ${Math.round(varus.pctR)}%`;
      } else {
        squatLiveKneeR.textContent = 'None';
      }
    }
    
    if (squatLiveHipL) squatLiveHipL.textContent = '--';
    if (squatLiveHipR) squatLiveHipR.textContent = '--';
    if (squatLiveAnkleL) squatLiveAnkleL.textContent = '--';
    if (squatLiveAnkleR) squatLiveAnkleR.textContent = '--';
  }

  // Update status descriptor bar
  if (squatStatusVal) {
    if (activeSide === 'frontal') {
      const displayScore = Math.max(p.maxKneeCaveL || 0, p.maxKneeCaveR || 0);
      const displayVarusScore = Math.max(p.maxKneeBowL || 0, p.maxKneeBowR || 0);

      if (displayScore > displayVarusScore) {
        if (displayScore > 20) {
          squatStatusVal.textContent = `Severe Medial Collapse (${Math.round(displayScore)}%)`;
          squatStatusVal.className = 'text-red font-bold';
        } else if (displayScore > 8) {
          squatStatusVal.textContent = `Mild Knee Cave Detected (${Math.round(displayScore)}%)`;
          squatStatusVal.className = 'text-amber font-bold';
        } else {
          squatStatusVal.textContent = 'Pristine Alignment (No Cave)';
          squatStatusVal.className = 'text-emerald font-bold';
        }
      } else {
        if (displayVarusScore > 20) {
          squatStatusVal.textContent = `Severe Knee Varus / Bow-Out (${Math.round(displayVarusScore)}%)`;
          squatStatusVal.className = 'text-red font-bold';
        } else if (displayVarusScore > 8) {
          squatStatusVal.textContent = `Mild Knee Varus / Bow-Out (${Math.round(displayVarusScore)}%)`;
          squatStatusVal.className = 'text-amber font-bold';
        } else if (displayVarusScore > 0) {
          squatStatusVal.textContent = 'Pristine Alignment (No Bow-Out)';
          squatStatusVal.className = 'text-emerald font-bold';
        } else {
          squatStatusVal.textContent = 'Pristine Alignment';
          squatStatusVal.className = 'text-emerald font-bold';
        }
      }
    } else {
      squatStatusVal.textContent = 'Active Tracking';
      squatStatusVal.className = 'text-emerald';
    }
  }
}

export async function resetSquatPeaks() {
  state.squatPeaks = getDefaultSquatPeaks();
  state.imageSquatL = null;
  state.imageSquatR = null;
  state.imageSquatFrontal = null;
  state.jointsOverhead = null;
  
  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }

  if (squatStatusVal) {
    squatStatusVal.textContent = 'Awaiting Subject';
    squatStatusVal.classList.remove('text-slate', 'text-amber', 'text-red', 'text-emerald');
    squatStatusVal.classList.add('text-slate');
  }

  updateSquatDashboardOffline();
}

export async function scanVideoForSquatPeaks(targetSide, durationSec) {
  if (!state.isUploadedMedia || state.uploadedMediaType !== 'video' || !uploadedVideo) {
    return;
  }

  console.log(`[PeakAnalysis] Starting frame analysis for side: ${targetSide}, duration: ${durationSec}s`);
  
  state.isExportingFrameByFrame = true;
  if (updateRecordButtonUIFn) {
    updateRecordButtonUIFn();
  }

  uploadedVideo.pause();

  const wasLooping = uploadedVideo.loop;
  const wasPlaybackRate = uploadedVideo.playbackRate;

  uploadedVideo.loop = false;
  uploadedVideo.playbackRate = 1.0;

  if (showAnalysisProgressOverlayFn) {
    showAnalysisProgressOverlayFn(0);
  }

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
    state.squatPeaks.maxKneeBowL = 0;
    state.squatPeaks.maxKneeBowR = 0;
    state.squatPeaks.varusFirstTimestamp = null;
    state.squatPeaks.varusPeakTimestamp = null;
    state.squatPeaks.varusPeakScore = 0;
  }

  const fps = 10;
  const step = 1 / fps;
  let currentTime = 0;

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

  try {
    const poseModel = getPoseModelFn ? getPoseModelFn() : null;
    while (currentTime <= durationSec && state.isExportingFrameByFrame) {
      await seekVideoTo(currentTime);

      state.latestPoseResults = null;
      state.latestHandResults = null;

      if (poseModel) {
        try {
          await poseModel.send({ image: uploadedVideo });
        } catch (err) {
          console.warn(`[PeakAnalysis] MediaPipe parsing error at t=${currentTime.toFixed(2)}s:`, err);
        }
      }

      const progressPercent = Math.min(100, (currentTime / durationSec) * 100);
      if (showAnalysisProgressOverlayFn) {
        showAnalysisProgressOverlayFn(progressPercent);
      }
      if (statusElement) {
        statusElement.textContent = `⚙️ Parsing joint coordinates... ${progressPercent.toFixed(0)}%`;
      }

      currentTime += step;
    }

    if (currentTime - step < durationSec && state.isExportingFrameByFrame && poseModel) {
      await seekVideoTo(durationSec);
      state.latestPoseResults = null;
      try {
        await poseModel.send({ image: uploadedVideo });
      } catch (e) {}
    }

    if (state.isExportingFrameByFrame) {
      await seekVideoTo(0);
      
      if (hideAnalysisProgressOverlayFn) {
        hideAnalysisProgressOverlayFn();
      }
      state.isExportingFrameByFrame = false;
      if (updateRecordButtonUIFn) {
        updateRecordButtonUIFn();
      }

      await autoSyncToActiveProfile();

      updateSquatSideUI();
      updateSquatDashboardOffline();

      uploadedVideo.loop = wasLooping;
      uploadedVideo.playbackRate = wasPlaybackRate;
      
      uploadedVideo.play().catch(err => console.error("[PeakAnalysis] Play resume failed:", err));
      
      if (statusElement) {
        statusElement.textContent = "✅ Video import & peak analysis complete! Peak mobility stats have been updated.";
      }
    }
  } catch (err) {
    console.error("[PeakAnalysis] Background scan failed:", err);
    if (statusElement) {
      statusElement.textContent = "❌ Biomechanical background scan failed.";
    }
    if (hideAnalysisProgressOverlayFn) {
      hideAnalysisProgressOverlayFn();
    }
    state.isExportingFrameByFrame = false;
    if (updateRecordButtonUIFn) {
      updateRecordButtonUIFn();
    }
    
    uploadedVideo.loop = wasLooping;
    uploadedVideo.playbackRate = wasPlaybackRate;
    uploadedVideo.play().catch(e => {});
  }
}

let drawFrameCallback = null;

// Bind squat event listeners
export function setupSquatListeners(onPoseResultsCallback, updateDashboardOfflineCallback) {
  drawFrameCallback = onPoseResultsCallback;

  if (btnSquatSideLeft) {
    btnSquatSideLeft.addEventListener('click', () => {
      state.squatTestingSide = 'left';
      updateSquatSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnSquatSideRight) {
    btnSquatSideRight.addEventListener('click', () => {
      state.squatTestingSide = 'right';
      updateSquatSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnSquatSideFrontal) {
    btnSquatSideFrontal.addEventListener('click', () => {
      state.squatTestingSide = 'frontal';
      updateSquatSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnSaveSquatPeaks) {
    btnSaveSquatPeaks.addEventListener('click', async () => {
      const isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;
      
      if (isWebcamLive) {
        if (!state.isRecording) {
          state.isRecordingAssessment = true;
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
            state.squatPeaks.maxKneeBowL = 0;
            state.squatPeaks.maxKneeBowR = 0;
            state.squatPeaks.varusFirstTimestamp = null;
            state.squatPeaks.varusPeakTimestamp = null;
            state.squatPeaks.varusPeakScore = 0;
          }
          if (startVideoRecordingFn) {
            startVideoRecordingFn();
          }
          
          btnSaveSquatPeaks.innerHTML = `<span class="recording-dot"></span> 🛑 Stop & Save Assessment Video`;
          btnSaveSquatPeaks.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
          btnSaveSquatPeaks.style.borderColor = 'rgba(239, 68, 68, 0.4)';
          btnSaveSquatPeaks.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.6)';
          btnSaveSquatPeaks.classList.add('recording-pulse');
          
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
          state.isRecordingAssessment = false;
          btnSaveSquatPeaks.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
            Record Movement
          `;
          btnSaveSquatPeaks.style.background = 'linear-gradient(135deg, #BA0C2F, #8A0824)';
          btnSaveSquatPeaks.style.borderColor = 'rgba(186, 12, 47, 0.4)';
          btnSaveSquatPeaks.style.boxShadow = 'none';
          btnSaveSquatPeaks.classList.remove('recording-pulse');
          
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

          if (stopVideoRecordingFn) {
            stopVideoRecordingFn();
          }

          if (state.activeProfileId) {
            try {
              await autoSyncToActiveProfile(true);
              if (statusElement) {
                statusElement.textContent = `💾 Peak mobility metrics for "${activeProfileName}" successfully saved to portfolio!`;
              }
              alert(`Overhead squat peaks saved and synchronized to ${activeProfileName}'s profile successfully!`);
              // openProfileDetailsModal(state.activeProfileId);
            } catch (err) {
              console.error("Failed to sync squat peaks on recording stop:", err);
              alert("Could not sync squat peaks to profile. See developer console for details.");
            }
          } else {
            alert("No active profile loaded. Recording saved as guest.");
          }
          return;
        }
      }

      const peaks = state.squatPeaks;
      if (!peaks || (peaks.kneeL === 0 && peaks.kneeR === 0 && peaks.hipL === 0 && peaks.hipR === 0 && peaks.ankleL === 0 && peaks.ankleR === 0)) {
        alert("No peak mobility metrics recorded yet. Please perform an overhead squat test first!");
        return;
      }

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
        if (state.activeProfileId) {
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
          await autoSyncToActiveProfile(true);
          
          if (statusElement) {
            statusElement.textContent = `💾 Peak mobility metrics for "${label}" successfully saved to portfolio!`;
          }
          alert(`Peak mobility metrics saved successfully for ${activeProfileName}!`);
          // openProfileDetailsModal(state.activeProfileId);
        } else {
          alert("You are currently in Guest Mode. To save these peak mobility scores to a player portfolio, please select or create a profile first, then click Save Peaks to Portfolio again.");
        }
      } catch (err) {
        console.error("Failed to save squat peak snapshot to IndexedDB:", err);
        alert("Could not save squat peaks snapshot. See developer console for errors.");
      }
    });
  }
}
