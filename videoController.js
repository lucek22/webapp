// =========================================================
// VIDEO & UPLOAD CONTROLLER MODULE
// =========================================================

import { state, snapshotStore } from './helpers.js';
import { getActiveProfileName, ensureProfileSessions, loadProfileIntoState } from './profileManager.js';

// DOM Elements
const canvasElement = document.getElementById('overlay');
const statusElement = document.getElementById('status');
const uploadedVideo = document.getElementById('uploaded-video');
const videoSeekbar = document.getElementById('video-seekbar');
const videoTimeDisplay = document.getElementById('video-time-display');
const videoPlayPauseBtn = document.getElementById('video-play-pause-btn');
const videoSpeedBtn = document.getElementById('video-speed-btn');
const videoControlsBar = document.getElementById('video-controls-bar');
const uploadMediaBtn = document.getElementById('btn-upload-media');
const mediaUploadInput = document.getElementById('media-upload-input');

// SVG Assets
const PLAY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const PAUSE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

const SPEED_STEPS = [0.5, 1.0, 1.5, 2.0];

// Local state for CV throttling during seek
let isSeekingInferenceRunning = false;
let pendingInferenceRequest = false;

// Drawing callback references to avoid circular imports
let drawPoseResultsCallback = null;
let drawHandMeshCallback = null;

export function registerVideoCallbacks(poseCb, handCb) {
  drawPoseResultsCallback = poseCb;
  drawHandMeshCallback = handCb;
}

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function updateVideoControlsUI() {
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

export async function renderSingleVideoFrame(poseModel) {
  if (state.uploadedMediaType === 'video') return;
  if (!state.isUploadedMedia || !uploadedVideo) return;
  
  if (isSeekingInferenceRunning) {
    pendingInferenceRequest = true;
    return;
  }
  
  isSeekingInferenceRunning = true;
  pendingInferenceRequest = false;
  
  try {
    if (poseModel) await poseModel.send({ image: uploadedVideo });
    
    if (state.latestPoseResults && drawPoseResultsCallback) {
      drawPoseResultsCallback(state.latestPoseResults);
    }
    if (state.latestHandResults && drawHandMeshCallback) {
      drawHandMeshCallback(state.latestHandResults.multiHandLandmarks, state.latestHandResults.multiHandedness);
    }
  } catch (err) {
    console.error("[RealtimeSeek] Stopped CV Frame Render Error:", err);
  } finally {
    isSeekingInferenceRunning = false;
    if (pendingInferenceRequest) {
      renderSingleVideoFrame(poseModel);
    }
  }
}

export function startVideoRecording(updateRecordButtonUI) {
  if (state.isRecording) return;

  state.recordedChunks = [];
  const fps = 30;
  let stream;
  try {
    stream = canvasElement.captureStream(fps);
  } catch (err) {
    console.error("Canvas captureStream failed:", err);
    alert("Could not start canvas recording. Your browser may not support canvas.captureStream().");
    return;
  }

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
    videoBitsPerSecond: 2500000
  } : {};
  
  try {
    state.mediaRecorder = new MediaRecorder(stream, options);
  } catch (err) {
    console.error("MediaRecorder initialization failed:", err);
    alert("Could not initialize MediaRecorder. Please check browser compatibility.");
    return;
  }

  state.mediaRecorder.onerror = (event) => {
    console.error("[ExportDebug] MediaRecorder error:", event.error);
    if (statusElement) {
      statusElement.textContent = `Recording encoder error: ${event.error.name} - ${event.error.message}`;
    }
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
      if (statusElement) {
        statusElement.textContent = "Export failed: No video data captured.";
      }
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
      const isBlobLike = blobToDownload && typeof blobToDownload.slice === 'function' && typeof blobToDownload.size === 'number';
      const safeBlob = isBlobLike ? blobToDownload : new Blob([blobToDownload], { type: fileExt === 'mp4' ? 'video/mp4' : 'video/webm' });
      const url = URL.createObjectURL(safeBlob);
      if (!state.activeProfileId) {
        const a = document.createElement('a');
        a.classList.add('hidden');
        a.href = url;
        const subjectName = getActiveProfileName(false) || "Subject";
        const cleanSubjectName = subjectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        
        if (state.currentMode === 'squat') {
          const side = state.squatTestingSide || 'left';
          a.download = `scarlet_biomechanics_${cleanSubjectName}_${side}_overhead_squat.${fileExt}`;
        } else if (state.currentMode === 'ankledorsi') {
          const side = (state.ankleDorsi && state.ankleDorsi.activeSide) || 'left';
          a.download = `scarlet_biomechanics_${cleanSubjectName}_${side}_tibial_inclination.${fileExt}`;
        } else if (state.currentMode === 'thoracic_extension') {
          a.download = `scarlet_biomechanics_${cleanSubjectName}_thoracic_extension.${fileExt}`;
        } else {
          a.download = `scarlet_biomechanics_${cleanSubjectName}_recording.${fileExt}`;
        }
        
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
        }, 100);
      }

      state.isRecording = false;
      if (updateRecordButtonUI) {
        updateRecordButtonUI();
      }
      
      const sizeMb = (safeBlob.size / (1024 * 1024)).toFixed(2);
      const durationSec = (finalDuration / 1000).toFixed(1);
      const successMsg = state.activeProfileId 
        ? `Video saved to profile successfully! [Duration: ${durationSec}s, Size: ${sizeMb}MB]`
        : `Video exported successfully! [Duration: ${durationSec}s, Size: ${sizeMb}MB, Format: ${fileExt.toUpperCase()}]`;
      console.log(`[ExportDebug] Video save complete. ${successMsg}`);
      if (statusElement) {
        statusElement.textContent = successMsg;
      }

      if (state.activeProfileId) {
        saveVideoToActiveProfile(safeBlob, fileExt, finalDuration);
      } else {
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
        }, 1000);
      }
    }
  };

  state.isRecording = true;
  state.recordingStartTime = Date.now();
  state.mediaRecorder.start();
  if (updateRecordButtonUI) {
    updateRecordButtonUI();
  }
  if (statusElement) {
    statusElement.textContent = "Video recording in progress... Click the red button to stop and save.";
  }
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

  state.isRecordingPlayLoop = false;
  state.isExportingFrameByFrame = false;
  state.exportFramesData = [];

  hideExportProgressOverlay();

  const ctx = canvasElement.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  }

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
        const side = state.shoulderTestingSide || 'left';
        labelPrefix = side === 'left' ? "Left Shoulder Flexion" : "Right Shoulder Flexion";
      } else if (state.currentMode === 'shoulder_rotation') {
        const side = state.shoulderRotationTestingSide || 'left';
        labelPrefix = side === 'left' ? "Left Shoulder Rotation" : "Right Shoulder Rotation";
      } else if (state.currentMode === 'hip_rotation') {
        const side = state.hipRotationTestingSide || 'left';
        labelPrefix = side === 'left' ? "Left Hip Rotation" : "Right Hip Rotation";
      } else if (state.currentMode === 'ankledorsi') {
        const side = (state.ankleDorsi && state.ankleDorsi.activeSide) || 'left';
        labelPrefix = side === 'left' ? "Left Tibial Inclination" : "Right Tibial Inclination";
      } else if (state.currentMode === 'thoracic_extension') {
        labelPrefix = "Thoracic Extension";
      }

      const videoEntry = {
        id: Date.now(),
        name: `${labelPrefix} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`,
        blob: blobToDownload,
        timestamp: Date.now(),
        duration: (finalDuration / 1000),
        fileExt: fileExt
      };

      profile.videos.push(videoEntry);
      state.videos = profile.videos;

      const profileMigrated = ensureProfileSessions(profile);
      const activeSessionId = state.activeSessionId || profileMigrated.activeSessionId || (profileMigrated.sessions && profileMigrated.sessions[0] ? profileMigrated.sessions[0].id : null);
      if (activeSessionId) {
        const activeSession = profileMigrated.sessions.find(s => String(s.id) === String(activeSessionId));
        if (activeSession) {
          // --- PREVENT RACE CONDITIONS AND CLOBBERING DURING ASYNC VIDEO SAVE ---
          // Ensure all active peak angles and calculated metrics currently in state are synced 
          // to this active session before we persist it back to the database.
          if (state.shoulderRotation !== undefined) {
            activeSession.shoulderRotation = state.shoulderRotation ? JSON.parse(JSON.stringify(state.shoulderRotation)) : null;
            profileMigrated.shoulderRotation = activeSession.shoulderRotation;
          }
          if (state.hipRotation !== undefined) {
            activeSession.hipRotation = state.hipRotation ? JSON.parse(JSON.stringify(state.hipRotation)) : null;
            profileMigrated.hipRotation = activeSession.hipRotation;
          }
          if (state.squatPeaks !== undefined) {
            activeSession.squatPeaks = state.squatPeaks ? JSON.parse(JSON.stringify(state.squatPeaks)) : null;
            profileMigrated.squatPeaks = activeSession.squatPeaks;
          }
          if (state.ankleDorsi && state.ankleDorsi.peaks !== undefined) {
            activeSession.ankleDorsiPeaks = state.ankleDorsi.peaks ? JSON.parse(JSON.stringify(state.ankleDorsi.peaks)) : null;
            profileMigrated.ankleDorsiPeaks = activeSession.ankleDorsiPeaks;
          }
          if (state.thoracicExtension !== undefined) {
            activeSession.thoracicExtension = state.thoracicExtension ? JSON.parse(JSON.stringify(state.thoracicExtension)) : null;
            profileMigrated.thoracicExtension = activeSession.thoracicExtension;
          }
          if (state.imageThoracicExtension !== undefined) {
            activeSession.imageThoracicExtension = state.imageThoracicExtension;
            profileMigrated.imageThoracicExtension = state.imageThoracicExtension;
          }
          if (state.imageAnkleDorsi !== undefined) {
            activeSession.imageAnkleDorsi = state.imageAnkleDorsi;
            profileMigrated.imageAnkleDorsi = state.imageAnkleDorsi;
          }
          if (state.shoulderPeaks !== undefined) {
            activeSession.shoulderPeaks = state.shoulderPeaks ? JSON.parse(JSON.stringify(state.shoulderPeaks)) : null;
            profileMigrated.shoulderPeaks = activeSession.shoulderPeaks;
          }
          if (state.imageHipRotationL !== undefined) {
            activeSession.imageHipRotationL = state.imageHipRotationL;
            profileMigrated.imageHipRotationL = state.imageHipRotationL;
          }
          if (state.imageHipRotationR !== undefined) {
            activeSession.imageHipRotationR = state.imageHipRotationR;
            profileMigrated.imageHipRotationR = state.imageHipRotationR;
          }
          if (state.imageShoulderRotationL !== undefined) {
            activeSession.imageShoulderRotationL = state.imageShoulderRotationL;
            profileMigrated.imageShoulderRotationL = state.imageShoulderRotationL;
          }
          if (state.imageShoulderRotationR !== undefined) {
            activeSession.imageShoulderRotationR = state.imageShoulderRotationR;
            profileMigrated.imageShoulderRotationR = state.imageShoulderRotationR;
          }
          if (state.imageSquatL !== undefined) {
            activeSession.imageSquatL = state.imageSquatL;
            profileMigrated.imageSquatL = state.imageSquatL;
          }
          if (state.imageSquatR !== undefined) {
            activeSession.imageSquatR = state.imageSquatR;
            profileMigrated.imageSquatR = state.imageSquatR;
          }
          if (state.imageSquatFrontal !== undefined) {
            activeSession.imageSquatFrontal = state.imageSquatFrontal;
            profileMigrated.imageSquatFrontal = state.imageSquatFrontal;
          }
          if (state.imageShoulderLStart !== undefined) {
            activeSession.imageShoulderLStart = state.imageShoulderLStart;
            profileMigrated.imageShoulderLStart = state.imageShoulderLStart;
          }
          if (state.imageShoulderLEnd !== undefined) {
            activeSession.imageShoulderLEnd = state.imageShoulderLEnd;
            profileMigrated.imageShoulderLEnd = state.imageShoulderLEnd;
          }
          if (state.imageShoulderRStart !== undefined) {
            activeSession.imageShoulderRStart = state.imageShoulderRStart;
            profileMigrated.imageShoulderRStart = state.imageShoulderRStart;
          }
          if (state.imageShoulderREnd !== undefined) {
            activeSession.imageShoulderREnd = state.imageShoulderREnd;
            profileMigrated.imageShoulderREnd = state.imageShoulderREnd;
          }
          if (state.thoracicExtension !== undefined) {
            activeSession.thoracicExtension = state.thoracicExtension ? JSON.parse(JSON.stringify(state.thoracicExtension)) : null;
            profileMigrated.thoracicExtension = activeSession.thoracicExtension;
          }
          if (state.imageThoracicExtension !== undefined) {
            activeSession.imageThoracicExtension = state.imageThoracicExtension;
            profileMigrated.imageThoracicExtension = state.imageThoracicExtension;
          }

          if (state.currentMode === 'squat') {
            if (state.squatTestingSide === 'left') {
              activeSession.videoSquatL = videoEntry;
              state.videoSquatL = videoEntry;
            } else if (state.squatTestingSide === 'right') {
              activeSession.videoSquatR = videoEntry;
              state.videoSquatR = videoEntry;
            } else if (state.squatTestingSide === 'frontal') {
              activeSession.videoSquatFrontal = videoEntry;
              state.videoSquatFrontal = videoEntry;
            }
          } else if (state.currentMode === 'shoulder_flexion') {
            const side = state.shoulderTestingSide || 'left';
            if (side === 'left') {
              activeSession.videoShoulderL = videoEntry;
              state.videoShoulderL = videoEntry;
            } else {
              activeSession.videoShoulderR = videoEntry;
              state.videoShoulderR = videoEntry;
            }
          } else if (state.currentMode === 'shoulder_rotation') {
            const side = state.shoulderRotationTestingSide || 'left';
            if (side === 'left') {
              activeSession.videoShoulderRotationL = videoEntry;
              state.videoShoulderRotationL = videoEntry;
              activeSession.imageShoulderRotationL = null;
              state.imageShoulderRotationL = null;
            } else {
              activeSession.videoShoulderRotationR = videoEntry;
              state.videoShoulderRotationR = videoEntry;
              activeSession.imageShoulderRotationR = null;
              state.imageShoulderRotationR = null;
            }
          } else if (state.currentMode === 'hip_rotation') {
            const side = state.hipRotationTestingSide || 'left';
            if (side === 'left') {
              activeSession.videoHipRotationL = videoEntry;
              state.videoHipRotationL = videoEntry;
              activeSession.imageHipRotationL = null;
              state.imageHipRotationL = null;
            } else {
              activeSession.videoHipRotationR = videoEntry;
              state.videoHipRotationR = videoEntry;
              activeSession.imageHipRotationR = null;
              state.imageHipRotationR = null;
            }
          } else if (state.currentMode === 'ankledorsi') {
            const side = (state.ankleDorsi && state.ankleDorsi.activeSide) || 'left';
            if (side === 'left') {
              activeSession.videoAnkleDorsiL = videoEntry;
              state.videoAnkleDorsiL = videoEntry;
            } else {
              activeSession.videoAnkleDorsiR = videoEntry;
              state.videoAnkleDorsiR = videoEntry;
            }
          } else if (state.currentMode === 'thoracic_extension') {
            activeSession.videoThoracicExtension = videoEntry;
            state.videoThoracicExtension = videoEntry;
          }
        }
      }

      await snapshotStore.saveProfile(profileMigrated);
      state.allProfiles = await snapshotStore.getAllProfiles();
      
      if (state.activeProfileId === profile.id) {
        await loadProfileIntoState(profile.id);
      }
      console.log(`[VideoSave] Successfully auto-archived WebM/MP4 session capture inside IndexedDB.`);
    }
  } catch (err) {
    console.error("[VideoSave] Failed to save video to active profile:", err);
  }
}

export async function saveImportedVideoToProfile(file, target, durationSec) {
  try {
    if (!state.activeProfileId) return null;
    const profile = await snapshotStore.getProfile(state.activeProfileId);
    if (!profile) return null;

    profile.videos = profile.videos || [];
    
    let labelPrefix = "Imported Video";
    if (target === 'squat-l') labelPrefix = "Left Overhead Squat";
    else if (target === 'squat-r') labelPrefix = "Right Overhead Squat";
    else if (target === 'squat-frontal') labelPrefix = "Frontal Overhead Squat";
    else if (target === 'shoulder-l') labelPrefix = "Left Shoulder Flexion";
    else if (target === 'shoulder-r') labelPrefix = "Right Shoulder Flexion";
    else if (target === 'shoulder-rotation-l') labelPrefix = "Left Shoulder Rotation";
    else if (target === 'shoulder-rotation-r') labelPrefix = "Right Shoulder Rotation";
    else if (target === 'hip-rotation-l') labelPrefix = "Left Hip Rotation";
    else if (target === 'hip-rotation-r') labelPrefix = "Right Hip Rotation";
    else if (target === 'playlist') labelPrefix = "Imported Recording";

    const fileExt = file.name.split('.').pop() || 'mp4';

    const videoEntry = {
      id: Date.now(),
      name: `${labelPrefix} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`,
      blob: file,
      timestamp: Date.now(),
      duration: durationSec,
      fileExt: fileExt
    };

    profile.videos.push(videoEntry);
    state.videos = profile.videos;

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
        } else if (target === 'shoulder-l') {
          activeSession.videoShoulderL = videoEntry;
          state.videoShoulderL = videoEntry;
        } else if (target === 'shoulder-r') {
          activeSession.videoShoulderR = videoEntry;
          state.videoShoulderR = videoEntry;
        } else if (target === 'shoulder-rotation-l') {
          activeSession.videoShoulderRotationL = videoEntry;
          state.videoShoulderRotationL = videoEntry;
          activeSession.imageShoulderRotationL = null;
          state.imageShoulderRotationL = null;
        } else if (target === 'shoulder-rotation-r') {
          activeSession.videoShoulderRotationR = videoEntry;
          state.videoShoulderRotationR = videoEntry;
          activeSession.imageShoulderRotationR = null;
          state.imageShoulderRotationR = null;
        } else if (target === 'hip-rotation-l') {
          activeSession.videoHipRotationL = videoEntry;
          state.videoHipRotationL = videoEntry;
          activeSession.imageHipRotationL = null;
          state.imageHipRotationL = null;
        } else if (target === 'hip-rotation-r') {
          activeSession.videoHipRotationR = videoEntry;
          state.videoHipRotationR = videoEntry;
          activeSession.imageHipRotationR = null;
          state.imageHipRotationR = null;
        }
      }
    }

    await snapshotStore.saveProfile(profileMigrated);
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
    overlay.className = 'export-progress-overlay';
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
        <div class="export-progress-title">Compiling High-Fidelity Video</div>
        <div class="export-progress-subtitle">Encoding biomechanical overlays...</div>
        <div class="export-progress-bar-container">
          <div class="export-progress-bar-fill" id="export-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="export-progress-text" id="export-progress-text">0% Completed</div>
        <div class="export-progress-warning">
          Please keep this tab open and active. Navigating away or backgrounding this browser window can cause WebGL canvas throttling and corrupt video compilation.
        </div>
      </div>
    `;
    viewport.appendChild(overlay);
  }

  const fill = document.getElementById('export-progress-fill');
  const text = document.getElementById('export-progress-text');
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${Math.round(percent)}% Completed`;
}

export function hideExportProgressOverlay() {
  const overlay = document.getElementById('export-progress-overlay');
  if (overlay) {
    overlay.remove();
  }
}

export function toggleVideoRecording() {
  if (state.isExportingFrameByFrame) {
    state.isExportingFrameByFrame = false;
    hideExportProgressOverlay();
    if (statusElement) {
      statusElement.textContent = "Export pre-processing cancelled.";
    }
    
    if (state.isUploadedMedia && state.uploadedMediaType === 'video' && uploadedVideo) {
      if (state.wasLooping !== undefined) uploadedVideo.loop = state.wasLooping;
      if (state.wasPlaybackRate !== undefined) uploadedVideo.playbackRate = state.wasPlaybackRate;
      if (videoControlsBar) {
        videoControlsBar.classList.remove('hidden');
      }
    }
  }
}

// Bind custom Buckeye floating playbar control hooks
export function setupVideoControls(poseModel, onPoseResults, drawHandMesh) {
  registerVideoCallbacks(onPoseResults, drawHandMesh);

  if (uploadedVideo) {
    uploadedVideo.addEventListener('play', () => {
      if (videoPlayPauseBtn) videoPlayPauseBtn.innerHTML = PAUSE_SVG;
    });

    uploadedVideo.addEventListener('pause', () => {
      if (videoPlayPauseBtn) videoPlayPauseBtn.innerHTML = PLAY_SVG;
    });

    uploadedVideo.addEventListener('timeupdate', () => {
      updateVideoControlsUI();
    });

    uploadedVideo.addEventListener('durationchange', () => {
      updateVideoControlsUI();
    });

    uploadedVideo.addEventListener('seeked', () => {
      if (uploadedVideo.paused && !state.isExportingFrameByFrame && !state.isRecordingPlayLoop && !state.isRecording) {
        renderSingleVideoFrame(poseModel);
      }
    });
  }

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

  if (videoSpeedBtn) {
    videoSpeedBtn.addEventListener('click', () => {
      if (!uploadedVideo) return;
      const currentRate = uploadedVideo.playbackRate;
      
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
}
export { PLAY_SVG, PAUSE_SVG };
