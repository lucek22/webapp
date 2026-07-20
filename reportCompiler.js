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
    btnSaveGallery.addEventListener('click', async () => {
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

      const { autoSyncToActiveProfile } = await import('./profileManager.js');
      if (state.currentMode === 'squat') {
        autoSyncToActiveProfile(true);
      } else {
        autoSyncToActiveProfile();
      }

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
    tibialInclinationROM: {
      peakTibialInclinationL: (state.ankleDorsi && state.ankleDorsi.peaks) ? state.ankleDorsi.peaks.shinAngleL || 0 : 0,
      peakTibialInclinationR: (state.ankleDorsi && state.ankleDorsi.peaks) ? state.ankleDorsi.peaks.shinAngleR || 0 : 0,
      peakAnkleDorsiflexionL: (state.ankleDorsi && state.ankleDorsi.peaks) ? state.ankleDorsi.peaks.ankleDorsiL || 0 : 0,
      peakAnkleDorsiflexionR: (state.ankleDorsi && state.ankleDorsi.peaks) ? state.ankleDorsi.peaks.ankleDorsiR || 0 : 0
    },
    shoulderFlexionMobility: {
      peakFlexionL: state.shoulderPeaks?.excursionL || 0,
      peakFlexionR: state.shoulderPeaks?.excursionR || 0
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

/**
 * Packages the selected profile, its complete session metadata, and all associated 
 * PNG snapshots and binary video recording Blobs into a single download .ZIP file.
 * @param {number|string} profileId 
 */
export async function exportProfileBundle(profileId) {
  if (!window.JSZip) {
    alert("The JSZip library is still loading. Please check your network connection and try again.");
    return;
  }

  const profile = await snapshotStore.getProfile(Number(profileId));
  if (!profile) {
    alert("Selected profile was not found in the local database.");
    return;
  }

  // Visual feedback: Show exporting state
  const btnExport = document.getElementById('btn-profile-export-bundle');
  const originalText = btnExport ? btnExport.innerHTML : '';
  if (btnExport) {
    btnExport.innerHTML = `
      <svg class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      Generating Bundle ZIP...
    `;
    btnExport.disabled = true;
  }

  try {
    const zip = new window.JSZip();
    const snapshotsFolder = zip.folder("snapshots");
    const videosFolder = zip.folder("videos");

    // Deep clone the profile object so we can modify properties for the JSON metadata file safely
    const metadata = JSON.parse(JSON.stringify(profile));

    const imageKeys = [
      'imageA', 'imageT', 'imageOverhead', 'imageSquatL', 'imageSquatR', 'imageSquatFrontal',
      'imageShoulderLStart', 'imageShoulderLEnd', 'imageShoulderRStart', 'imageShoulderREnd',
      'imageShoulderRotationL', 'imageShoulderRotationR', 'imageHipRotationL', 'imageHipRotationR',
      'imageAnkleDorsiL', 'imageAnkleDorsiR', 'imageThoracicExtension'
    ];

    const videoKeys = [
      'videoSquatL', 'videoSquatR', 'videoSquatFrontal',
      'videoShoulderL', 'videoShoulderR',
      'videoShoulderRotationL', 'videoShoulderRotationR',
      'videoHipRotationL', 'videoHipRotationR',
      'videoAnkleDorsiL', 'videoAnkleDorsiR',
      'videoThoracicExtension'
    ];

    // Helper to package snapshots and videos in a session or top-level profile
    async function packageEntityAssets(entity, entityPrefix) {
      // Process Images (Base64 data URLs)
      for (const imgKey of imageKeys) {
        const dataUrl = entity[imgKey];
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
          const parts = dataUrl.split(',');
          if (parts.length === 2) {
            const base64Data = parts[1];
            const fileExt = dataUrl.includes('image/jpeg') ? 'jpg' : 'png';
            const filename = `${entityPrefix}${imgKey}.${fileExt}`;
            
            // Add image file to ZIP
            snapshotsFolder.file(filename, base64Data, { base64: true });
            
            // Replace the full base64 in the metadata JSON with a local reference path
            entity[imgKey] = `snapshots/${filename}`;
          }
        }
      }
    }

    // Process top-level profile assets (for backwards-compatibility)
    await packageEntityAssets(metadata, 'profile_');

    // Process top-level videos (backwards-compatibility fallback)
    for (const vidKey of videoKeys) {
      const originalVid = profile[vidKey];
      if (originalVid && originalVid.blob instanceof Blob) {
        const fileExt = originalVid.fileExt || 'webm';
        const filename = `profile_${vidKey}.${fileExt}`;
        
        videosFolder.file(filename, originalVid.blob);
        
        metadata[vidKey] = {
          id: originalVid.id,
          name: originalVid.name,
          duration: originalVid.duration,
          timestamp: originalVid.timestamp,
          fileExt: fileExt,
          filePath: `videos/${filename}`
        };
      }
    }

    // Process all sessions and their assets
    if (profile.sessions && Array.isArray(profile.sessions)) {
      for (let sIdx = 0; sIdx < profile.sessions.length; sIdx++) {
        const originalSession = profile.sessions[sIdx];
        const metaSession = metadata.sessions[sIdx];
        const sessionPrefix = `session_${sIdx + 1}_`;

        await packageEntityAssets(metaSession, sessionPrefix);

        // Process session videos
        for (const vidKey of videoKeys) {
          const originalVid = originalSession[vidKey];
          if (originalVid && originalVid.blob instanceof Blob) {
            const fileExt = originalVid.fileExt || 'webm';
            const filename = `${sessionPrefix}${vidKey}.${fileExt}`;
            
            // Add video to ZIP folder
            videosFolder.file(filename, originalVid.blob);
            
            // Rewrite session video reference in metadata
            metaSession[vidKey] = {
              id: originalVid.id,
              name: originalVid.name,
              duration: originalVid.duration,
              timestamp: originalVid.timestamp,
              fileExt: fileExt,
              filePath: `videos/${filename}`
            };
          }
        }
      }
    }

    // Write metadata JSON to zip root
    zip.file("profile_metadata.json", JSON.stringify(metadata, null, 2));

    // Generate ZIP blob and download
    const cleanSubjectName = sanitizeFilename(profile.name) || "subject";
    const zipFilename = `scarlet_profile_${cleanSubjectName}_${Date.now()}.zip`;

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);

    const downloadLink = document.createElement('a');
    downloadLink.href = zipUrl;
    downloadLink.download = zipFilename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    
    setTimeout(() => {
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(zipUrl);
    }, 150);

    console.log(`[ZIP-Export] Successfully compiled and downloaded profile bundle: ${zipFilename}`);

  } catch (err) {
    console.error("[ZIP-Export] Error while exporting profile bundle ZIP:", err);
    alert("Failed to export athlete profile bundle. Error: " + err.message);
  } finally {
    if (btnExport) {
      btnExport.innerHTML = originalText;
      btnExport.disabled = false;
    }
  }
}

/**
 * Parses an uploaded .ZIP profile bundle, decodes local snapshots and binary videos,
 * restores them into the standard profile data structures, and saves to IndexedDB.
 * @param {File} file - The uploaded .zip File object
 */
export async function importProfileBundle(file) {
  if (!window.JSZip) {
    alert("The JSZip library is still loading. Please check your network connection and try again.");
    return;
  }

  const btnImport = document.getElementById('btn-import-profile-bundle-submit');
  const originalText = btnImport ? btnImport.innerHTML : '';
  if (btnImport) {
    btnImport.innerHTML = `
      <svg class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px; display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      Processing Bundle...
    `;
    btnImport.disabled = true;
  }

  try {
    const zip = await window.JSZip.loadAsync(file);
    const metaFile = zip.file("profile_metadata.json");
    if (!metaFile) {
      throw new Error("Invalid bundle: Could not find profile_metadata.json inside the ZIP.");
    }

    const metaText = await metaFile.async("string");
    const importedProfile = JSON.parse(metaText);

    // Make sure we have a valid profiles list to check duplicate names
    const existingProfiles = await snapshotStore.getAllProfiles();
    
    let originalName = importedProfile.name || "Imported Athlete";
    let uniqueName = originalName;
    let suffixCounter = 1;
    while (existingProfiles && existingProfiles.some(p => p.name.toLowerCase() === uniqueName.toLowerCase())) {
      uniqueName = `${originalName} (${suffixCounter++})`;
    }
    importedProfile.name = uniqueName;

    // Helper to reconstruct assets from local files
    async function reconstructEntityAssets(entity) {
      const imageKeys = [
        'imageA', 'imageT', 'imageOverhead', 'imageSquatL', 'imageSquatR', 'imageSquatFrontal',
        'imageShoulderLStart', 'imageShoulderLEnd', 'imageShoulderRStart', 'imageShoulderREnd',
        'imageShoulderRotationL', 'imageShoulderRotationR', 'imageHipRotationL', 'imageHipRotationR',
        'imageAnkleDorsiL', 'imageAnkleDorsiR', 'imageThoracicExtension'
      ];

      for (const imgKey of imageKeys) {
        const refPath = entity[imgKey];
        if (refPath && typeof refPath === 'string' && refPath.startsWith('snapshots/')) {
          const zipImgFile = zip.file(refPath);
          if (zipImgFile) {
            const base64Content = await zipImgFile.async("base64");
            const fileExt = refPath.endsWith('.jpg') || refPath.endsWith('.jpeg') ? 'jpeg' : 'png';
            entity[imgKey] = `data:image/${fileExt};base64,${base64Content}`;
          } else {
            console.warn(`[ZIP-Import] Snapshot file not found in archive: ${refPath}`);
            entity[imgKey] = null;
          }
        }
      }
    }

    // 1. Reconstruct top-level images
    await reconstructEntityAssets(importedProfile);

    const videoKeys = [
      'videoSquatL', 'videoSquatR', 'videoSquatFrontal',
      'videoShoulderL', 'videoShoulderR',
      'videoShoulderRotationL', 'videoShoulderRotationR',
      'videoHipRotationL', 'videoHipRotationR',
      'videoAnkleDorsiL', 'videoAnkleDorsiR',
      'videoThoracicExtension'
    ];

    // 2. Reconstruct top-level videos (backwards-compatibility)
    for (const vidKey of videoKeys) {
      const vidRef = importedProfile[vidKey];
      if (vidRef && vidRef.filePath && typeof vidRef.filePath === 'string') {
        const zipVidFile = zip.file(vidRef.filePath);
        if (zipVidFile) {
          const videoBlob = await zipVidFile.async("blob");
          importedProfile[vidKey] = {
            id: vidRef.id || Date.now(),
            name: vidRef.name || "Imported Video",
            duration: vidRef.duration || 0,
            timestamp: vidRef.timestamp || Date.now(),
            fileExt: vidRef.fileExt || 'webm',
            blob: videoBlob
          };
        } else {
          console.warn(`[ZIP-Import] Video file not found in archive: ${vidRef.filePath}`);
          importedProfile[vidKey] = null;
        }
      }
    }

    // 3. Reconstruct session assets
    if (importedProfile.sessions && Array.isArray(importedProfile.sessions)) {
      for (const session of importedProfile.sessions) {
        await reconstructEntityAssets(session);

        // Reconstruct session videos
        for (const vidKey of videoKeys) {
          const vidRef = session[vidKey];
          if (vidRef && vidRef.filePath && typeof vidRef.filePath === 'string') {
            const zipVidFile = zip.file(vidRef.filePath);
            if (zipVidFile) {
              const videoBlob = await zipVidFile.async("blob");
              session[vidKey] = {
                id: vidRef.id || Date.now(),
                name: vidRef.name || "Imported Video",
                duration: vidRef.duration || 0,
                timestamp: vidRef.timestamp || Date.now(),
                fileExt: vidRef.fileExt || 'webm',
                blob: videoBlob
              };
            } else {
              console.warn(`[ZIP-Import] Session video file not found in archive: ${vidRef.filePath}`);
              session[vidKey] = null;
            }
          }
        }
      }
    }

    // Delete existing id field so IndexedDB generates a new auto-incremented primary key
    delete importedProfile.id;

    // Save imported profile to database
    const newProfileId = await snapshotStore.saveProfile(importedProfile);
    state.allProfiles = await snapshotStore.getAllProfiles();

    // Trigger update of selector/UI
    const profileSelect = document.getElementById('profile-select');
    if (profileSelect) {
      // Refresh dropdown list
      const { populateDropdown } = await import('./profileManager.js');
      populateDropdown(state.allProfiles);
      profileSelect.value = String(newProfileId);
      profileSelect.dispatchEvent(new Event('change'));
    }

    alert(`Successfully imported athlete bundle for: "${importedProfile.name}"!`);
    
    // Clear input
    const fileInput = document.getElementById('profile-bundle-file-input');
    if (fileInput) fileInput.value = '';

  } catch (err) {
    console.error("[ZIP-Import] Error while importing profile bundle ZIP:", err);
    alert("Failed to import athlete profile bundle. Error: " + err.message);
  } finally {
    if (btnImport) {
      btnImport.innerHTML = originalText;
      btnImport.disabled = false;
    }
  }
}
