// ==========================================
// ANKLE DORSiflexion ROM TRACKER LOGIC
// ==========================================

import { state, snapshotStore } from './helpers.js';

// Extend state with ankle dorsiflexion properties
state.ankleDorsi = {
  activeSide: 'left',       // 'left' or 'right'
  heelLifted: false,        // Manual heel lift override status
  autoDetectHeel: true,     // Automatically detect heel lift
  actualHeelLifted: false,  // Evaluated actual heel status (auto or manual)
  heelVisible: true,        // Visibility status of active heel landmark
  isRecording: false,       // Tracking/recording state for peak angles
  neutralAngleL: null,      // Calibrated standing neutral ankle angle (Left)
  neutralAngleR: null,      // Calibrated standing neutral ankle angle (Right)
  neutralFootPitchL: null,  // Calibrated standing neutral foot pitch (Left)
  neutralFootPitchR: null,  // Calibrated standing neutral foot pitch (Right)
  peaks: {
    shinAngleL: null,       // Peak (maximum) forward shin tilt (Left)
    shinAngleR: null,       // Peak (maximum) forward shin tilt (Right)
    ankleDorsiL: null,      // Peak (maximum) ankle joint dorsiflexion (Left)
    ankleDorsiR: null       // Peak (maximum) ankle joint dorsiflexion (Right)
  }
};

/**
 * Calculates forward shin tilt angle relative to vertical.
 * 0° means vertical shin. Positive values represent forward knee drive.
 * Clamped to physiological max of 65° to filter out tracking glitches.
 */
export function calculateShinTilt(ankle, knee) {
  if (!ankle || !knee) return 0;
  const dx = knee.x - ankle.x;
  const dy = ankle.y - knee.y; // Upwards dy is positive
  const angleRad = Math.atan2(Math.abs(dx), dy);
  const angleDeg = angleRad * (180 / Math.PI);
  return Math.min(65, Math.max(0, angleDeg));
}

/**
 * Main real-time processor for Ankle Dorsiflexion ROM mode.
 * Invoked during the pose results pipeline.
 */
export function processAnkleDorsi(calculated) {
  if (!calculated) return;

  const {
    knee_l, ankle_l, ankleAngleL,
    knee_r, ankle_r, ankleAngleR
  } = calculated;

  const side = state.ankleDorsi.activeSide;

  // 1. Calculate live values based on active side
  let liveShinTilt = 0;
  let liveAnkleDorsi = 0;

  if (side === 'left') {
    if (ankle_l && knee_l) {
      liveShinTilt = calculateShinTilt(ankle_l, knee_l);
    }
    if (ankleAngleL !== undefined && ankleAngleL !== null) {
      // Clamp joint angle to physiological limits [70°, 130°] to reject tracking outliers
      const clampedAnkleL = Math.max(70, Math.min(130, ankleAngleL));

      // Dynamic neutral calibration when standing upright (shin tilt < 5°)
      // Must fall in a normal anatomical standing range [100°, 125°]
      if (liveShinTilt < 5 && clampedAnkleL >= 100 && clampedAnkleL <= 125) {
        if (!state.ankleDorsi.neutralAngleL) {
          state.ankleDorsi.neutralAngleL = clampedAnkleL;
        } else {
          // Low-pass exponential filter to smoothly adapt and discard single-frame spikes
          state.ankleDorsi.neutralAngleL = 0.95 * state.ankleDorsi.neutralAngleL + 0.05 * clampedAnkleL;
        }
      }

      const neutralL = state.ankleDorsi.neutralAngleL || 115;
      // Net joint dorsiflexion is the difference from calibrated neutral standing
      liveAnkleDorsi = Math.max(0, neutralL - clampedAnkleL);
      // Clamp ROM to absolute physical limit of 45°
      liveAnkleDorsi = Math.min(45, liveAnkleDorsi);
    }
  } else {
    if (ankle_r && knee_r) {
      liveShinTilt = calculateShinTilt(ankle_r, knee_r);
    }
    if (ankleAngleR !== undefined && ankleAngleR !== null) {
      // Clamp joint angle to physiological limits [70°, 130°] to reject tracking outliers
      const clampedAnkleR = Math.max(70, Math.min(130, ankleAngleR));

      // Dynamic neutral calibration when standing upright (shin tilt < 5°)
      // Must fall in a normal anatomical standing range [100°, 125°]
      if (liveShinTilt < 5 && clampedAnkleR >= 100 && clampedAnkleR <= 125) {
        if (!state.ankleDorsi.neutralAngleR) {
          state.ankleDorsi.neutralAngleR = clampedAnkleR;
        } else {
          // Low-pass exponential filter to smoothly adapt and discard single-frame spikes
          state.ankleDorsi.neutralAngleR = 0.95 * state.ankleDorsi.neutralAngleR + 0.05 * clampedAnkleR;
        }
      }

      const neutralR = state.ankleDorsi.neutralAngleR || 115;
      // Net joint dorsiflexion is the difference from calibrated neutral standing
      liveAnkleDorsi = Math.max(0, neutralR - clampedAnkleR);
      // Clamp ROM to absolute physical limit of 45°
      liveAnkleDorsi = Math.min(45, liveAnkleDorsi);
    }
  }

  // 2. Heel visibility check & auto-detection of heel lift
  const heel = (side === 'left') ? calculated.heel_l : calculated.heel_r;
  const toe = (side === 'left') ? calculated.toe_l : calculated.toe_r;
  const raw_lm = calculated.raw_lm;

  let heelVisible = true;
  if (raw_lm) {
    const heelIndex = (side === 'left') ? 29 : 30;
    const toeIndex = (side === 'left') ? 31 : 32;
    const heelLm = raw_lm[heelIndex];
    const toeLm = raw_lm[toeIndex];
    // Lower visibility threshold to 0.35 to keep tracking active in darker/shaded feet conditions
    if (!heelLm || heelLm.visibility < 0.35 || !toeLm || toeLm.visibility < 0.35) {
      heelVisible = false;
    }
  } else {
    if (!heel || !toe) {
      heelVisible = false;
    }
  }

  // Calculate live foot pitch (angle of foot sole relative to horizontal floor)
  let liveFootPitch = 0;
  if (heel && toe) {
    const dx = toe.x - heel.x;
    const dy = toe.y - heel.y;
    const footLength = Math.hypot(dx, dy);
    if (footLength > 0) {
      const heightDiff = toe.y - heel.y; // positive if heel is higher (y is smaller) than toe
      const angleRatio = heightDiff / footLength;
      liveFootPitch = Math.asin(Math.max(-1, Math.min(1, angleRatio))) * (180 / Math.PI);
    }
  }

  // Dynamic standing neutral foot-pitch calibration (when standing upright with shin tilt < 5° and heel visible)
  if (liveShinTilt < 5 && heelVisible) {
    if (side === 'left') {
      if (state.ankleDorsi.neutralFootPitchL === null || state.ankleDorsi.neutralFootPitchL === undefined) {
        state.ankleDorsi.neutralFootPitchL = liveFootPitch;
      } else {
        // Smooth exponential moving average to filter out posture sway
        state.ankleDorsi.neutralFootPitchL = 0.95 * state.ankleDorsi.neutralFootPitchL + 0.05 * liveFootPitch;
      }
    } else {
      if (state.ankleDorsi.neutralFootPitchR === null || state.ankleDorsi.neutralFootPitchR === undefined) {
        state.ankleDorsi.neutralFootPitchR = liveFootPitch;
      } else {
        state.ankleDorsi.neutralFootPitchR = 0.95 * state.ankleDorsi.neutralFootPitchR + 0.05 * liveFootPitch;
      }
    }
  }

  let actualHeelLifted = false;
  if (!heelVisible) {
    // If heel is not visible, set it as lifted (data not captured)
    actualHeelLifted = true;
  } else if (state.ankleDorsi.autoDetectHeel) {
    const neutralPitch = (side === 'left') ? state.ankleDorsi.neutralFootPitchL : state.ankleDorsi.neutralFootPitchR;
    // Fallback to 10° normal anatomical foot incline if calibration is not yet recorded
    const baselinePitch = (neutralPitch !== null && neutralPitch !== undefined) ? neutralPitch : 10;
    
    // We flag as lifted only when the foot pitch rises by 7.0° or more relative to their flat upright standing baseline
    if (liveFootPitch - baselinePitch > 7.0) {
      actualHeelLifted = true;
    }
  } else {
    // Manual mode
    actualHeelLifted = state.ankleDorsi.heelLifted || false;
  }

  // Update states
  state.ankleDorsi.heelVisible = heelVisible;
  state.ankleDorsi.actualHeelLifted = actualHeelLifted;

  // 3. Update peaks if heel is flat on the floor (not lifted) and recording is active
  if (!actualHeelLifted && state.ankleDorsi.isRecording) {
    if (liveShinTilt > 0) {
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
    if (liveAnkleDorsi > 0) {
      if (side === 'left') {
        if (state.ankleDorsi.peaks.ankleDorsiL === null || liveAnkleDorsi > state.ankleDorsi.peaks.ankleDorsiL) {
          state.ankleDorsi.peaks.ankleDorsiL = liveAnkleDorsi;
        }
      } else {
        if (state.ankleDorsi.peaks.ankleDorsiR === null || liveAnkleDorsi > state.ankleDorsi.peaks.ankleDorsiR) {
          state.ankleDorsi.peaks.ankleDorsiR = liveAnkleDorsi;
        }
      }
    }
  }

  // 4. Update the live UI displays
  updateDorsiLiveUI(liveShinTilt, liveAnkleDorsi, actualHeelLifted);
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
 * Helper to classify ankle dorsiflexion ROM angle
 */
export function getAnkleDorsiClassification(angle) {
  if (angle === null || angle === undefined) {
    return { label: '--', color: '#a7b1b7' };
  }
  if (angle >= 20) {
    return { label: 'Optimal', color: '#10b981' };
  } else if (angle >= 15) {
    return { label: 'Functional', color: '#fbbf24' };
  } else {
    return { label: 'Restricted', color: '#f87171' };
  }
}

/**
 * Updates all real-time and static values in the Ankle Dorsiflexion UI
 */
export function updateDorsiLiveUI(liveShinTilt = 0, liveAnkleDorsi = 0, isHeelLifted = false) {
  // Update Live angle values
  const side = state.ankleDorsi.activeSide;
  
  const liveShinLDisp = document.getElementById('dorsi-live-shin-l');
  const liveShinRDisp = document.getElementById('dorsi-live-shin-r');
  const liveAnkleLDisp = document.getElementById('dorsi-live-ankle-l');
  const liveAnkleRDisp = document.getElementById('dorsi-live-ankle-r');

  if (side === 'left') {
    if (liveShinLDisp) liveShinLDisp.textContent = `${Math.round(liveShinTilt)}°`;
    if (liveAnkleLDisp) liveAnkleLDisp.textContent = `${Math.round(liveAnkleDorsi)}°`;
  } else {
    if (liveShinRDisp) liveShinRDisp.textContent = `${Math.round(liveShinTilt)}°`;
    if (liveAnkleRDisp) liveAnkleRDisp.textContent = `${Math.round(liveAnkleDorsi)}°`;
  }

  // Update Peak Tibial Inclination angle values
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

  // Update Peak Ankle Dorsiflexion angle values
  const peakAnkleLDisp = document.getElementById('dorsi-peak-ankle-l');
  const peakAnkleRDisp = document.getElementById('dorsi-peak-ankle-r');
  const classAnkleLDisp = document.getElementById('dorsi-class-ankle-l');
  const classAnkleRDisp = document.getElementById('dorsi-class-ankle-r');

  if (peakAnkleLDisp) {
    if (state.ankleDorsi.peaks.ankleDorsiL !== null) {
      const angle = state.ankleDorsi.peaks.ankleDorsiL;
      peakAnkleLDisp.textContent = `${Math.round(angle)}°`;
      const classification = getAnkleDorsiClassification(angle);
      peakAnkleLDisp.style.color = classification.color;
      if (classAnkleLDisp) {
        classAnkleLDisp.textContent = classification.label;
        classAnkleLDisp.style.color = classification.color;
      }
    } else {
      peakAnkleLDisp.textContent = '0°';
      peakAnkleLDisp.style.color = '';
      if (classAnkleLDisp) {
        classAnkleLDisp.textContent = '--';
        classAnkleLDisp.style.color = '#a7b1b7';
      }
    }
  }

  if (peakAnkleRDisp) {
    if (state.ankleDorsi.peaks.ankleDorsiR !== null) {
      const angle = state.ankleDorsi.peaks.ankleDorsiR;
      peakAnkleRDisp.textContent = `${Math.round(angle)}°`;
      const classification = getAnkleDorsiClassification(angle);
      peakAnkleRDisp.style.color = classification.color;
      if (classAnkleRDisp) {
        classAnkleRDisp.textContent = classification.label;
        classAnkleRDisp.style.color = classification.color;
      }
    } else {
      peakAnkleRDisp.textContent = '0°';
      peakAnkleRDisp.style.color = '';
      if (classAnkleRDisp) {
        classAnkleRDisp.textContent = '--';
        classAnkleRDisp.style.color = '#a7b1b7';
      }
    }
  }

  // Update Heel Autodetection Toggle selection styles in the UI
  const btnAutoOn = document.getElementById('btn-auto-heel-on');
  const btnAutoOff = document.getElementById('btn-auto-heel-off');
  const isAuto = state.ankleDorsi.autoDetectHeel;

  if (btnAutoOn && btnAutoOff) {
    if (isAuto) {
      // ON is active (cyan)
      btnAutoOn.style.background = '#00e5ff';
      btnAutoOn.style.color = '#0f172a';
      btnAutoOn.style.boxShadow = '0 2px 8px rgba(0, 229, 255, 0.4)';

      // OFF is inactive
      btnAutoOff.style.background = 'transparent';
      btnAutoOff.style.color = '#a7b1b7';
      btnAutoOff.style.boxShadow = 'none';
    } else {
      // ON is inactive
      btnAutoOn.style.background = 'transparent';
      btnAutoOn.style.color = '#a7b1b7';
      btnAutoOn.style.boxShadow = 'none';

      // OFF is active (slate)
      btnAutoOff.style.background = '#475569';
      btnAutoOff.style.color = 'white';
      btnAutoOff.style.boxShadow = '0 2px 8px rgba(71, 85, 105, 0.4)';
    }
  }

  // Update Heel Position manual/auto status and buttons
  const btnHeelFlat = document.getElementById('btn-heel-flat');
  const btnHeelLifted = document.getElementById('btn-heel-lifted');
  const lblHeelStatus = document.getElementById('lbl-heel-status');
  const heelVisible = state.ankleDorsi.heelVisible !== false;

  // Status Label
  if (lblHeelStatus) {
    if (!heelVisible) {
      lblHeelStatus.textContent = '⚠️ NOT VISIBLE';
      lblHeelStatus.style.color = '#ef4444';
    } else if (isAuto) {
      lblHeelStatus.textContent = `AUTO: ${isHeelLifted ? 'LIFTED' : 'FLAT'}`;
      lblHeelStatus.style.color = isHeelLifted ? '#ef4444' : '#10b981';
    } else {
      lblHeelStatus.textContent = `MANUAL: ${isHeelLifted ? 'LIFTED' : 'FLAT'}`;
      lblHeelStatus.style.color = isHeelLifted ? '#ef4444' : '#10b981';
    }
  }

  if (btnHeelFlat && btnHeelLifted) {
    // Styling manual FLAT / LIFTED buttons
    if (isHeelLifted) {
      // FLAT is inactive
      btnHeelFlat.style.background = 'transparent';
      btnHeelFlat.style.color = '#a7b1b7';
      btnHeelFlat.style.boxShadow = 'none';

      // LIFTED is active (red)
      btnHeelLifted.style.background = '#ef4444';
      btnHeelLifted.style.color = 'white';
      btnHeelLifted.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.4)';
    } else {
      // FLAT is active (green)
      btnHeelFlat.style.background = '#10b981';
      btnHeelFlat.style.color = 'white';
      btnHeelFlat.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.4)';

      // LIFTED is inactive
      btnHeelLifted.style.background = 'transparent';
      btnHeelLifted.style.color = '#a7b1b7';
      btnHeelLifted.style.boxShadow = 'none';
    }

    // If auto mode, make the manual buttons look read-only and disable interaction
    if (isAuto) {
      btnHeelFlat.style.opacity = '0.5';
      btnHeelLifted.style.opacity = '0.5';
      btnHeelFlat.style.pointerEvents = 'none';
      btnHeelLifted.style.pointerEvents = 'none';
      btnHeelFlat.style.cursor = 'default';
      btnHeelLifted.style.cursor = 'default';
    } else {
      btnHeelFlat.style.opacity = '1.0';
      btnHeelLifted.style.opacity = '1.0';
      btnHeelFlat.style.pointerEvents = 'auto';
      btnHeelLifted.style.pointerEvents = 'auto';
      btnHeelFlat.style.cursor = 'pointer';
      btnHeelLifted.style.cursor = 'pointer';
    }
  }

  // Update Record/Tracking Toggle button styling
  const btnRecordToggle = document.getElementById('btn-record-dorsi-toggle');
  const dotRecord = document.getElementById('dot-record-dorsi');
  const txtRecord = document.getElementById('txt-record-dorsi');

  if (btnRecordToggle && dotRecord && txtRecord) {
    if (state.ankleDorsi.isRecording) {
      btnRecordToggle.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      txtRecord.textContent = 'Stop Recording';
      dotRecord.classList.add('recording-active-dot');
      btnRecordToggle.style.boxShadow = '0 2px 10px rgba(239, 68, 68, 0.4)';
    } else {
      btnRecordToggle.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      txtRecord.textContent = 'Start Recording';
      dotRecord.classList.remove('recording-active-dot');
      btnRecordToggle.style.boxShadow = '0 2px 10px rgba(16, 185, 129, 0.3)';
    }
  }

  // Update Status Text
  const statusVal = document.getElementById('dorsi-status-val');
  if (statusVal) {
    if (state.latestPoseResults && state.latestPoseResults.poseLandmarks) {
      if (state.ankleDorsi.isRecording) {
        statusVal.textContent = 'Recording Active';
        statusVal.className = 'metric-val text-red';
        statusVal.style.color = '#ef4444';
      } else {
        statusVal.textContent = 'Ready to Record';
        statusVal.className = 'metric-val text-amber';
        statusVal.style.color = '#fbbf24';
      }
    } else {
      statusVal.textContent = 'Awaiting Subject';
      statusVal.className = 'metric-val text-slate';
      statusVal.style.color = '#a7b1b7';
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
    shinAngleR: null,
    ankleDorsiL: null,
    ankleDorsiR: null
  };
  state.ankleDorsi.neutralAngleL = null;
  state.ankleDorsi.neutralAngleR = null;
  state.ankleDorsi.neutralFootPitchL = null;
  state.ankleDorsi.neutralFootPitchR = null;
  state.ankleDorsi.isRecording = false;

  const peakShinLDisp = document.getElementById('dorsi-peak-shin-l');
  const peakShinRDisp = document.getElementById('dorsi-peak-shin-r');
  const peakAnkleLDisp = document.getElementById('dorsi-peak-ankle-l');
  const peakAnkleRDisp = document.getElementById('dorsi-peak-ankle-r');
  const liveShinLDisp = document.getElementById('dorsi-live-shin-l');
  const liveShinRDisp = document.getElementById('dorsi-live-shin-r');
  const liveAnkleLDisp = document.getElementById('dorsi-live-ankle-l');
  const liveAnkleRDisp = document.getElementById('dorsi-live-ankle-r');

  if (peakShinLDisp) peakShinLDisp.textContent = '0°';
  if (peakShinRDisp) peakShinRDisp.textContent = '0°';
  if (peakAnkleLDisp) peakAnkleLDisp.textContent = '0°';
  if (peakAnkleRDisp) peakAnkleRDisp.textContent = '0°';
  if (liveShinLDisp) liveShinLDisp.textContent = '0°';
  if (liveShinRDisp) liveShinRDisp.textContent = '0°';
  if (liveAnkleLDisp) liveAnkleLDisp.textContent = '0°';
  if (liveAnkleRDisp) liveAnkleRDisp.textContent = '0°';

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

  // Heel Autodetection Selector listeners
  const btnAutoHeelOn = document.getElementById('btn-auto-heel-on');
  const btnAutoHeelOff = document.getElementById('btn-auto-heel-off');

  if (btnAutoHeelOn && btnAutoHeelOff) {
    btnAutoHeelOn.addEventListener('click', () => {
      state.ankleDorsi.autoDetectHeel = true;
      updateDorsiLiveUI();
    });

    btnAutoHeelOff.addEventListener('click', () => {
      state.ankleDorsi.autoDetectHeel = false;
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

  // Start/Stop Recording Toggle button listener
  const btnRecordToggle = document.getElementById('btn-record-dorsi-toggle');
  if (btnRecordToggle) {
    btnRecordToggle.addEventListener('click', () => {
      state.ankleDorsi.isRecording = !state.ankleDorsi.isRecording;
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
      if (peaks.shinAngleL === null && peaks.shinAngleR === null && peaks.ankleDorsiL === null && peaks.ankleDorsiR === null) {
        alert("No peak ROM metrics have been captured yet. Please perform a lunge with flat heels to capture peak angles!");
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

      const label = state.activeProfileId ? `${activeProfileName} - Tibial & Ankle ROM` : "Guest - Tibial & Ankle ROM";
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
            alert(`💾 Tibial & Ankle ROM results successfully recorded to player profile "${profile.name}"!`);
          }
        } else {
          // In Guest Mode, register in the general store if possible
          await snapshotStore.saveSnapshot(snapshotRecord);
          alert("💾 Assessment recorded to general local snapshots successfully!");
        }
      } catch (err) {
        console.error("Failed to record Tibial & Ankle ROM assessment:", err);
        alert("Could not save tibial & ankle ROM results. See developer console for errors.");
      }
    });
  }
}
