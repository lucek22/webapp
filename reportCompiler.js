// ==========================================
// REPORT COMPILER: IMAGE SAVING & JSON EXPORTS
// ==========================================
import {
  state,
  snapshotStore,
  getDomMeasurementCm
} from './helpers.js';
import { autoSyncToActiveProfile } from './userController.js';

/**
 * Sanitizes a filename to ensure safe downloading on various OS systems.
 * @param {string} name 
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9\-_\s]/g, '') // remove characters that aren't letters, numbers, spaces, hyphens, or underscores
    .trim()
    .replace(/\s+/g, '-')             // turn multiple spaces/whitespace into a single hyphen
    .toLowerCase();
}

/**
 * Triggers a download of a Base64/DataURL image.
 * @param {string} dataUrl 
 * @param {string} filename 
 */
export function downloadSnapshotImage(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  const safeName = sanitizeFilename(filename) || 'biomechanical-snapshot';
  link.download = `${safeName}-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Triggers a download of an individual snapshot record or combined report in JSON format.
 * @param {Object} snapshot The complete snapshot object retrieved from IndexedDB
 */
export function downloadIndividualSnapshotJson(snapshot) {
  if (!snapshot) return;

  const jsonStr = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  
  const baseName = snapshot.name || 'biomechanical-snapshot';
  const safeName = sanitizeFilename(baseName) || 'biomechanical-snapshot';
  const filename = `${safeName}-${snapshot.timestamp || Date.now()}.json`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


// ==========================================
// BIND SAVE & EXPORT ACTION CONTROLS
// ==========================================

export function setupReportCompiler({ canvasElement, frozenFrameCanvas, statusElement, renderGallery, resetAndResume }) {
  // 1. Download Current Frozen Snapshot as PNG
  const btnDlPng = document.getElementById('btn-dl-png');
  if (btnDlPng) {
    btnDlPng.addEventListener('click', () => {
      if (!state.isSnapshotFrozen) return;
      const nameInput = document.getElementById('snapshot-name-input');
      const label = nameInput ? nameInput.value.trim() : 'biomechanical-snapshot';
      const dataUrl = frozenFrameCanvas.toDataURL('image/png');
      downloadSnapshotImage(dataUrl, label);
    });
  }

  // 2. Save Current Frozen Snapshot & Biometric Metrics directly to Active Player Profile
  const btnSaveGallery = document.getElementById('btn-save-gallery');
  if (btnSaveGallery) {
    btnSaveGallery.addEventListener('click', () => {
      if (!state.isSnapshotFrozen || !state.frozenMetrics) return;

      if (!state.activeProfileId) {
        alert("You are currently in Guest Mode. Please select or create a player profile first to save this snapshot to their session history!");
        return;
      }

      const nameInput = document.getElementById('snapshot-name-input');
      const label = nameInput ? nameInput.value.trim() : 'Posture Scan';

      // Retrieve active DOM pinch/span measurements in raw cm values
      const pinch_l_cm = getDomMeasurementCm('val-pinch-l');
      const pinch_r_cm = getDomMeasurementCm('val-pinch-r');
      const span_l_cm = getDomMeasurementCm('val-span-l');
      const span_r_cm = getDomMeasurementCm('val-span-r');

      const metricsToSave = {
        ...state.frozenMetrics,
        pinch_l_cm,
        pinch_r_cm,
        span_l_cm,
        span_r_cm
      };

      const capturedImg = frozenFrameCanvas.toDataURL('image/png');
      if (state.currentMode === 'squat') {
        if (state.squatTestingSide === 'left') {
          state.imageSquatL = capturedImg;
        } else if (state.squatTestingSide === 'right') {
          state.imageSquatR = capturedImg;
        } else {
          state.imageSquatFrontal = capturedImg;
        }
      } else {
        const poseName = state.frozenMetrics.pose || "A-Pose";
        if (poseName === "A-Pose") {
          state.metricsA = JSON.parse(JSON.stringify(metricsToSave));
          state.imageA = capturedImg;
        } else if (poseName === "T-Pose") {
          state.metricsT = JSON.parse(JSON.stringify(metricsToSave));
          state.imageT = capturedImg;
        } else if (poseName === "Overhead Reach" || poseName === "Overhead Pose") {
          state.metricsOverhead = JSON.parse(JSON.stringify(metricsToSave));
          state.imageOverhead = capturedImg;
        }
      }

      autoSyncToActiveProfile();

      statusElement.textContent = `💾 Snapshot "${label}" successfully saved to profile portfolio!`;
      if (typeof resetAndResume === 'function') {
        resetAndResume();
      }
    });
  }

  // 3. Export All Saved Gallery Snapshots & Reports to a single JSON File
  const btnExportJson = document.getElementById('btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => {
      snapshotStore.getAll()
        .then(snapshots => {
          if (!snapshots || snapshots.length === 0) {
            alert("No snapshots saved in your gallery to export yet! Capture and save a snapshot first.");
            return;
          }

          // Stringify snapshot array nicely formatted
          const jsonStr = JSON.stringify(snapshots, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          
          // Formulate a clean filename incorporating the subject's name if specified
          let subjectName = '';
          if (state.activeProfileId && state.allProfiles) {
            const activeProfile = state.allProfiles.find(p => p.id === state.activeProfileId);
            if (activeProfile) {
              subjectName = activeProfile.name;
            }
          } else {
            const subjectInput = document.getElementById('subject-name-input');
            if (subjectInput && subjectInput.value.trim()) {
              subjectName = subjectInput.value.trim();
            }
          }
          let baseFilename = 'biomechanical-gallery-export';
          if (subjectName) {
            baseFilename = `${sanitizeFilename(subjectName)}-gallery-export`;
          }

          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${baseFilename}-${Date.now()}.json`;
          
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          statusElement.textContent = "📤 Exported biomechanical gallery database to JSON file successfully!";
        })
        .catch(err => {
          console.error("JSON Database Export failed:", err);
          alert("Failed to export database to JSON. Check the browser console.");
        });
    });
  }
}

export function compileAndDownloadCombinedSession() {
  let subjectName = 'Anonymous Subject';
  if (state.activeProfileId && state.allProfiles) {
    const activeProfile = state.allProfiles.find(p => p.id === state.activeProfileId);
    if (activeProfile) {
      subjectName = activeProfile.name;
    }
  } else {
    const subjectInput = document.getElementById('subject-name-input');
    if (subjectInput && subjectInput.value.trim()) {
      subjectName = subjectInput.value.trim();
    }
  }
  const sessionId = `session-${state.currentGroupId || Date.now()}`;
  const timestamp = Date.now();
  
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  const formattedDate = new Date().toLocaleDateString('en-US', options);

  const mA = state.metricsA || {};
  const mT = state.metricsT || {};
  const mO = state.metricsOverhead || {};

  const report = {
    subjectName: subjectName,
    sessionId: sessionId,
    timestamp: timestamp,
    formattedDate: formattedDate,
    pixelsPerCm: state.pixelsPerCm,
    summary: {
      skeletal_height_cm: mA.skeletal_height ? Number(mA.skeletal_height.toFixed(1)) : null,
      wingspan_cm: mT.wingspan ? Number(mT.wingspan.toFixed(1)) : null,
      overhead_reach_toe_to_finger_l_cm: mO.fingerToToeL ? Number(mO.fingerToToeL.toFixed(1)) : null,
      overhead_reach_toe_to_finger_r_cm: mO.fingerToToeR ? Number(mO.fingerToToeR.toFixed(1)) : null
    },
    segments: {
      thigh_l: mA.thigh_l ? Number(mA.thigh_l.toFixed(1)) : null,
      thigh_r: mA.thigh_r ? Number(mA.thigh_r.toFixed(1)) : null,
      shin_l: mA.shin_l ? Number(mA.shin_l.toFixed(1)) : null,
      shin_r: mA.shin_r ? Number(mA.shin_r.toFixed(1)) : null,
      foot_l: mA.foot_l ? Number(mA.foot_l.toFixed(1)) : null,
      foot_r: mA.foot_r ? Number(mA.foot_r.toFixed(1)) : null,
      torso_l: mA.torso_l ? Number(mA.torso_l.toFixed(1)) : null,
      torso_r: mA.torso_r ? Number(mA.torso_r.toFixed(1)) : null,
      upperarm_l: mA.upperarm_l ? Number(mA.upperarm_l.toFixed(1)) : null,
      upperarm_r: mA.upperarm_r ? Number(mA.upperarm_r.toFixed(1)) : null,
      forearm_l: mA.forearm_l ? Number(mA.forearm_l.toFixed(1)) : null,
      forearm_r: mA.forearm_r ? Number(mA.forearm_r.toFixed(1)) : null
    },
    posturalFlexionProfiles: {
      aPose: {
        kneeL: mA.kneeAngleL ? Math.round(mA.kneeAngleL) : null,
        kneeR: mA.kneeAngleR ? Math.round(mA.kneeAngleR) : null,
        hipL: mA.hipAngleL ? Math.round(mA.hipAngleL) : null,
        hipR: mA.hipAngleR ? Math.round(mA.hipAngleR) : null,
        elbowL: mA.elbowAngleL ? Math.round(mA.elbowAngleL) : null,
        elbowR: mA.elbowAngleR ? Math.round(mA.elbowAngleR) : null
      },
      tPose: {
        kneeL: mT.kneeAngleL ? Math.round(mT.kneeAngleL) : null,
        kneeR: mT.kneeAngleR ? Math.round(mT.kneeAngleR) : null,
        hipL: mT.hipAngleL ? Math.round(mT.hipAngleL) : null,
        hipR: mT.hipAngleR ? Math.round(mT.hipAngleR) : null,
        elbowL: mT.elbowAngleL ? Math.round(mT.elbowAngleL) : null,
        elbowR: mT.elbowAngleR ? Math.round(mT.elbowAngleR) : null
      },
      overhead: {
        kneeL: mO.kneeAngleL ? Math.round(mO.kneeAngleL) : null,
        kneeR: mO.kneeAngleR ? Math.round(mO.kneeAngleR) : null,
        hipL: mO.hipAngleL ? Math.round(mO.hipAngleL) : null,
        hipR: mO.hipAngleR ? Math.round(mO.hipAngleR) : null,
        elbowL: mO.elbowAngleL ? Math.round(mO.elbowAngleL) : null,
        elbowR: mO.elbowAngleR ? Math.round(mO.elbowAngleR) : null
      }
    },
    overheadSquatMobility: {
      peakKneeFlexionL: state.squatPeaks.kneeL || 0,
      peakKneeFlexionR: state.squatPeaks.kneeR || 0,
      peakHipFlexionL: state.squatPeaks.hipL || 0,
      peakHipFlexionR: state.squatPeaks.hipR || 0,
      peakAnkleDorsiflexionL: state.squatPeaks.ankleL || 0,
      peakAnkleDorsiflexionR: state.squatPeaks.ankleR || 0
    },
    anglesA: state.metricsA,
    anglesT: state.metricsT,
    anglesOverhead: state.metricsOverhead
  };

  const jsonString = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  let baseFilename = 'biomechanical-session-report';
  if (subjectName) {
    baseFilename = `${sanitizeFilename(subjectName)}-session-report`;
  }
  const filename = `${baseFilename}-${timestamp}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  console.log(`[AutoCapture] Downloaded consolidated report: ${filename}`);
}
