// ==========================================
// REPORT COMPILER: IMAGE SAVING & JSON EXPORTS
// ==========================================

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
function downloadSnapshotImage(dataUrl, filename) {
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

// 1. Download Current Frozen Snapshot as PNG
const btnDlPng = document.getElementById('btn-dl-png');
if (btnDlPng) {
  btnDlPng.addEventListener('click', () => {
    if (!isSnapshotFrozen) return;
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
    if (!isSnapshotFrozen || !frozenMetrics) return;

    const nameInput = document.getElementById('snapshot-name-input');
    const label = nameInput ? nameInput.value.trim() : 'Posture Scan';

    // Retrieve active DOM pinch/span measurements in raw cm values
    const pinch_l_cm = getDomMeasurementCm('val-pinch-l');
    const pinch_r_cm = getDomMeasurementCm('val-pinch-r');
    const span_l_cm = getDomMeasurementCm('val-span-l');
    const span_r_cm = getDomMeasurementCm('val-span-r');

    const metricsToSave = {
      ...frozenMetrics,
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
