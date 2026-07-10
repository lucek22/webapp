// ==========================================
// ANKLE DORSiflexion ROM TRACKER LOGIC
// ==========================================

import { state, snapshotStore } from './helpers.js';

// Extend state with ankle dorsiflexion properties
state.ankleDorsi = {
  activeSide: 'left',       // 'left' or 'right'
  heelLifted: false,        // Real-time heel status
  peaks: {
    shinAngleL: null,       // Peak (maximum) forward shin tilt (Left)
    shinAngleR: null,       // Peak (maximum) forward shin tilt (Right)
  }
};

/**
 * Calculates forward shin tilt angle relative to vertical.
 * 0° means vertical shin. Positive values represent forward knee drive.
 */
export function calculateShinTilt(ankle, knee) {
  if (!ankle || !knee) return 0;
  const dx = knee.x - ankle.x;
  const dy = ankle.y - knee.y; // Upwards dy is positive
  const angleRad = Math.atan2(Math.abs(dx), dy);
  return Math.max(0, angleRad * (180 / Math.PI));
}



/**
 * Main real-time processor for Ankle Dorsiflexion ROM mode.
 * Invoked during the pose results pipeline.
 */
export function processAnkleDorsi(calculated) {
  if (!calculated) return;

  const {
    knee_l, ankle_l,
    knee_r, ankle_r
  } = calculated;

  const side = state.ankleDorsi.activeSide;

  // 1. Calculate live values based on active side
  let liveShinTilt = 0;

  if (side === 'left') {
    if (ankle_l && knee_l) {
      liveShinTilt = calculateShinTilt(ankle_l, knee_l);
    }
  } else {
    if (ankle_r && knee_r) {
      liveShinTilt = calculateShinTilt(ankle_r, knee_r);
    }
  }

  // 2. Retrieve the manually selected heel status
  const isHeelLifted = state.ankleDorsi.heelLifted || false;

  // 3. Update peaks if heel is flat on the floor
  if (!isHeelLifted && liveShinTilt > 0) {
    if (side === 'left') {
      if (state.ankleDorsi.peaks.shinAngleL === null || liveShinTilt > state.ankleDorsi.peaks.shinAngleL) {
        state.ankleDorsi.peaks.shinAngleL = liveShinTilt;
      }
    } else {
      if (state.ankleDorsi.peaks.shinAngleR === null || liveShinTilt > state.ankleDorsi.peaks.shinAngleR) {
        state.ankleDorsi.peaks.shinAngleR = liveShinTilt;
      }
    }
  }

  // 4. Update the live UI displays
  updateDorsiLiveUI(liveShinTilt, isHeelLifted);
}

/**
 * Helper to classify tibial inclination angle
 */
export function getTibialClassification(angle) {
  if (angle === null || angle === undefined) {
    return { label: '--', color: '#a7b1b7' };
  }
  if (angle >= 38) {
    return { label: 'Optimal', color: '#10b981' };
  } else if (angle >= 30) {
    return { label: 'Functional', color: '#fbbf24' };
  } else {
    return { label: 'Restricted', color: '#f87171' };
  }
}

/**
 * Updates all real-time and static values in the Ankle Dorsiflexion UI
 */
export function updateDorsiLiveUI(liveShinTilt = 0, isHeelLifted = false) {
  // Update Live angle values
  const side = state.ankleDorsi.activeSide;
  
  const liveShinLDisp = document.getElementById('dorsi-live-shin-l');
  const liveShinRDisp = document.getElementById('dorsi-live-shin-r');

  if (side === 'left') {
    if (liveShinLDisp) liveShinLDisp.textContent = `${Math.round(liveShinTilt)}°`;
  } else {
    if (liveShinRDisp) liveShinRDisp.textContent = `${Math.round(liveShinTilt)}°`;
  }

  // Update Peak angle values
  const peakShinLDisp = document.getElementById('dorsi-peak-shin-l');
  const peakShinRDisp = document.getElementById('dorsi-peak-shin-r');
  const classShinLDisp = document.getElementById('dorsi-class-shin-l');
  const classShinRDisp = document.getElementById('dorsi-class-shin-r');

  if (peakShinLDisp) {
    if (state.ankleDorsi.peaks.shinAngleL !== null) {
      const angle = state.ankleDorsi.peaks.shinAngleL;
      peakShinLDisp.textContent = `${Math.round(angle)}°`;
      const classification = getTibialClassification(angle);
      peakShinLDisp.style.color = classification.color;
      if (classShinLDisp) {
        classShinLDisp.textContent = classification.label;
        classShinLDisp.style.color = classification.color;
      }
    } else {
      peakShinLDisp.textContent = '0°';
      peakShinLDisp.style.color = '';
      if (classShinLDisp) {
        classShinLDisp.textContent = '--';
        classShinLDisp.style.color = '#a7b1b7';
      }
    }
  }

  if (peakShinRDisp) {
    if (state.ankleDorsi.peaks.shinAngleR !== null) {
      const angle = state.ankleDorsi.peaks.shinAngleR;
      peakShinRDisp.textContent = `${Math.round(angle)}°`;
      const classification = getTibialClassification(angle);
      peakShinRDisp.style.color = classification.color;
      if (classShinRDisp) {
        classShinRDisp.textContent = classification.label;
        classShinRDisp.style.color = classification.color;
      }
    } else {
      peakShinRDisp.textContent = '0°';
      peakShinRDisp.style.color = '';
      if (classShinRDisp) {
        classShinRDisp.textContent = '--';
        classShinRDisp.style.color = '#a7b1b7';
      }
    }
  }

  // Update Heel Position manual toggle selection styles in the UI
  const btnHeelFlat = document.getElementById('btn-heel-flat');
  const btnHeelLifted = document.getElementById('btn-heel-lifted');

  if (btnHeelFlat && btnHeelLifted) {
    if (isHeelLifted) {
      // FLAT button is inactive
      btnHeelFlat.style.background = 'transparent';
      btnHeelFlat.style.color = '#a7b1b7';
      btnHeelFlat.style.boxShadow = 'none';

      // LIFTED button is active (red)
      btnHeelLifted.style.background = '#ef4444';
      btnHeelLifted.style.color = 'white';
      btnHeelLifted.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.4)';
    } else {
      // FLAT button is active (green)
      btnHeelFlat.style.background = '#10b981';
      btnHeelFlat.style.color = 'white';
      btnHeelFlat.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.4)';

      // LIFTED button is inactive
      btnHeelLifted.style.background = 'transparent';
      btnHeelLifted.style.color = '#a7b1b7';
      btnHeelLifted.style.boxShadow = 'none';
    }
  }

  // Update Status Text
  const statusVal = document.getElementById('dorsi-status-val');
  if (statusVal) {
    if (state.latestPoseResults && state.latestPoseResults.poseLandmarks) {
      statusVal.textContent = 'Active Tracking';
      statusVal.className = 'metric-val text-green';
    } else {
      statusVal.textContent = 'Awaiting Subject';
      statusVal.className = 'metric-val text-slate';
    }
  }

  // Update Asymmetry calculation
  updateAsymmetryUI();
}

/**
 * Computes and updates Left/Right forward shin tilt angle asymmetry in the UI
 */
export function updateAsymmetryUI() {
  const shinL = state.ankleDorsi.peaks.shinAngleL;
  const shinR = state.ankleDorsi.peaks.shinAngleR;
  const asymmetryVal = document.getElementById('dorsi-asymmetry-val');

  if (!asymmetryVal) return;

  if (shinL === null || shinR === null) {
    asymmetryVal.textContent = 'None';
    asymmetryVal.style.color = '#10b981';
    return;
  }

  const diff = Math.abs(shinL - shinR);
  
  if (diff === 0) {
    asymmetryVal.textContent = 'Symmetric (0°)';
    asymmetryVal.style.color = '#10b981';
  } else {
    const sideTaller = shinL > shinR ? 'Left' : 'Right';
    
    asymmetryVal.textContent = `${diff.toFixed(1)}° - ${sideTaller} Greater`;
    
    // Clinically, > 5° shin tilt asymmetry is a primary indicator of higher injury risk
    if (diff >= 5.0) {
      asymmetryVal.style.color = '#f87171'; // Red for clinically significant asymmetry
    } else if (diff >= 2.0) {
      asymmetryVal.style.color = '#fbbf24'; // Amber for minor asymmetry
    } else {
      asymmetryVal.style.color = '#10b981'; // Green for symmetric
    }
  }
}

/**
 * Resets all Ankle Dorsiflexion Peak angles and Logged Distances
 */
export function resetAnkleDorsi() {
  state.ankleDorsi.peaks = {
    shinAngleL: null,
    shinAngleR: null
  };

  const peakShinLDisp = document.getElementById('dorsi-peak-shin-l');
  const peakShinRDisp = document.getElementById('dorsi-peak-shin-r');
  const liveShinLDisp = document.getElementById('dorsi-live-shin-l');
  const liveShinRDisp = document.getElementById('dorsi-live-shin-r');

  if (peakShinLDisp) peakShinLDisp.textContent = '0°';
  if (peakShinRDisp) peakShinRDisp.textContent = '0°';
  if (liveShinLDisp) liveShinLDisp.textContent = '0°';
  if (liveShinRDisp) liveShinRDisp.textContent = '0°';

  updateDorsiLiveUI();
}

/**
 * Initializes and binds all UI events for Ankle Dorsiflexion Mode
 */
export function setupAnkleDorsiEvents(onPoseResultsCallback) {
  const btnModeAnkleDorsi = document.getElementById('btn-mode-ankledorsi');
  const btnModePosture = document.getElementById('btn-mode-posture');
  const btnModeSquat = document.getElementById('btn-mode-squat');

  const ankledorsiSidebar = document.getElementById('ankledorsi-sidebar-content');
  const postureSidebar = document.getElementById('posture-sidebar-content');
  const squatSidebar = document.getElementById('squat-sidebar-content');

  // Mode button listener
  if (btnModeAnkleDorsi) {
    btnModeAnkleDorsi.addEventListener('click', () => {
      state.currentMode = 'ankledorsi';
      btnModeAnkleDorsi.classList.add('active');
      if (btnModePosture) btnModePosture.classList.remove('active');
      if (btnModeSquat) btnModeSquat.classList.remove('active');

      if (ankledorsiSidebar) ankledorsiSidebar.classList.remove('hidden');
      if (postureSidebar) postureSidebar.classList.add('hidden');
      if (squatSidebar) squatSidebar.classList.add('hidden');

      if (state.latestPoseResults) {
        onPoseResultsCallback(state.latestPoseResults);
      } else {
        updateDorsiLiveUI();
      }
    });
  }

  // Side Selector toggles
  const btnSideL = document.getElementById('btn-dorsi-side-left');
  const btnSideR = document.getElementById('btn-dorsi-side-right');

  if (btnSideL && btnSideR) {
    btnSideL.addEventListener('click', () => {
      state.ankleDorsi.activeSide = 'left';
      btnSideL.classList.add('active-left');
      btnSideR.classList.remove('active-right');
      updateDorsiLiveUI();
    });

    btnSideR.addEventListener('click', () => {
      state.ankleDorsi.activeSide = 'right';
      btnSideR.classList.add('active-right');
      btnSideL.classList.remove('active-left');
      updateDorsiLiveUI();
    });
  }

  // Heel Status Selector listeners
  const btnHeelFlat = document.getElementById('btn-heel-flat');
  const btnHeelLifted = document.getElementById('btn-heel-lifted');

  if (btnHeelFlat && btnHeelLifted) {
    btnHeelFlat.addEventListener('click', () => {
      state.ankleDorsi.heelLifted = false;
      updateDorsiLiveUI();
    });

    btnHeelLifted.addEventListener('click', () => {
      state.ankleDorsi.heelLifted = true;
      updateDorsiLiveUI();
    });
  }

  // Reset button listener
  const btnReset = document.getElementById('btn-reset-dorsi');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all peak angle metrics?')) {
        resetAnkleDorsi();
      }
    });
  }

  // Record/Save Assessment button listener
  const btnSaveDorsi = document.getElementById('btn-save-dorsi-results');
  if (btnSaveDorsi) {
    btnSaveDorsi.addEventListener('click', async () => {
      const peaks = state.ankleDorsi.peaks;
      if (peaks.shinAngleL === null && peaks.shinAngleR === null) {
        alert("No peak angle metrics have been captured yet. Please perform a lunge with flat heels to capture peak angles!");
        return;
      }

      // Check for active profile
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

      const label = state.activeProfileId ? `${activeProfileName} - Ankle Dorsiflexion` : "Guest - Ankle Dorsiflexion";
      const canvasElement = document.getElementById('main-canvas');

      const snapshotRecord = {
        name: label,
        timestamp: Date.now(),
        image: canvasElement ? canvasElement.toDataURL('image/png') : null,
        metrics: {
          isAnkleDorsi: true,
          ankleDorsiPeaks: JSON.parse(JSON.stringify(state.ankleDorsi.peaks))
        }
      };

      try {
        if (state.activeProfileId) {
          let profile = await snapshotStore.getProfile(state.activeProfileId);
          if (profile) {
            if (!profile.sessions) profile.sessions = [];
            let session = profile.sessions[profile.sessions.length - 1];
            if (session) {
              session.ankleDorsiPeaks = JSON.parse(JSON.stringify(state.ankleDorsi.peaks));
              if (canvasElement) {
                session.imageAnkleDorsi = canvasElement.toDataURL('image/png');
              }
            }
            await snapshotStore.saveProfile(profile);
            alert(`💾 Ankle Dorsiflexion results successfully recorded to player profile "${profile.name}"!`);
          }
        } else {
          // In Guest Mode, register in the general store if possible
          await snapshotStore.saveSnapshot(snapshotRecord);
          alert("💾 Assessment recorded to general local snapshots successfully!");
        }
      } catch (err) {
        console.error("Failed to record Ankle Dorsiflexion assessment:", err);
        alert("Could not save ankle dorsiflexion results. See developer console for errors.");
      }
    });
  }
}
