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
  drawHandMesh,
  frozenFrameCanvas,
  initializeProfilesSelector
} from './userController.js';

// 1. Initialize persistent offline database store
snapshotStore.init()
  .then(() => {
    state.dbInitialized = true;
    renderGallery();
    initializeProfilesSelector();
  })
  .catch(err => {
    console.error("IndexedDB store initialization failed:", err);
  });

// 2. Setup dynamic callback integration for MediaPipe models
setupMediaPipeCallbacks(onPoseResults, drawHandMesh);

// 3. Connect report compiler dependencies (Save / Export features)
setupReportCompiler({
  canvasElement,
  frozenFrameCanvas,
  statusElement,
  renderGallery,
  resetAndResume
});

// 4. Run initial DOM UI units configuration
updateHeightInputUnit();

// 5. Initialize Mobile Section Accordions (Option 2 - Zero-Scroll Footprint on Mobile)
document.addEventListener('click', (e) => {
  // Only process on mobile/tablet viewports (992px or narrower)
  if (window.innerWidth > 992) return;

  // Find closest collapsible card container
  const collapsible = e.target.closest('.collapsible');
  if (!collapsible) return;

  // If clicked target is an interactive element (buttons, inputs, select), bypass toggle
  if (e.target.closest('button, input, select, textarea, a, .btn, .snapshot-card-delete')) {
    return;
  }

  // Find the header element
  const header = collapsible.querySelector('.section-title, .pose-card-main, .details-section-title');
  if (!header) return;

  // Verify click occurred on the header or the container itself
  if (header.contains(e.target) || e.target === collapsible) {
    e.preventDefault();
    e.stopPropagation();

    const isCurrentlyExpanded = collapsible.classList.contains('active-expanded');

    // Accordion behavior: collapse all siblings inside the same parent container
    const parentContainer = collapsible.parentNode;
    if (parentContainer) {
      const siblingCollapsibles = parentContainer.querySelectorAll('.collapsible');
      siblingCollapsibles.forEach(sib => {
        sib.classList.remove('active-expanded');
      });
    }

    // Toggle selected card
    if (!isCurrentlyExpanded) {
      collapsible.classList.add('active-expanded');
    }
  }
});

console.log("🚀 Scarlet Biomechanics ES Module Engine successfully initialized!");
