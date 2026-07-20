// =========================================================
// THORACIC EXTENSION CONTROLLER MODULE
// =========================================================

import { state, getCanvasX, snapshotStore } from './helpers.js';
import { autoSyncToActiveProfile } from './profileManager.js';
import { startVideoRecording, stopVideoRecording } from './videoController.js';

const thoracicLiveAngle = document.getElementById('thoracic-live-angle');
const thoracicPeakAngle = document.getElementById('thoracic-peak-angle');
const thoracicStatusVal = document.getElementById('thoracic-status-val');
const btnResetThoracic = document.getElementById('btn-reset-thoracic');

let drawFrameCallback = null;

export function registerThoracicDrawCallback(callback) {
  drawFrameCallback = callback;
}

export function calculateThoracicExtensionAngle(landmarks) {
  if (!landmarks) return null;

  const shoulderL = landmarks[11];
  const shoulderR = landmarks[12];
  const hipL = landmarks[23];
  const hipR = landmarks[24];

  if (!shoulderL || !shoulderR || !hipL || !hipR) return null;

  const height = state.canvasHeight || 480;
  const shoulderX = (getCanvasX(shoulderL.x) + getCanvasX(shoulderR.x)) / 2;
  const shoulderY = ((shoulderL.y + shoulderR.y) / 2) * height;
  const hipX = (getCanvasX(hipL.x) + getCanvasX(hipR.x)) / 2;
  const hipY = ((hipL.y + hipR.y) / 2) * height;

  const dx = shoulderX - hipX;
  const dy = shoulderY - hipY;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;

  // Use arc cosine to find the exact deviation from the "Up" vector (0, -1)
  // This guarantees a smooth 0 to 180 range without coordinate wrapping.
  const angleDeg = Math.acos(-dy / len) * (180 / Math.PI);
  
  return parseFloat(angleDeg.toFixed(1));
}

export function processThoracicExtension(landmarks) {
  const currentAngle = calculateThoracicExtensionAngle(landmarks);
  if (currentAngle === null) return;

  // Initialize the state object if it doesn't exist yet
  if (!state.thoracicExtension) {
    state.thoracicExtension = getDefaultThoracicExtension();
  }

  // Always update the live angle
  state.thoracicExtension.liveAngle = currentAngle;

  // Save the highest recorded angle (Peak) only when recording
  if (state.thoracicExtension.isRecording) {
    if (currentAngle > state.thoracicExtension.peakAngle) {
      state.thoracicExtension.peakAngle = currentAngle;
    }
  }

  // Push the updated numbers to the HTML
  updateThoracicExtensionSidebarUI();
}

export function getDefaultThoracicExtension(existing = null) {
  return {
    peakAngle: existing?.peakAngle ?? 0,
    liveAngle: existing?.liveAngle ?? 0,
    isRecording: false
  };
}

export function setThoracicExtensionStatus(message, className = 'text-slate') {
  if (thoracicStatusVal) {
    thoracicStatusVal.textContent = message;
    thoracicStatusVal.className = className;
  }
}

export function updateThoracicExtensionSidebarUI() {
  const p = state.thoracicExtension || getDefaultThoracicExtension();
  if (thoracicLiveAngle) {
    thoracicLiveAngle.textContent = p.isRecording && p.liveAngle ? `${Math.round(p.liveAngle)}°` : '--';
  }
  if (thoracicPeakAngle) {
    thoracicPeakAngle.textContent = p.peakAngle ? `${Math.round(p.peakAngle)}°` : '--';
  }
}

export async function resetThoracicExtensionUI() {
  state.thoracicExtension = getDefaultThoracicExtension();
  
  const btnSaveThoracic = document.getElementById('btn-save-thoracic-results');
  if (btnSaveThoracic) {
    btnSaveThoracic.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
      Capture Thoracic Snapshot
    `;
    btnSaveThoracic.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  }

  if (state.activeProfileId) {
    await autoSyncToActiveProfile(true);
  }
  updateThoracicExtensionSidebarUI();
  setThoracicExtensionStatus('Awaiting Subject');
}

export function setupThoracicExtensionListeners(onPoseResultsCallback) {
  registerThoracicDrawCallback(onPoseResultsCallback);

  // 1. Reset button listener
  if (btnResetThoracic) {
    btnResetThoracic.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all peak angle metrics?')) {
        await resetThoracicExtensionUI();
        if (state.latestPoseResults && drawFrameCallback) {
          drawFrameCallback(state.latestPoseResults);
        }
      }
    });
  }

  // 2. Record/Save Assessment button listener
  const btnSaveThoracic = document.getElementById('btn-save-thoracic-results');
  if (btnSaveThoracic) {
    btnSaveThoracic.addEventListener('click', async () => {
      if (!state.activeProfileId) {
        alert("Please select or load an active athlete profile first.");
        return;
      }

      if (!state.thoracicExtension) {
        state.thoracicExtension = getDefaultThoracicExtension();
      }

      const videoElement = document.getElementById('webcam');
      let isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;

      if (!state.thoracicExtension.isRecording) {
        // --- START RECORDING ---
        if (!isWebcamLive) {
          try {
            setThoracicExtensionStatus('Starting camera...', 'text-slate');
            const { startCamera } = await import('./userController.js');
            await startCamera();
            isWebcamLive = videoElement && videoElement.srcObject && videoElement.srcObject.active;
          } catch (err) {
            console.error("Auto starting camera failed:", err);
            alert("Failed to start the camera automatically. Please ensure camera access is enabled.");
            setThoracicExtensionStatus('Awaiting Subject', 'text-slate');
            return;
          }
        }

        state.thoracicExtension.isRecording = true;
        state.thoracicExtension.peakAngle = 0;
        state.thoracicExtension.liveAngle = 0;
        
        setThoracicExtensionStatus('Recording Peak Angles...', 'text-amber');
        updateThoracicExtensionSidebarUI();

        if (isWebcamLive && startVideoRecording) {
          startVideoRecording();
        }

        // Add pulse animation styles if not already present
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

        // Update button UI to recording style
        btnSaveThoracic.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg>
          Stop Capture & Save
        `;
        btnSaveThoracic.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        btnSaveThoracic.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        btnSaveThoracic.classList.add('recording-pulse');

      } else {
        // --- STOP RECORDING & SAVE ---
        state.thoracicExtension.isRecording = false;

        if (isWebcamLive && stopVideoRecording) {
          stopVideoRecording();
        }

        // Restore button UI
        btnSaveThoracic.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>
          Capture Thoracic Snapshot
        `;
        btnSaveThoracic.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        btnSaveThoracic.style.borderColor = '';
        btnSaveThoracic.classList.remove('recording-pulse');

        setThoracicExtensionStatus('Tracking Live', 'text-slate');
        updateThoracicExtensionSidebarUI();

        const p = state.thoracicExtension;

        // Check for active profile
        let activeProfileName = "Guest";
        if (state.activeProfileId) {
          try {
            const profile = await snapshotStore.getProfile(state.activeProfileId);
            if (profile) {
              activeProfileName = profile.name;
            }
          } catch (err) {
            console.error("Error fetching active profile for thoracic peak saving:", err);
          }
        }

        const label = state.activeProfileId ? `${activeProfileName} - Thoracic Extension` : "Guest - Thoracic Extension";
        const canvasElement = document.getElementById('main-canvas') || document.getElementById('overlay');

        const snapshotRecord = {
          name: label,
          timestamp: Date.now(),
          image: canvasElement ? canvasElement.toDataURL('image/png') : null,
          metrics: {
            isThoracicExtension: true,
            thoracicExtension: JSON.parse(JSON.stringify(p))
          }
        };

        try {
          if (state.activeProfileId) {
            let profile = await snapshotStore.getProfile(state.activeProfileId);
            if (profile) {
              if (!profile.sessions) profile.sessions = [];
              let session = profile.sessions[profile.sessions.length - 1];
              if (session) {
                session.thoracicExtension = JSON.parse(JSON.stringify(p));
                if (canvasElement) {
                  session.imageThoracicExtension = canvasElement.toDataURL('image/png');
                }
              }
              await snapshotStore.saveProfile(profile);
              
              // Dynamically reload UI
              const { loadProfileIntoState } = await import('./profileManager.js');
              await loadProfileIntoState(profile.id);

              const statusMsg = `💾 Thoracic Extension results successfully recorded to player profile "${profile.name}"!`;
              const statusEl = document.getElementById('status') || document.getElementById('thoracic-status-val');
              if (statusEl) {
                statusEl.textContent = statusMsg;
              }
              console.log(statusMsg);
            }
          } else {
            // In Guest Mode, register in the general store if possible
            await snapshotStore.saveSnapshot(snapshotRecord);
            const statusMsg = "💾 Assessment recorded to general local snapshots successfully!";
            const statusEl = document.getElementById('status') || document.getElementById('thoracic-status-val');
            if (statusEl) {
              statusEl.textContent = statusMsg;
            }
          }
        } catch (err) {
          console.error("Failed to record Thoracic Extension assessment:", err);
        }
      }
    });
  }
}
