// ==========================================
// REPORT COMPILER: IMAGE SAVING & JSON EXPORTS
// ==========================================
import {
  state,
  snapshotStore,
  getDomMeasurementCm
} from './helpers.js';

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

// ==========================================
// BIND SAVE & EXPORT ACTION CONTROLS
// ==========================================

export function setupReportCompiler({ canvasElement, statusElement, renderGallery, resetAndResume }) {
  // 1. Download Current Frozen Snapshot as PNG
  const btnDlPng = document.getElementById('btn-dl-png');
  if (btnDlPng) {
    btnDlPng.addEventListener('click', () => {
      if (!state.isSnapshotFrozen) return;
      const nameInput = document.getElementById('snapshot-name-input');
      const label = nameInput ? nameInput.value.trim() : 'biomechanical-snapshot';
      const dataUrl = canvasElement.toDataURL('image/png');
      downloadSnapshotImage(dataUrl, label);
    });
  }

  // 2. Save Current Frozen Snapshot & Biometric Metrics to Offline IndexedDB Gallery
  const btnSaveGallery = document.getElementById('btn-save-gallery');
  if (btnSaveGallery) {
    btnSaveGallery.addEventListener('click', () => {
      if (!state.isSnapshotFrozen || !state.frozenMetrics) return;

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

      const snapshotRecord = {
        name: label,
        timestamp: Date.now(),
        image: canvasElement.toDataURL('image/png'),
        metrics: metricsToSave
      };

      snapshotStore.save(snapshotRecord)
        .then(() => {
          statusElement.textContent = `💾 Snapshot "${label}" successfully saved to biomechanical gallery!`;
          if (typeof renderGallery === 'function') {
            renderGallery();
          }
          if (typeof resetAndResume === 'function') {
            resetAndResume();
          }
        })
        .catch(err => {
          console.error("Failed to save snapshot to IndexedDB:", err);
          alert("Could not save snapshot. See developer console for errors.");
        });
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
          const subjectInput = document.getElementById('subject-name-input');
          const subjectName = subjectInput ? subjectInput.value.trim() : '';
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
  const subjectInput = document.getElementById('subject-name-input');
  const subjectName = subjectInput ? subjectInput.value.trim() : 'Anonymous Subject';
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
    summary: {
      skeletal_height_cm: mA.skeletal_height ? Number(mA.skeletal_height.toFixed(1)) : null,
      wingspan_cm: mT.wingspan ? Number(mT.wingspan.toFixed(1)) : null,
      fingerToToeL_cm: mO.fingerToToeL ? Number(mO.fingerToToeL.toFixed(1)) : null,
      fingerToToeR_cm: mO.fingerToToeR ? Number(mO.fingerToToeR.toFixed(1)) : null,
      hip_width_cm: mA.hipW ? Number(mA.hipW.toFixed(1)) : null
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
    }
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
