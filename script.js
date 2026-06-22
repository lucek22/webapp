// ==========================================
// SCARLET BIOMECHANICS: ENTRYPOINT SCRIPT
// ==========================================

import { state, snapshotStore, updateHeightInputUnit } from './helpers.js';
import { setupMediaPipeCallbacks } from './mediapipeLogic.js';
import { setupReportCompiler } from './reportCompiler.js';
import {
  canvasElement,
  statusElement,
  renderGallery,
  resetAndResume,
  onPoseResults,
  drawHandMesh
} from './userController.js';

// 1. Initialize persistent offline database store
snapshotStore.init()
  .then(() => {
    state.dbInitialized = true;
    renderGallery();
  })
  .catch(err => {
    console.error("IndexedDB store initialization failed:", err);
  });

// 2. Setup dynamic callback integration for MediaPipe models
setupMediaPipeCallbacks(onPoseResults, drawHandMesh);

// 3. Connect report compiler dependencies (Save / Export features)
setupReportCompiler({
  canvasElement,
  statusElement,
  renderGallery,
  resetAndResume
});

// 4. Run initial DOM UI units configuration
updateHeightInputUnit();

console.log("🚀 Scarlet Biomechanics ES Module Engine successfully initialized!");
