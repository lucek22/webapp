// =========================================================
// SHOULDER FLEXION CONTROLLER MODULE
// =========================================================

import { state, getCanvasX, snapshotStore } from './helpers.js';
import { autoSyncToActiveProfile, openProfileDetailsModal } from './profileManager.js';

// DOM Elements
const canvasElement = document.getElementById('overlay');
const statusElement = document.getElementById('status');
const uploadedVideo = document.getElementById('uploaded-video');

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
const btnSaveShoulderPeaks = document.getElementById('btn-save-shoulder-peaks');

// Active drawing callback placeholder to prevent circular dependencies
let drawFrameCallback = null;

export function registerShoulderDrawCallback(callback) {
  drawFrameCallback = callback;
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
  const origTime = uploadedVideo.currentTime;

  // Render and capture Start Frame
  await seekVideoTo(startFrame.time);
  const startResults = {
    poseLandmarks: startFrame.poseLandmarks,
    image: uploadedVideo
  };
  if (drawFrameCallback) {
    drawFrameCallback(startResults);
  }
  const startImg = canvasElement.toDataURL('image/png');

  // Render and capture End Frame
  await seekVideoTo(endFrame.time);
  const endResults = {
    poseLandmarks: endFrame.poseLandmarks,
    image: uploadedVideo
  };
  if (drawFrameCallback) {
    drawFrameCallback(endResults);
  }
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

// Bind shoulder button event listeners
export function setupShoulderListeners(onPoseResultsCallback, updateDashboardOfflineCallback) {
  registerShoulderDrawCallback(onPoseResultsCallback);

  if (btnShoulderSideLeft) {
    btnShoulderSideLeft.addEventListener('click', () => {
      state.shoulderTestingSide = 'left';
      updateShoulderSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnShoulderSideRight) {
    btnShoulderSideRight.addEventListener('click', () => {
      state.shoulderTestingSide = 'right';
      updateShoulderSideUI();
      if (state.latestPoseResults && drawFrameCallback) {
        drawFrameCallback(state.latestPoseResults);
      }
    });
  }

  if (btnSaveShoulderPeaks) {
    btnSaveShoulderPeaks.addEventListener('click', async () => {
      if (!state.shoulderPeaks) {
        state.shoulderPeaks = getDefaultShoulderPeaks();
      }

      const side = state.shoulderTestingSide || 'left';
      const recordStatus = document.getElementById('shoulder-recording-status');

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
          await autoSyncToActiveProfile(true);
          
          if (recordStatus) {
            recordStatus.textContent = `💾 Shoulder flexion angle of ${Math.round(curAngle)}° for "${label}" successfully saved to portfolio!`;
          }
          alert(`Shoulder flexion angle of ${Math.round(curAngle)}° saved successfully for ${activeProfileName}!`);
          // openProfileDetailsModal(state.activeProfileId);
        } else {
          alert(`You are currently in Guest Mode. Your flexion angle is ${Math.round(curAngle)}°. To save these shoulder flexion scores to a player portfolio, please select or create a profile first, then click Capture Flexion Snapshot again.`);
        }
      } catch (err) {
        console.error("Failed to save shoulder peak snapshot:", err);
        alert("Could not save shoulder flexion snapshot. See developer console for errors.");
      }

      setTimeout(() => {
        if (updateDashboardOfflineCallback) {
          updateDashboardOfflineCallback();
        }
      }, 200);
    });
  }
}
