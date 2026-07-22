// =========================================================
// BUCKEYE PERSISTENT SUBJECT PROFILES MANAGER MODULE
// =========================================================

import { state, snapshotStore, formatLength, clearSmoothBuffer, getROMThresholds, getDefaultROMThresholds, calculateROMGrade, getDefaultAnkleDorsiPeaks } from './helpers.js';
import { getDefaultSquatPeaks, calculateValgusFromJoints, calculateVarusFromJoints } from './squatController.js';
import { getDefaultShoulderPeaks, getShoulderWristAngle, updateShoulderSidebarUI } from './shoulderController.js';
import { getDefaultShoulderRotation } from './shoulderRotationController.js';
import { getDefaultHipRotation } from './hipRotationController.js';
import { getDefaultThoracicExtension } from './thoracicController.js';
import { exportProfileBundle, importProfileBundle } from './reportCompiler.js';
import { pose, calculatePoseMetrics } from './mediapipeLogic.js';

// We import renderDashboard, updateDashboardOfflinePlaceholders, setUnitSystem from userController.js
// Since these are late-invoked inside interactive handlers, circular references are resolved fine by ES module loader.
// We register callbacks to break circular references
let renderDashboardFn = null;
let updateDashboardOfflinePlaceholdersFn = null;
let setUnitSystemFn = null;
let importPriorPortfolioFn = null;

export function registerProfileCallbacks(config) {
  renderDashboardFn = config.renderDashboard;
  updateDashboardOfflinePlaceholdersFn = config.updateDashboardOfflinePlaceholders;
  setUnitSystemFn = config.setUnitSystem;
  importPriorPortfolioFn = config.importPriorPortfolio;
}

// Validates video blobs with robust duck-typing check instead of strict instanceof Blob
function getSafeVideoBlob(sVideo) {
  if (!sVideo || !sVideo.blob) return null;
  const blob = sVideo.blob;
  // Robust duck-typing to avoid cross-realm/iframe proto mismatch
  const isBlobLike = blob && typeof blob.slice === 'function' && typeof blob.size === 'number';
  if (!isBlobLike) {
    console.warn("[getSafeVideoBlob] sVideo.blob is not a valid Blob/File object:", blob);
    return null;
  }
  return blob;
}


// Drawing overlay helpers from canvasRenderer
import { drawFullSkeletalMesh, drawSkeletalFramework, drawAngleBadge, drawValgusBadge } from './canvasRenderer.js';

// DOM Elements inside profileManager scope
const statusElement = document.getElementById('status');

export function getActiveProfileName(includeFallback = true) {
  if (state.activeProfileId && state.allProfiles) {
    const activeProfile = state.allProfiles.find(p => p.id === state.activeProfileId);
    if (activeProfile) {
      return activeProfile.name;
    }
  }
  const subjectInput = document.getElementById('subject-name-input');
  if (subjectInput && subjectInput.value.trim()) {
    return subjectInput.value.trim();
  }
  return includeFallback ? "Guest Mode" : "";
}

export function populateDropdown(filteredProfiles) {
  const profileSelect = document.getElementById('profile-select');
  const calProfileSelect = document.getElementById('cal-profile-select');
  if (!profileSelect) return;

  const currentSelected = profileSelect.value;
  profileSelect.innerHTML = '';
  
  if (calProfileSelect) {
    calProfileSelect.innerHTML = '';
  }
  
  filteredProfiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelect.appendChild(opt);

    if (calProfileSelect) {
      const calOpt = document.createElement('option');
      calOpt.value = p.id;
      calOpt.textContent = p.name;
      calProfileSelect.appendChild(calOpt);
    }
  });

  const createOpt = document.createElement('option');
  createOpt.value = 'new';
  createOpt.textContent = 'Select Existing Profile';
  profileSelect.appendChild(createOpt);

  const importOpt = document.createElement('option');
  importOpt.value = 'import';
  importOpt.textContent = 'Import Profile';
  profileSelect.appendChild(importOpt);
  
  if (currentSelected && [...profileSelect.options].some(o => o.value === currentSelected)) {
    profileSelect.value = currentSelected;
  } else {
    profileSelect.value = state.activeProfileId ? String(state.activeProfileId) : 'new';
  }

  if (calProfileSelect) {
    calProfileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
  }
}

export async function initializeProfilesSelector() {
  const profileSelect = document.getElementById('profile-select');
  const calProfileSelect = document.getElementById('cal-profile-select');
  const profileSearchInput = document.getElementById('profile-search-input');
  const btnSaveProfile = document.getElementById('btn-save-profile');
  const subjectNameInput = document.getElementById('subject-name-input');
  const btnDeleteProfile = document.getElementById('btn-delete-profile');
  const profileStatusBar = document.getElementById('profile-status-bar');
  const newProfileInputContainer = document.getElementById('new-profile-input-container');
  const importProfileInputContainer = document.getElementById('import-profile-input-container');

  const profileActionRow = document.getElementById('profile-action-row');
  const btnViewProfileDetails = document.getElementById('btn-view-profile-details');
  const btnCloseProfileDetails = document.getElementById('btn-close-profile-details');
  const btnCloseProfileDetailsFooter = document.getElementById('btn-close-profile-details-footer');
  const btnProfileExportJson = document.getElementById('btn-profile-export-json');
  const modalUnitInchBtn = document.getElementById('modal-unit-inch-btn');
  const modalUnitCmBtn = document.getElementById('modal-unit-cm-btn');

  if (!profileSelect) return;

  try {
    state.allProfiles = await snapshotStore.getAllProfiles();
    
    // Restore active profile from localStorage if present and valid
    const savedProfileId = localStorage.getItem('activeProfileId');
    if (savedProfileId && state.allProfiles.some(p => String(p.id) === String(savedProfileId))) {
      state.activeProfileId = Number(savedProfileId);
    }
    
    populateDropdown(state.allProfiles);
    if (state.activeProfileId) {
      if (profileActionRow) profileActionRow.classList.remove('hidden');
      if (newProfileInputContainer) {
        newProfileInputContainer.classList.add('hidden');
        newProfileInputContainer.classList.remove('visible-flex');
      }
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.add('hidden');
        importProfileInputContainer.classList.remove('visible-flex');
      }
      await loadProfileIntoState(state.activeProfileId);
    } else {
      if (profileActionRow) profileActionRow.classList.add('hidden');
      if (newProfileInputContainer) {
        newProfileInputContainer.classList.remove('hidden');
        newProfileInputContainer.classList.add('visible-flex');
      }
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.add('hidden');
        importProfileInputContainer.classList.remove('visible-flex');
      }
    }
  } catch (err) {
    console.error("[initializeProfilesSelector] Failed to load initial profiles:", err);
  }

  if (profileSearchInput) {
    profileSearchInput.addEventListener('input', () => {
      const searchVal = profileSearchInput.value.toLowerCase().trim();
      const filtered = state.allProfiles.filter(p => p.name.toLowerCase().includes(searchVal));
      populateDropdown(filtered);
    });
  }

  const handleProfileChange = async (selectedVal) => {
    if (state.isExportingFrameByFrame || state.isRecordingPlayLoop) {
      alert("An export is currently in progress. Please wait until the export completes before switching profiles.");
      if (profileSelect) profileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
      if (calProfileSelect) calProfileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
      return;
    }
    if (selectedVal === 'import') {
      state.activeProfileId = null;
      localStorage.removeItem('activeProfileId');
      if (profileSelect) profileSelect.value = 'import';
      if (calProfileSelect) calProfileSelect.value = '';

      if (newProfileInputContainer) {
        newProfileInputContainer.classList.add('hidden');
        newProfileInputContainer.classList.remove('visible-flex');
      }
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.remove('hidden');
        importProfileInputContainer.classList.add('visible-flex');
      }
      if (profileStatusBar) profileStatusBar.classList.add('hidden');
      if (btnDeleteProfile) btnDeleteProfile.classList.add('hidden');
      if (profileActionRow) profileActionRow.classList.add('hidden');

      const sessionContainer = document.getElementById('profile-session-select-container');
      if (sessionContainer) sessionContainer.classList.add('hidden');

      // Reset left videos sidebar to guest card
      const leftCard = document.getElementById('left-videos-active-card');
      const guestCard = document.getElementById('left-videos-guest-card');
      if (leftCard && guestCard) {
        leftCard.classList.add('hidden');
        guestCard.classList.remove('hidden');
      }

    } else if (selectedVal === 'new') {
      state.activeProfileId = null;
      localStorage.removeItem('activeProfileId');
      if (profileSelect) profileSelect.value = 'new';
      if (calProfileSelect) calProfileSelect.value = '';
      
      if (newProfileInputContainer) {
        newProfileInputContainer.classList.remove('hidden');
        newProfileInputContainer.classList.add('visible-flex');
      }
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.add('hidden');
        importProfileInputContainer.classList.remove('visible-flex');
      }
      if (profileStatusBar) profileStatusBar.classList.add('hidden');
      if (btnDeleteProfile) btnDeleteProfile.classList.add('hidden');
      if (profileActionRow) profileActionRow.classList.add('hidden');
      
      const sessionContainer = document.getElementById('profile-session-select-container');
      if (sessionContainer) sessionContainer.classList.add('hidden');

      // Reset left videos sidebar to guest card
      const leftCard = document.getElementById('left-videos-active-card');
      const guestCard = document.getElementById('left-videos-guest-card');
      if (leftCard && guestCard) {
        leftCard.classList.add('hidden');
        guestCard.classList.remove('hidden');
      }

    } else if (selectedVal === '') {
      if (profileSelect) profileSelect.value = '';
      if (calProfileSelect) calProfileSelect.value = '';

      // Cleanly reset Guest state caches
      state.activeProfileId = null;
      localStorage.removeItem('activeProfileId');
      state.metricsA = null;
      state.metricsT = null;
      state.metricsOverhead = null;
      state.imageA = null;
      state.imageT = null;
      state.imageOverhead = null;
      state.importedPortfolioMetrics = null;
      state.pixelsPerCm = null;
      state.calLocked = false;
      state.squatPeaks = getDefaultSquatPeaks();

      if (updateDashboardOfflinePlaceholdersFn) updateDashboardOfflinePlaceholdersFn();

      if (newProfileInputContainer) {
        newProfileInputContainer.classList.add('hidden');
        newProfileInputContainer.classList.remove('visible-flex');
      }
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.add('hidden');
        importProfileInputContainer.classList.remove('visible-flex');
      }
      if (profileStatusBar) {
        const activeProfileName = document.getElementById('active-profile-name');
        if (activeProfileName) activeProfileName.textContent = 'Guest Mode';
        profileStatusBar.classList.add('hidden');
      }
      if (btnDeleteProfile) btnDeleteProfile.classList.add('hidden');
      if (profileActionRow) profileActionRow.classList.add('hidden');
      
      const sessionContainer = document.getElementById('profile-session-select-container');
      if (sessionContainer) sessionContainer.classList.add('hidden');
    } else {
      if (profileSelect) profileSelect.value = selectedVal;
      if (calProfileSelect) calProfileSelect.value = selectedVal;

      if (newProfileInputContainer) {
        newProfileInputContainer.classList.add('hidden');
        newProfileInputContainer.classList.remove('visible-flex');
      }
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.add('hidden');
        importProfileInputContainer.classList.remove('visible-flex');
      }
      await loadProfileIntoState(Number(selectedVal));
    }
  };

  profileSelect.addEventListener('change', () => handleProfileChange(profileSelect.value));
  if (calProfileSelect) {
    calProfileSelect.addEventListener('change', () => handleProfileChange(calProfileSelect.value));
  }

  if (btnSaveProfile) {
    btnSaveProfile.addEventListener('click', async () => {
      if (!subjectNameInput) return;
      const nameVal = subjectNameInput.value.trim();
      if (!nameVal) {
        alert("Please enter a subject name to create a profile.");
        return;
      }

      const inputUserHeight = document.getElementById('input-user-height');
      if (!inputUserHeight) return;
      const heightVal = parseFloat(inputUserHeight.value);
      if (isNaN(heightVal) || heightVal <= 0) {
        alert("Please enter a valid height to create a profile.");
        return;
      }

      const isDuplicate = state.allProfiles.some(p => p.name.toLowerCase() === nameVal.toLowerCase());
      if (isDuplicate) {
        alert(`A profile named "${nameVal}" already exists. Please choose a different name.`);
        return;
      }

      const heightCm = state.useInches ? heightVal * 2.54 : heightVal;

      const newProfile = {
        name: nameVal,
        timestamp: Date.now(),
        heightCm: heightCm,
        metricsA: null,
        metricsT: null,
        metricsOverhead: null,
        squatPeaks: getDefaultSquatPeaks(),
        imageA: null,
        imageT: null,
        imageOverhead: null,
        pixelsPerCm: null
      };

      try {
        const newId = await snapshotStore.saveProfile(newProfile);
        state.activeProfileId = newId;
        state.allProfiles = await snapshotStore.getAllProfiles();
        
        if (profileSearchInput) profileSearchInput.value = '';
        
        populateDropdown(state.allProfiles);
        profileSelect.value = String(newId);
        if (calProfileSelect) calProfileSelect.value = String(newId);
        
        if (newProfileInputContainer) {
          newProfileInputContainer.classList.add('hidden');
          newProfileInputContainer.classList.remove('visible-flex');
        }
        subjectNameInput.value = '';

        await loadProfileIntoState(newId);
        if (statusElement) {
          statusElement.textContent = `Profile "${nameVal}" created successfully!`;
        }
      } catch (err) {
        console.error("[initializeProfilesSelector] Failed to save new profile:", err);
        alert("Failed to save profile to database.");
      }
    });
  }

  if (btnDeleteProfile) {
    btnDeleteProfile.addEventListener('click', async () => {
      if (!state.activeProfileId) return;
      
      const activeProfile = state.allProfiles.find(p => p.id === state.activeProfileId);
      const nameToDelete = activeProfile ? activeProfile.name : "this profile";
      
      if (!confirm(`WARNING: Are you sure you want to permanently delete the profile "${nameToDelete}" and all of its compiled metrics?\n\nThis action cannot be undone.`)) {
        return;
      }

      try {
        await snapshotStore.deleteProfile(state.activeProfileId);
        state.activeProfileId = null;
        localStorage.removeItem('activeProfileId');
        state.metricsA = null;
        state.metricsT = null;
        state.metricsOverhead = null;
        state.imageA = null;
        state.imageT = null;
        state.imageOverhead = null;
        state.importedPortfolioMetrics = null;
        state.pixelsPerCm = null;
        state.calLocked = false;
        state.squatPeaks = getDefaultSquatPeaks();
        
        state.allProfiles = await snapshotStore.getAllProfiles();
        
        if (profileSearchInput) profileSearchInput.value = '';
        populateDropdown(state.allProfiles);
        profileSelect.value = 'new';
        if (calProfileSelect) calProfileSelect.value = '';
        
        if (updateDashboardOfflinePlaceholdersFn) updateDashboardOfflinePlaceholdersFn();

        if (newProfileInputContainer) {
          newProfileInputContainer.classList.remove('hidden');
          newProfileInputContainer.classList.add('visible-flex');
        }

        if (profileStatusBar) {
          const activeProfileName = document.getElementById('active-profile-name');
          if (activeProfileName) activeProfileName.textContent = 'Guest Mode';
          profileStatusBar.classList.add('hidden');
        }
        btnDeleteProfile.classList.add('hidden');
        if (profileActionRow) profileActionRow.classList.add('hidden');
        
        const sessionContainer = document.getElementById('profile-session-select-container');
        if (sessionContainer) sessionContainer.classList.add('hidden');

        if (statusElement) {
          statusElement.textContent = `Profile deleted successfully. Switched back to Select Existing Profile mode.`;
        }
      } catch (err) {
        console.error("[initializeProfilesSelector] Failed to delete profile:", err);
        alert("Failed to delete profile from database.");
      }
    });
  }

  if (btnViewProfileDetails) {
    btnViewProfileDetails.addEventListener('click', () => {
      if (state.activeProfileId) {
        openProfileDetailsModal(state.activeProfileId);
      } else {
        alert("Please select or create a profile to view details.");
      }
    });
  }

  if (btnCloseProfileDetails) {
    btnCloseProfileDetails.addEventListener('click', closeProfileDetailsModal);
  }

  if (btnCloseProfileDetailsFooter) {
    btnCloseProfileDetailsFooter.addEventListener('click', closeProfileDetailsModal);
  }

  // Initialize Athlete Tabs switching
  const tabButtons = document.querySelectorAll('.athlete-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const container = btn.closest('.profile-modal-container') || btn.closest('.gallery-section') || document;
      
      const siblingBtns = container.querySelectorAll('.athlete-tab-btn');
      siblingBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tabPanes = container.querySelectorAll('.athlete-tab-pane');
      tabPanes.forEach(pane => pane.classList.add('hidden'));

      const targetTabId = btn.getAttribute('data-tab');
      const targetPane = container.querySelector(`[id="${targetTabId}"]`);
      if (targetPane) {
        targetPane.classList.remove('hidden');
      }
    });
  });

  // Global Shortcut for CTRL + E / CMD + E to toggle Profile Edit Mode
  document.addEventListener('keydown', (e) => {
    // Check if Ctrl (or Cmd on Mac) and E are pressed
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();

      if (!state.activeProfileId) {
        alert("Please select or create an athlete profile first to use this shortcut.");
        return;
      }

      const modal = document.getElementById('profile-details-modal');
      const isModalOpen = modal && modal.classList.contains('active');

      if (!isModalOpen) {
        // If modal is closed, open it and instantly enter Edit Mode
        state.isEditingProfileMetrics = true;
        openProfileDetailsModal(state.activeProfileId);
      } else {
        // If modal is already open, toggle Edit Mode
        state.isEditingProfileMetrics = !state.isEditingProfileMetrics;
        updateProfileUI(state.activeProfileId);
      }
    }
  });

  const btnImportProfileBundleSubmit = document.getElementById('btn-import-profile-bundle-submit');
  const profileBundleFileInput = document.getElementById('profile-bundle-file-input');

  if (btnImportProfileBundleSubmit && profileBundleFileInput) {
    btnImportProfileBundleSubmit.addEventListener('click', async () => {
      const file = profileBundleFileInput.files[0];
      if (!file) {
        alert("Please select a profile bundle .ZIP file first.");
        return;
      }
      await importProfileBundle(file);
      
      // Clear input and hide the container on success
      profileBundleFileInput.value = "";
      if (importProfileInputContainer) {
        importProfileInputContainer.classList.add('hidden');
        importProfileInputContainer.classList.remove('visible-flex');
      }
    });
  }

  const mainVideoPlayer = document.getElementById('profile-details-video-player');
  if (mainVideoPlayer) {
    const container = document.getElementById('profile-details-video-player-container');
    const customFullscreenBtn = document.getElementById('btn-profile-video-fullscreen');

    const toggleFullscreen = () => {
      const currentFullscreenElement = document.fullscreenElement || 
                                       document.webkitFullscreenElement || 
                                       document.mozFullScreenElement || 
                                       document.msFullscreenElement;

      if (!currentFullscreenElement) {
        if (container.requestFullscreen) {
          container.requestFullscreen().catch(e => console.error("[Fullscreen] requestFullscreen failed:", e));
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (container.mozRequestFullScreen) {
          container.mozRequestFullScreen();
        } else if (container.msRequestFullscreen) {
          container.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(e => console.error("[Fullscreen] exitFullscreen failed:", e));
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    };

    if (customFullscreenBtn) {
      customFullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
      });
    }

    if (container) {
      container.addEventListener('dblclick', (e) => {
        if (e.target.closest('#btn-profile-video-fullscreen') || e.target.tagName.toLowerCase() === 'button') {
          return;
        }
        toggleFullscreen();
      });
    }

    const updateFullscreenButtonUI = () => {
      const currentFullscreenElement = document.fullscreenElement || 
                                       document.webkitFullscreenElement || 
                                       document.mozFullScreenElement || 
                                       document.msFullscreenElement;

      const isFullscreen = (currentFullscreenElement === container);

      if (customFullscreenBtn) {
        if (isFullscreen) {
          customFullscreenBtn.title = "Exit Fullscreen";
          customFullscreenBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
            </svg>
          `;
        } else {
          customFullscreenBtn.title = "Expand Fullscreen";
          customFullscreenBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          `;
        }
      }
    };

    document.addEventListener('fullscreenchange', updateFullscreenButtonUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButtonUI);
    document.addEventListener('mozfullscreenchange', updateFullscreenButtonUI);
    document.addEventListener('MSFullscreenChange', updateFullscreenButtonUI);

    mainVideoPlayer.addEventListener('webkitbeginfullscreen', (e) => {
      e.preventDefault();
      if (container) {
        if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (container.requestFullscreen) {
          container.requestFullscreen().catch(e => {});
        }
      }
    });

    // Replay Mode: Disable pose detection and drawing during replay
    mainVideoPlayer.addEventListener('play', () => {
      state.activeModalVideoProcessing = false;
      clearModalCanvas();
    });

    mainVideoPlayer.addEventListener('playing', () => {
      state.activeModalVideoProcessing = false;
      clearModalCanvas();
    });

    const clearModalCanvas = () => {
      const canvas = document.getElementById('profile-details-video-canvas');
      if (canvas) {
        canvas.style.display = 'none'; // Ensure canvas is hidden during replay
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    mainVideoPlayer.addEventListener('pause', () => {
      clearModalCanvas();
    });

    mainVideoPlayer.addEventListener('ended', () => {
      state.activeModalVideoProcessing = false;
      clearModalCanvas();
    });

    mainVideoPlayer.addEventListener('seeking', () => {
      clearModalCanvas();
    });

    mainVideoPlayer.addEventListener('seeked', () => {
      clearModalCanvas();
    });

    mainVideoPlayer.addEventListener('emptied', () => {
      state.activeModalVideoProcessing = false;
      clearModalCanvas();
    });
  }

  if (btnProfileExportJson) {
    btnProfileExportJson.addEventListener('click', () => {
      if (state.activeProfileId) {
        exportProfileBundle(state.activeProfileId);
      } else {
        alert("No active profile loaded to export.");
      }
    });
  }

  if (modalUnitInchBtn) {
    modalUnitInchBtn.addEventListener('click', () => {
      if (setUnitSystemFn) setUnitSystemFn(true);
    });
  }

  if (modalUnitCmBtn) {
    modalUnitCmBtn.addEventListener('click', () => {
      if (setUnitSystemFn) setUnitSystemFn(false);
    });
  }

  const lightboxModal = document.getElementById('image-lightbox-modal');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxVideo = document.getElementById('lightbox-video');
  const lightboxTitle = document.getElementById('lightbox-title');

  if (lightboxModal && btnCloseLightbox && lightboxImg) {
    window.expandLightboxImage = function(src, title) {
      if (!src) return;
      if (lightboxVideo) {
        lightboxVideo.pause();
        lightboxVideo.src = '';
        lightboxVideo.style.display = 'none';
      }
      lightboxImg.src = src;
      lightboxImg.style.display = 'block';
      if (lightboxTitle) {
        lightboxTitle.textContent = title;
      }
      lightboxModal.classList.add('active');
    };

    window.expandLightboxVideo = function(src, title) {
      if (!src) return;
      lightboxImg.style.display = 'none';
      if (lightboxVideo) {
        lightboxVideo.src = src;
        lightboxVideo.style.display = 'block';
        lightboxVideo.play().catch(err => console.log("[LightboxVideo] Autoplay blocked:", err));
      }
      if (lightboxTitle) {
        lightboxTitle.textContent = title;
      }
      lightboxModal.classList.add('active');
    };

    const closeLightbox = () => {
      if (lightboxVideo) {
        lightboxVideo.pause();
        lightboxVideo.src = '';
        lightboxVideo.style.display = 'none';
      }
      lightboxModal.classList.remove('active');
    };

    btnCloseLightbox.addEventListener('click', closeLightbox);
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) {
        closeLightbox();
      }
    });

    const setupPreviewClick = (containerId, imgId, titleText) => {
      const container = document.getElementById(containerId);
      if (container) {
        container.addEventListener('click', () => {
          const img = container.querySelector('img');
          if (img && img.src && !container.classList.contains('hidden')) {
            lightboxImg.src = img.src;
            if (lightboxTitle) {
              lightboxTitle.textContent = titleText;
            }
            lightboxModal.classList.add('active');
          }
        });
      }
    };

    setupPreviewClick('detail-preview-container-a', 'detail-preview-img-a', 'A-Pose (Stature)');
    setupPreviewClick('detail-preview-container-t', 'detail-preview-img-t', 'T-Pose (Wingspan)');
    setupPreviewClick('detail-preview-container-overhead', 'detail-preview-img-overhead', 'Overhead (Reach)');
    setupPreviewClick('detail-preview-container-squat-l', 'detail-preview-img-squat-l', 'Left Overhead Squat');
    setupPreviewClick('detail-preview-container-squat-r', 'detail-preview-img-squat-r', 'Right Overhead Squat');
    setupPreviewClick('detail-preview-container-squat-frontal', 'detail-preview-img-squat-frontal', 'Frontal Overhead Squat');
  }
}

export function compileImportedMetricsFromProfile(profile, sessionId = null) {
  if (!profile) return null;

  let sourceObj = profile;
  if (profile.sessions && Array.isArray(profile.sessions) && profile.sessions.length > 0) {
    const targetId = sessionId || state.activeSessionId || profile.activeSessionId;
    const session = profile.sessions.find(s => String(s.id) === String(targetId)) || profile.sessions[0];
    if (session) {
      sourceObj = session;
    }
  }

  const compiled = {};
  let hasAny = false;

  const standardSegments = [
    'skeletal_height', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r',
    'foot_l', 'foot_r', 'torso_l', 'torso_r', 'upperarm_l', 'upperarm_r',
    'forearm_l', 'forearm_r'
  ];

  const standardSources = [sourceObj.metricsA, sourceObj.metricsT, sourceObj.metricsOverhead];
  for (const key of standardSegments) {
    let foundValue = null;
    for (const src of standardSources) {
      if (src && src[key] !== null && src[key] !== undefined) {
        foundValue = src[key];
        break;
      }
    }
    if (foundValue !== null) {
      compiled[key] = foundValue;
      hasAny = true;
    }
  }

  const wingspanSources = [sourceObj.metricsT, sourceObj.metricsA, sourceObj.metricsOverhead];
  let foundWingspan = null;
  for (const src of wingspanSources) {
    if (src && src.wingspan !== null && src.wingspan !== undefined) {
      foundWingspan = src.wingspan;
      break;
    }
  }
  if (foundWingspan !== null) {
    compiled.wingspan = foundWingspan;
    hasAny = true;
  }

  const reachSources = [sourceObj.metricsOverhead, sourceObj.metricsA, sourceObj.metricsT];
  for (const key of ['fingerToToeL', 'fingerToToeR']) {
    let foundValue = null;
    for (const src of reachSources) {
      if (src && src[key] !== null && src[key] !== undefined) {
        foundValue = src[key];
        break;
      }
    }
    if (foundValue !== null) {
      compiled[key] = foundValue;
      hasAny = true;
    }
  }

  return hasAny ? compiled : null;
}

export function ensureProfileSessions(profile) {
  if (!profile) return profile;
  if (!profile.sessions || !Array.isArray(profile.sessions) || profile.sessions.length === 0) {
    const baselineSession = {
      id: "baseline_" + Date.now(),
      name: "Baseline Session",
      timestamp: profile.timestamp || Date.now(),
      pixelsPerCm: profile.pixelsPerCm || null,
      metricsA: profile.metricsA || null,
      metricsT: profile.metricsT || null,
      metricsOverhead: profile.metricsOverhead || null,
      squatPeaks: getDefaultSquatPeaks(profile.squatPeaks),
      shoulderPeaks: getDefaultShoulderPeaks(profile.shoulderPeaks),
      shoulderRotation: getDefaultShoulderRotation(profile.shoulderRotation),
      hipRotation: getDefaultHipRotation(profile.hipRotation),
      thoracicExtension: getDefaultThoracicExtension(profile.thoracicExtension),
      imageA: profile.imageA || null,
      imageT: profile.imageT || null,
      imageOverhead: profile.imageOverhead || null,
      imageSquatL: profile.imageSquatL || null,
      imageSquatR: profile.imageSquatR || null,
      imageSquatFrontal: profile.imageSquatFrontal || null,
      imageShoulderLStart: profile.imageShoulderLStart || null,
      imageShoulderLEnd: profile.imageShoulderLEnd || null,
      imageShoulderRStart: profile.imageShoulderRStart || null,
      imageShoulderREnd: profile.imageShoulderREnd || null,
      jointsOverhead: profile.jointsOverhead || null,
      jointsShoulderL: profile.jointsShoulderL || null,
      jointsShoulderR: profile.jointsShoulderR || null,
      videoSquatL: profile.videoSquatL || null,
      videoSquatR: profile.videoSquatR || null,
      videoSquatFrontal: profile.videoSquatFrontal || null,
      videoShoulderL: profile.videoShoulderL || null,
      videoShoulderR: profile.videoShoulderR || null,
      videoShoulderRotationL: profile.videoShoulderRotationL || null,
      videoShoulderRotationR: profile.videoShoulderRotationR || null,
      videoHipRotationL: profile.videoHipRotationL || null,
      videoHipRotationR: profile.videoHipRotationR || null,
      videoAnkleDorsiL: profile.videoAnkleDorsiL || null,
      videoAnkleDorsiR: profile.videoAnkleDorsiR || null,
      videoThoracicExtension: profile.videoThoracicExtension || null
    };
    profile.sessions = [baselineSession];
    profile.activeSessionId = baselineSession.id;
  }
  if (!profile.activeSessionId) {
    profile.activeSessionId = profile.sessions[profile.sessions.length - 1].id;
  }
  return profile;
}

export async function loadProfileIntoState(profileId) {
  try {
    let profile = await snapshotStore.getProfile(profileId);
    if (!profile) return;

    const hadSessions = !!profile.sessions && Array.isArray(profile.sessions) && profile.sessions.length > 0;
    profile = ensureProfileSessions(profile);
    if (!hadSessions) {
      await snapshotStore.saveProfile(profile);
    }

    state.activeProfileId = profile.id;
    localStorage.setItem('activeProfileId', String(profile.id));
    state.videos = profile.videos || [];
    
    let activeSession = profile.sessions.find(s => String(s.id) === String(state.activeSessionId));
    if (!activeSession) {
      activeSession = profile.sessions.find(s => String(s.id) === String(profile.activeSessionId));
    }
    if (!activeSession) {
      activeSession = profile.sessions[profile.sessions.length - 1];
    }
    
    state.activeSessionId = activeSession.id;
    state.metricsA = activeSession.metricsA || null;
    state.metricsT = activeSession.metricsT || null;
    state.metricsOverhead = activeSession.metricsOverhead || null;
    state.squatPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
    state.shoulderPeaks = getDefaultShoulderPeaks(activeSession.shoulderPeaks);
    state.shoulderRotation = getDefaultShoulderRotation(activeSession.shoulderRotation);
    state.hipRotation = getDefaultHipRotation(activeSession.hipRotation);
    if (!state.ankleDorsi) state.ankleDorsi = {};
    state.ankleDorsi.peaks = getDefaultAnkleDorsiPeaks(activeSession.ankleDorsiPeaks);
    state.thoracicExtension = getDefaultThoracicExtension(activeSession.thoracicExtension);
    state.imageA = activeSession.imageA || null;
    state.imageT = activeSession.imageT || null;
    state.imageOverhead = activeSession.imageOverhead || null;
    state.imageSquatL = activeSession.imageSquatL || null;
    state.imageSquatR = activeSession.imageSquatR || null;
    state.imageSquatFrontal = activeSession.imageSquatFrontal || null;
    state.imageShoulderLStart = activeSession.imageShoulderLStart || null;
    state.imageShoulderLEnd = activeSession.imageShoulderLEnd || null;
    state.imageShoulderRStart = activeSession.imageShoulderRStart || null;
    state.imageShoulderREnd = activeSession.imageShoulderREnd || null;
    state.videoSquatL = activeSession.videoSquatL || null;
    state.videoSquatR = activeSession.videoSquatR || null;
    state.videoSquatFrontal = activeSession.videoSquatFrontal || null;
    state.videoShoulderL = activeSession.videoShoulderL || null;
    state.videoShoulderR = activeSession.videoShoulderR || null;
    state.videoShoulderRotationL = activeSession.videoShoulderRotationL || null;
    state.videoShoulderRotationR = activeSession.videoShoulderRotationR || null;
    state.videoHipRotationL = activeSession.videoHipRotationL || null;
    state.videoHipRotationR = activeSession.videoHipRotationR || null;
    state.videoThoracicExtension = activeSession.videoThoracicExtension || null;
    state.jointsOverhead = activeSession.jointsOverhead || null;
    state.jointsShoulderL = activeSession.jointsShoulderL || null;
    state.jointsShoulderR = activeSession.jointsShoulderR || null;
    
    updateShoulderSidebarUI();
    
    state.importedPortfolioMetrics = compileImportedMetricsFromProfile(profile, activeSession.id);

    const activeHeightCm = (state.importedPortfolioMetrics && state.importedPortfolioMetrics.skeletal_height) || profile.heightCm;
    if (activeHeightCm) {
      state.inputHeightCm = activeHeightCm;
      const inputUserHeight = document.getElementById('input-user-height');
      if (inputUserHeight) {
        if (state.useInches) {
          inputUserHeight.value = (activeHeightCm / 2.54).toFixed(1);
        } else {
          inputUserHeight.value = activeHeightCm.toFixed(1);
        }
      }
    }
    
    const sessionPixelsPerCm = activeSession.pixelsPerCm || profile.pixelsPerCm;
    if (sessionPixelsPerCm) {
      state.pixelsPerCm = sessionPixelsPerCm;
      state.calLocked = true;

      const inputPremeasuredScale = document.getElementById('input-premeasured-scale');
      if (inputPremeasuredScale) {
        inputPremeasuredScale.value = state.pixelsPerCm.toFixed(2);
      }
    } else {
      state.pixelsPerCm = null;
      state.calLocked = false;
    }

    const displayMetrics = state.metricsA || state.metricsT || state.metricsOverhead;
    if (displayMetrics) {
      if (renderDashboardFn) renderDashboardFn(displayMetrics);
    } else {
      if (updateDashboardOfflinePlaceholdersFn) updateDashboardOfflinePlaceholdersFn();
    }

    const squatPeakKneeL = document.getElementById('squat-peak-knee-l');
    const squatPeakKneeR = document.getElementById('squat-peak-knee-r');
    const squatPeakHipL = document.getElementById('squat-peak-hip-l');
    const squatPeakHipR = document.getElementById('squat-peak-hip-r');
    const squatPeakAnkleL = document.getElementById('squat-peak-ankle-l');
    const squatPeakAnkleR = document.getElementById('squat-peak-ankle-r');

    if (squatPeakKneeL) squatPeakKneeL.textContent = `${state.squatPeaks.kneeL || 0}°`;
    if (squatPeakKneeR) squatPeakKneeR.textContent = `${state.squatPeaks.kneeR || 0}°`;
    if (squatPeakHipL) squatPeakHipL.textContent = `${state.squatPeaks.hipL || 0}°`;
    if (squatPeakHipR) squatPeakHipR.textContent = `${state.squatPeaks.hipR || 0}°`;
    if (squatPeakAnkleL) squatPeakAnkleL.textContent = `${state.squatPeaks.ankleL || 0}°`;
    if (squatPeakAnkleR) squatPeakAnkleR.textContent = `${state.squatPeaks.ankleR || 0}°`;

    const activeProfileName = document.getElementById('active-profile-name');
    if (activeProfileName) {
      activeProfileName.textContent = profile.name;
    }
    const profileStatusBar = document.getElementById('profile-status-bar');
    if (profileStatusBar) {
      profileStatusBar.classList.remove('hidden');
    }
    const btnDeleteProfile = document.getElementById('btn-delete-profile');
    if (btnDeleteProfile) {
      btnDeleteProfile.classList.remove('hidden');
    }
    const profileActionRow = document.getElementById('profile-action-row');
    if (profileActionRow) {
      profileActionRow.classList.remove('hidden');
    }
    const profileSelect = document.getElementById('profile-select');
    const calProfileSelect = document.getElementById('cal-profile-select');
    if (profileSelect) profileSelect.value = String(profileId);
    if (calProfileSelect) calProfileSelect.value = String(profileId);

    const sessionContainer = document.getElementById('profile-session-select-container');
    const sessionSelect = document.getElementById('profile-session-select');
    if (sessionContainer && sessionSelect) {
      sessionContainer.classList.remove('hidden');
      sessionSelect.innerHTML = '';
      
      profile.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name || `Session (${new Date(s.timestamp).toLocaleDateString()})`;
        if (String(s.id) === String(state.activeSessionId)) {
          opt.selected = true;
        }
        sessionSelect.appendChild(opt);
      });
      
      const newOpt = document.createElement('option');
      newOpt.value = 'new_session';
      newOpt.textContent = 'Create New Session...';
      sessionSelect.appendChild(newOpt);
      
      sessionSelect.value = state.activeSessionId;

      sessionSelect.onchange = async (e) => {
        const val = e.target.value;
        if (val === 'new_session') {
          const newSessionName = prompt("Enter a name for the new session (e.g., 'Set 2 - Post-practice'):");
          if (newSessionName !== null) {
            const nameToUse = newSessionName.trim() || `Session ${profile.sessions.length + 1}`;
            const newSession = {
              id: "session_" + Date.now(),
              name: nameToUse,
              timestamp: Date.now(),
              metricsA: null,
              metricsT: null,
              metricsOverhead: null,
              squatPeaks: getDefaultSquatPeaks(),
              imageA: null,
              imageT: null,
              imageOverhead: null,
              imageSquatL: null,
              imageSquatR: null,
              imageSquatFrontal: null,
              videoSquatL: null,
              videoSquatR: null,
              videoSquatFrontal: null,
              jointsOverhead: null,
              pixelsPerCm: null
            };
            profile.sessions.push(newSession);
            profile.activeSessionId = newSession.id;
            state.activeSessionId = newSession.id;
            await snapshotStore.saveProfile(profile);
            await loadProfileIntoState(profile.id);
          } else {
            sessionSelect.value = state.activeSessionId;
          }
        } else {
          state.activeSessionId = val;
          profile.activeSessionId = val;
          await snapshotStore.saveProfile(profile);
          await loadProfileIntoState(profile.id);
        }
      };
    }

    // Show active left card and hide guest placeholder card
    const leftCard = document.getElementById('left-videos-active-card');
    const guestCard = document.getElementById('left-videos-guest-card');
    if (leftCard && guestCard) {
      leftCard.classList.remove('hidden');
      guestCard.classList.add('hidden');
    }
    await updateProfileUI(profileId, true);

  } catch (err) {
    console.error("[loadProfile] Error loading profile into state:", err);
  }
}

export async function autoSyncToActiveProfile(onlySquat = false) {
  if (!state.activeProfileId || !state.dbInitialized) return;
  try {
    let profile = await snapshotStore.getProfile(state.activeProfileId);
    if (!profile) return;
    
    profile = ensureProfileSessions(profile);
    
    let session = profile.sessions.find(s => String(s.id) === String(state.activeSessionId));
    if (!session) {
      session = profile.sessions.find(s => String(s.id) === String(profile.activeSessionId));
    }
    if (!session) {
      session = profile.sessions[profile.sessions.length - 1];
    }
    
    session.timestamp = Date.now();
    if (state.pixelsPerCm !== null && state.pixelsPerCm !== undefined) session.pixelsPerCm = state.pixelsPerCm;
    
    if (!onlySquat) {
      if (state.metricsA !== undefined && state.metricsA !== null) session.metricsA = state.metricsA;
      if (state.metricsT !== undefined && state.metricsT !== null) session.metricsT = state.metricsT;
      if (state.metricsOverhead !== undefined && state.metricsOverhead !== null) session.metricsOverhead = state.metricsOverhead;
      if (state.imageA !== undefined && state.imageA !== null) session.imageA = state.imageA;
      if (state.imageT !== undefined && state.imageT !== null) session.imageT = state.imageT;
      if (state.imageOverhead !== undefined && state.imageOverhead !== null) session.imageOverhead = state.imageOverhead;
    }
    
    if (state.imageSquatL !== undefined) session.imageSquatL = state.imageSquatL;
    if (state.imageSquatR !== undefined) session.imageSquatR = state.imageSquatR;
    if (state.imageSquatFrontal !== undefined) session.imageSquatFrontal = state.imageSquatFrontal;
    
    if (state.videoSquatL !== undefined) session.videoSquatL = state.videoSquatL;
    if (state.videoSquatR !== undefined) session.videoSquatR = state.videoSquatR;
    if (state.videoSquatFrontal !== undefined) session.videoSquatFrontal = state.videoSquatFrontal;
    if (state.jointsOverhead !== undefined) session.jointsOverhead = state.jointsOverhead;

    if (state.squatPeaks !== undefined) {
      session.squatPeaks = state.squatPeaks ? JSON.parse(JSON.stringify(state.squatPeaks)) : null;
    }

    if (state.imageShoulderLStart !== undefined) session.imageShoulderLStart = state.imageShoulderLStart;
    if (state.imageShoulderLEnd !== undefined) session.imageShoulderLEnd = state.imageShoulderLEnd;
    if (state.imageShoulderRStart !== undefined) session.imageShoulderRStart = state.imageShoulderRStart;
    if (state.imageShoulderREnd !== undefined) session.imageShoulderREnd = state.imageShoulderREnd;
    if (state.imageShoulderRotationL !== undefined) session.imageShoulderRotationL = state.imageShoulderRotationL;
    if (state.imageShoulderRotationR !== undefined) session.imageShoulderRotationR = state.imageShoulderRotationR;
    
    if (state.videoShoulderL !== undefined) session.videoShoulderL = state.videoShoulderL;
    if (state.videoShoulderR !== undefined) session.videoShoulderR = state.videoShoulderR;
    if (state.videoShoulderRotationL !== undefined) session.videoShoulderRotationL = state.videoShoulderRotationL;
    if (state.videoShoulderRotationR !== undefined) session.videoShoulderRotationR = state.videoShoulderRotationR;
    if (state.jointsShoulderL !== undefined) session.jointsShoulderL = state.jointsShoulderL;
    if (state.jointsShoulderR !== undefined) session.jointsShoulderR = state.jointsShoulderR;

    if (state.shoulderPeaks !== undefined) {
      session.shoulderPeaks = state.shoulderPeaks ? JSON.parse(JSON.stringify(state.shoulderPeaks)) : null;
    }

    if (state.shoulderRotation !== undefined) {
      session.shoulderRotation = state.shoulderRotation ? JSON.parse(JSON.stringify(state.shoulderRotation)) : null;
    }

    if (state.hipRotation !== undefined) {
      session.hipRotation = state.hipRotation ? JSON.parse(JSON.stringify(state.hipRotation)) : null;
    }

    if (state.thoracicExtension !== undefined) {
      session.thoracicExtension = state.thoracicExtension ? JSON.parse(JSON.stringify(state.thoracicExtension)) : null;
    }

    if (state.videoThoracicExtension !== undefined) session.videoThoracicExtension = state.videoThoracicExtension;

    if (state.videoHipRotationL !== undefined) session.videoHipRotationL = state.videoHipRotationL;
    if (state.videoHipRotationR !== undefined) session.videoHipRotationR = state.videoHipRotationR;
    if (state.videoAnkleDorsiL !== undefined) session.videoAnkleDorsiL = state.videoAnkleDorsiL;
    if (state.videoAnkleDorsiR !== undefined) session.videoAnkleDorsiR = state.videoAnkleDorsiR;
    if (state.videoThoracicExtension !== undefined) session.videoThoracicExtension = state.videoThoracicExtension;

    if (state.imageHipRotationL !== undefined) session.imageHipRotationL = state.imageHipRotationL;
    if (state.imageHipRotationR !== undefined) session.imageHipRotationR = state.imageHipRotationR;

    profile.metricsA = session.metricsA;
    profile.metricsT = session.metricsT;
    profile.metricsOverhead = session.metricsOverhead;
    profile.squatPeaks = session.squatPeaks;
    profile.shoulderPeaks = session.shoulderPeaks;
    profile.shoulderRotation = session.shoulderRotation;
    profile.hipRotation = session.hipRotation;
    profile.thoracicExtension = session.thoracicExtension;
    profile.imageA = session.imageA;
    profile.imageT = session.imageT;
    profile.imageOverhead = session.imageOverhead;
    profile.imageSquatL = session.imageSquatL;
    profile.imageSquatR = session.imageSquatR;
    profile.imageSquatFrontal = session.imageSquatFrontal;
    profile.imageShoulderLStart = session.imageShoulderLStart;
    profile.imageShoulderLEnd = session.imageShoulderLEnd;
    profile.imageShoulderRStart = session.imageShoulderRStart;
    profile.imageShoulderREnd = session.imageShoulderREnd;
    profile.imageShoulderRotationL = session.imageShoulderRotationL;
    profile.imageShoulderRotationR = session.imageShoulderRotationR;
    profile.imageHipRotationL = session.imageHipRotationL;
    profile.imageHipRotationR = session.imageHipRotationR;
    profile.videoSquatL = session.videoSquatL;
    profile.videoSquatR = session.videoSquatR;
    profile.videoSquatFrontal = session.videoSquatFrontal;
    profile.videoShoulderL = session.videoShoulderL;
    profile.videoShoulderR = session.videoShoulderR;
    profile.videoShoulderRotationL = session.videoShoulderRotationL;
    profile.videoShoulderRotationR = session.videoShoulderRotationR;
    profile.videoHipRotationL = session.videoHipRotationL;
    profile.videoHipRotationR = session.videoHipRotationR;
    profile.videoAnkleDorsiL = session.videoAnkleDorsiL;
    profile.videoAnkleDorsiR = session.videoAnkleDorsiR;
    profile.videoThoracicExtension = session.videoThoracicExtension;
    profile.jointsOverhead = session.jointsOverhead;
    profile.jointsShoulderL = session.jointsShoulderL;
    profile.jointsShoulderR = session.jointsShoulderR;
    profile.pixelsPerCm = session.pixelsPerCm;

    await snapshotStore.saveProfile(profile);
    state.allProfiles = await snapshotStore.getAllProfiles();
  } catch (err) {
    console.error("[autoSync] Error autosaving current session layout inside IndexedDB:", err);
  }
}

export function autoSyncToActiveProfileDebounced() {
  if (state.autoSyncTimer) {
    clearTimeout(state.autoSyncTimer);
  }
  state.autoSyncTimer = setTimeout(() => {
    autoSyncToActiveProfile();
  }, 1000);
}

export async function populateProfileDetails(profileId, container, preserveTab = false) {
  if (!profileId || !container) return;
  if (!profileId) return;

  const mainVideoPlayer = container.querySelector('#profile-details-video-player');
  state.activeModalVideoProcessing = false;
  clearSmoothBuffer('*');
  state.latestPoseResults = null;
  state.latestHandResults = null;
  state.lastModalInferenceSrc = null;

  const uploadedVideo = document.getElementById('uploaded-video');
  if (uploadedVideo) {
    try {
      uploadedVideo.pause();
    } catch (e) {}
  }
  if (!state.containerObjectUrls) {
    state.containerObjectUrls = new Map();
  }
  const globalPlayer = document.getElementById('profile-details-video-player');
  const activePlayingUrl = globalPlayer ? globalPlayer.src : '';
  const existingUrls = state.containerObjectUrls.get(container) || [];
  const keptUrls = [];
  existingUrls.forEach(url => {
    if (activePlayingUrl && activePlayingUrl.includes(url)) {
      keptUrls.push(url);
      return;
    }
    try {
      URL.revokeObjectURL(url);
    } catch (e) {}
  });
  state.containerObjectUrls.set(container, keptUrls);

  if (container && container.id === 'profile-details-modal') {
    state.modalObjectUrls = state.containerObjectUrls.get(container);
  }

  const trackUrl = (url) => {
    if (container) {
      const list = state.containerObjectUrls.get(container);
      if (list && !list.includes(url)) {
        list.push(url);
      }
    }
    if (container && container.id === 'profile-details-modal') {
      state.modalObjectUrls = state.containerObjectUrls.get(container);
    }
  };

  try {
    let profile = await snapshotStore.getProfile(profileId);
    if (!profile) return;

    const originalSessionCount = profile.sessions ? profile.sessions.length : 0;
    profile = ensureProfileSessions(profile);
    if (originalSessionCount === 0) {
      await snapshotStore.saveProfile(profile);
    }

    if (state.activeProfileId === profileId) {
      state.videos = profile.videos || [];
    }

    const userSelect = container.querySelector('#profile-detail-user-select');
    if (userSelect) {
      userSelect.innerHTML = '';
      
      let allProfiles = state.allProfiles || [];
      if (allProfiles.length === 0) {
        allProfiles = await snapshotStore.getAllProfiles();
        state.allProfiles = allProfiles;
      }
      
      allProfiles.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name || `Profile #${p.id}`;
        if (p.id === profileId) {
          option.selected = true;
        }
        userSelect.appendChild(option);
      });

      userSelect.onchange = async (e) => {
        const selectedProfileId = Number(e.target.value);
        state.activeProfileId = selectedProfileId;
        state.activeSessionId = null;
        await loadProfileIntoState(selectedProfileId);
        updateProfileUI(selectedProfileId);
      };
    }

    let activeSession = profile.sessions.find(s => String(s.id) === String(state.activeSessionId));
    if (!activeSession) {
      activeSession = profile.sessions.find(s => String(s.id) === String(profile.activeSessionId));
    }
    if (!activeSession) {
      activeSession = profile.sessions[profile.sessions.length - 1];
    }
    state.activeSessionId = activeSession.id;

    const sessionSelect = container.querySelector('#profile-detail-session-select');
    if (sessionSelect) {
      sessionSelect.innerHTML = '';
      profile.sessions.forEach(sess => {
        const option = document.createElement('option');
        option.value = sess.id;
        option.textContent = sess.name || `Session (${new Date(sess.timestamp).toLocaleDateString()})`;
        if (String(sess.id) === String(activeSession.id)) {
          option.selected = true;
        }
        sessionSelect.appendChild(option);
      });

      sessionSelect.onchange = async (e) => {
        const selectedSessId = e.target.value;
        state.activeSessionId = selectedSessId;
        profile.activeSessionId = selectedSessId;
        await snapshotStore.saveProfile(profile);
        await loadProfileIntoState(profileId);
        updateProfileUI(profileId);
      };
    }

    const modalUnitInchBtn = container.querySelector('#modal-unit-inch-btn');
    const modalUnitCmBtn = container.querySelector('#modal-unit-cm-btn');
    if (modalUnitInchBtn && modalUnitCmBtn) {
      if (state.useInches) {
        modalUnitInchBtn.classList.add('active');
        modalUnitCmBtn.classList.remove('active');
      } else {
        modalUnitInchBtn.classList.remove('active');
        modalUnitCmBtn.classList.add('active');
      }
    }

    const btnNewSession = container.querySelector('#btn-profile-new-session');
    if (btnNewSession) {
      btnNewSession.onclick = async () => {
        const sessionName = prompt("Enter a name for the new session (e.g., 'Set 2 - Post-practice'):");
        if (sessionName === null) return;
        const trimmedName = sessionName.trim() || `Session ${profile.sessions.length + 1}`;

        const newSession = {
          id: "session_" + Date.now(),
          name: trimmedName,
          timestamp: Date.now(),
          pixelsPerCm: profile.pixelsPerCm || null,
          metricsA: null,
          metricsT: null,
          metricsOverhead: null,
          squatPeaks: getDefaultSquatPeaks(),
          shoulderPeaks: getDefaultShoulderPeaks(),
          shoulderRotation: getDefaultShoulderRotation(),
          thoracicExtension: getDefaultThoracicExtension(),
          imageA: null,
          imageT: null,
          imageOverhead: null,
          imageSquatL: null,
          imageSquatR: null,
          imageSquatFrontal: null,
          imageShoulderLStart: null,
          imageShoulderLEnd: null,
          imageShoulderRStart: null,
          imageShoulderREnd: null,
          videoSquatL: null,
          videoSquatR: null,
          videoSquatFrontal: null,
          videoShoulderL: null,
          videoShoulderR: null,
          jointsOverhead: null,
          jointsShoulderL: null,
          jointsShoulderR: null
        };

        profile.sessions.push(newSession);
        profile.activeSessionId = newSession.id;
        state.activeSessionId = newSession.id;

        state.metricsA = null;
        state.metricsT = null;
        state.metricsOverhead = null;
        state.squatPeaks = getDefaultSquatPeaks();
        state.shoulderPeaks = getDefaultShoulderPeaks();
        state.shoulderRotation = getDefaultShoulderRotation();
        state.thoracicExtension = getDefaultThoracicExtension();
        state.imageA = null;
        state.imageT = null;
        state.imageOverhead = null;
        state.imageSquatL = null;
        state.imageSquatR = null;
        state.imageSquatFrontal = null;
        state.imageShoulderLStart = null;
        state.imageShoulderLEnd = null;
        state.imageShoulderRStart = null;
        state.imageShoulderREnd = null;
        state.videoShoulderL = null;
        state.videoShoulderR = null;
        state.jointsOverhead = null;
        state.jointsShoulderL = null;
        state.jointsShoulderR = null;

        await snapshotStore.saveProfile(profile);
        await loadProfileIntoState(profileId);

        alert(`New session "${trimmedName}" started! Dashboard metrics are reset for fresh video captures.`);
        updateProfileUI(profileId);
      };
    }

    const btnRenameSession = container.querySelector('#btn-profile-rename-session');
    if (btnRenameSession) {
      btnRenameSession.onclick = async () => {
        const currentSessionName = activeSession.name || `Session (${new Date(activeSession.timestamp).toLocaleDateString()})`;
        const newName = prompt("Enter new name for this session:", currentSessionName);
        if (newName === null) return;
        const trimmedName = newName.trim();
        if (!trimmedName) {
          alert("Session name cannot be empty.");
          return;
        }

        try {
          const freshProfile = await snapshotStore.getProfile(profileId);
          if (freshProfile) {
            const freshProfileMigrated = ensureProfileSessions(freshProfile);
            const freshActiveSession = freshProfileMigrated.sessions.find(s => String(s.id) === String(activeSession.id));
            if (freshActiveSession) {
              freshActiveSession.name = trimmedName;
              await snapshotStore.saveProfile(freshProfileMigrated);
              
              state.allProfiles = await snapshotStore.getAllProfiles();
              if (state.activeProfileId === profileId) {
                await loadProfileIntoState(profileId);
              }
              
              alert(`Session renamed to "${trimmedName}" successfully!`);
              updateProfileUI(profileId);
            }
          }
        } catch (err) {
          console.error("[SessionRename] Failed to rename session:", err);
          alert("Failed to rename session: " + err.message);
        }
      };
    }

    const detailName = container.querySelector('#profile-detail-name');
    const detailScale = container.querySelector('#profile-detail-scale');
    const detailLastSession = container.querySelector('#profile-detail-last-session');
    
    if (detailName) {
      detailName.innerHTML = `
        ${profile.name || "Anonymous Subject"} 
        <button class="btn btn-rename-profile" title="Rename Profile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
      `;
      
      const renameProfileBtn = detailName.querySelector('.btn-rename-profile');
      if (renameProfileBtn) {
        renameProfileBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const currentName = profile.name || "Anonymous Subject";
          const newName = prompt("Enter new profile name:", currentName);
          if (newName === null) return;
          const trimmedName = newName.trim();
          if (!trimmedName) {
            alert("Profile name cannot be empty.");
            return;
          }
          if (trimmedName.toLowerCase() !== currentName.toLowerCase()) {
            const isDuplicate = state.allProfiles.some(p => p.name.toLowerCase() === trimmedName.toLowerCase());
            if (isDuplicate) {
              alert(`A profile named "${trimmedName}" already exists. Please choose a different name.`);
              return;
            }
          }
          try {
            const freshProfile = await snapshotStore.getProfile(profileId);
            if (freshProfile) {
              freshProfile.name = trimmedName;
              await snapshotStore.saveProfile(freshProfile);
              state.allProfiles = await snapshotStore.getAllProfiles();
              
              const profileSelect = document.getElementById('profile-select');
              const calProfileSelect = document.getElementById('cal-profile-select');
              if (profileSelect) {
                const opt = [...profileSelect.options].find(o => Number(o.value) === profileId);
                if (opt) opt.textContent = trimmedName;
              }
              if (calProfileSelect) {
                const opt = [...calProfileSelect.options].find(o => Number(o.value) === profileId);
                if (opt) opt.textContent = trimmedName;
              }
              
              if (state.activeProfileId === profileId) {
                const activeProfileName = document.getElementById('active-profile-name');
                if (activeProfileName) activeProfileName.textContent = trimmedName;
              }
              
              updateProfileUI(profileId);
            }
          } catch (err) {
            console.error("[ProfileRename] Failed to rename profile:", err);
          }
        });
      }
    }

    const sessionPixelsPerCm = activeSession.pixelsPerCm || profile.pixelsPerCm;
    if (detailScale) {
      detailScale.textContent = sessionPixelsPerCm 
        ? `Calibration: ${sessionPixelsPerCm.toFixed(2)} px/cm` 
        : "Calibration: Uncalibrated";
    }
    if (detailLastSession) {
      const ts = activeSession.timestamp || profile.timestamp;
      if (ts) {
        const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        detailLastSession.textContent = `Session Date: ${new Date(ts).toLocaleDateString(undefined, options)}`;
      } else {
        detailLastSession.textContent = "Session Date: --";
      }
    }

    const poses = [
      { key: 'a', metricsKey: 'metricsA', imgKey: 'imageA', title: 'A-Pose (Stature)', color: 'var(--color-scarlet)' },
      { key: 't', metricsKey: 'metricsT', imgKey: 'imageT', title: 'T-Pose (Wingspan)', color: 'var(--color-cyan)' },
      { key: 'overhead', metricsKey: 'metricsOverhead', imgKey: 'imageOverhead', title: 'Overhead (Reach)', color: '#d4a017' },
      { key: 'squat-l', metricsKey: 'squatPeaks', imgKey: 'imageSquatL', title: 'Left Overhead Squat', color: '#9333ea', isSquat: true, squatSide: 'kneeL' },
      { key: 'squat-r', metricsKey: 'squatPeaks', imgKey: 'imageSquatR', title: 'Right Overhead Squat', color: '#a855f7', isSquat: true, squatSide: 'kneeR' },
      { key: 'squat-frontal', metricsKey: 'squatPeaks', imgKey: 'imageSquatFrontal', title: 'Frontal Overhead Squat', color: '#ec4899', isSquat: true, squatSide: 'frontal' },
      { key: 'shoulder-l', metricsKey: 'shoulderPeaks', imgKey: 'imageShoulderLStart', title: 'Left Shoulder Flexion', color: '#BA0C2F', isShoulder: true },
      { key: 'shoulder-r', metricsKey: 'shoulderPeaks', imgKey: 'imageShoulderRStart', title: 'Right Shoulder Flexion', color: '#BA0C2F', isShoulder: true },
      { key: 'shoulder-rotation-l', metricsKey: 'shoulderRotation', imgKey: 'imageShoulderRotationL', title: 'Left Shoulder Rotation', color: '#00e5ff', isShoulderRotation: true },
      { key: 'shoulder-rotation-r', metricsKey: 'shoulderRotation', imgKey: 'imageShoulderRotationR', title: 'Right Shoulder Rotation', color: '#00e5ff', isShoulderRotation: true },
      { key: 'hip-rotation-l', metricsKey: 'hipRotation', imgKey: 'imageHipRotationL', title: 'Left Hip Rotation', color: '#10b981', isHipRotation: true },
      { key: 'hip-rotation-r', metricsKey: 'hipRotation', imgKey: 'imageHipRotationR', title: 'Right Hip Rotation', color: '#10b981', isHipRotation: true },
      { key: 'ankle-dorsi-l', metricsKey: 'ankleDorsiPeaks', imgKey: 'imageAnkleDorsi', title: 'Left Ankle Dorsiflexion', color: '#10b981', isAnkleDorsi: true },
      { key: 'ankle-dorsi-r', metricsKey: 'ankleDorsiPeaks', imgKey: 'imageAnkleDorsi', title: 'Right Ankle Dorsiflexion', color: '#10b981', isAnkleDorsi: true },
      { key: 'thoracic-extension', metricsKey: 'thoracicExtension', imgKey: 'imageThoracicExtension', title: 'Thoracic Extension', color: '#d4a017', isThoracicExtension: true }
    ];

    poses.forEach(p => {
      const statusEl = container.querySelector(`#detail-status-${p.key}`);
      const imgEl = container.querySelector(`#detail-preview-img-${p.key}`);
      const containerEl = container.querySelector(`#detail-preview-container-${p.key}`);
      
      let hasData = false;
      let imgSrc = activeSession[p.imgKey] || null;
      let hasVideo = false;

      if (p.isSquat) {
        const videoKey = p.key === 'squat-l' ? 'videoSquatL' : (p.key === 'squat-r' ? 'videoSquatR' : 'videoSquatFrontal');
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);

        let hasPeaks = false;
        if (activeSession.squatPeaks) {
          console.log('[DEBUG-SQUAT-L] squatPeaks:', JSON.stringify(activeSession.squatPeaks), 'kneeL:', activeSession.squatPeaks.kneeL, 'kneeLTime:', activeSession.squatPeaks.kneeLTime, 'hipL:', activeSession.squatPeaks.hipL, 'ankleL:', activeSession.squatPeaks.ankleL);
          if (p.key === 'squat-l') {
            hasPeaks = (activeSession.squatPeaks.kneeL > 0 || activeSession.squatPeaks.kneeLTime > 0 || activeSession.squatPeaks.hipL > 0 || activeSession.squatPeaks.ankleL > 0);
          } else if (p.key === 'squat-r') {
            hasPeaks = (activeSession.squatPeaks.kneeR > 0 || activeSession.squatPeaks.kneeRTime > 0 || activeSession.squatPeaks.hipR > 0 || activeSession.squatPeaks.ankleR > 0);
          } else if (p.key === 'squat-frontal') {
            hasPeaks = (activeSession.squatPeaks.maxKneeCaveL > 0 || activeSession.squatPeaks.maxKneeCaveR > 0 || (activeSession.squatPeaks.maxKneeBowL || 0) > 0 || (activeSession.squatPeaks.maxKneeBowR || 0) > 0);
          }
        }
        hasData = !!imgSrc || hasVideo || hasPeaks;
      } else if (p.isShoulder) {
        const videoKey = p.key === 'shoulder-l' ? 'videoShoulderL' : 'videoShoulderR';
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);
        
        let hasShoulderPeaks = false;
        if (activeSession.shoulderPeaks) {
          if (p.key === 'shoulder-l') {
            hasShoulderPeaks = (activeSession.shoulderPeaks.excursionL > 0 || activeSession.shoulderPeaks.startAngleL !== null || activeSession.shoulderPeaks.endAngleL !== null);
          } else {
            hasShoulderPeaks = (activeSession.shoulderPeaks.excursionR > 0 || activeSession.shoulderPeaks.startAngleR !== null || activeSession.shoulderPeaks.endAngleR !== null);
          }
        }
        hasData = !!imgSrc || hasVideo || hasShoulderPeaks;
      } else if (p.isShoulderRotation) {
        const videoKey = p.key === 'shoulder-rotation-l' ? 'videoShoulderRotationL' : 'videoShoulderRotationR';
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);
        
        let hasShoulderRotationPeaks = false;
        if (activeSession.shoulderRotation) {
          if (p.key === 'shoulder-rotation-l') {
            hasShoulderRotationPeaks = (activeSession.shoulderRotation.maxExternalRotationL > 0 || activeSession.shoulderRotation.maxInternalRotationL > 0);
          } else {
            hasShoulderRotationPeaks = (activeSession.shoulderRotation.maxExternalRotationR > 0 || activeSession.shoulderRotation.maxInternalRotationR > 0);
          }
        }
        hasData = !!imgSrc || hasVideo || hasShoulderRotationPeaks;
      } else if (p.isHipRotation) {
        const videoKey = p.key === 'hip-rotation-l' ? 'videoHipRotationL' : 'videoHipRotationR';
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);
        
        let hasHipRotationPeaks = false;
        if (activeSession.hipRotation) {
          if (p.key === 'hip-rotation-l') {
            hasHipRotationPeaks = (activeSession.hipRotation.maxExternalRotationL > 0 || activeSession.hipRotation.maxInternalRotationL > 0);
          } else {
            hasHipRotationPeaks = (activeSession.hipRotation.maxExternalRotationR > 0 || activeSession.hipRotation.maxInternalRotationR > 0);
          }
        }
        hasData = !!imgSrc || hasVideo || hasHipRotationPeaks;
      } else if (p.isAnkleDorsi) {
        const videoKey = p.key === 'ankle-dorsi-l' ? 'videoAnkleDorsiL' : 'videoAnkleDorsiR';
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);
        
        let hasAnklePeaks = false;
        if (activeSession.ankleDorsiPeaks) {
          if (p.key === 'ankle-dorsi-l') {
            hasAnklePeaks = (activeSession.ankleDorsiPeaks.ankleDorsiL > 0 || activeSession.ankleDorsiPeaks.shinAngleL > 0);
          } else {
            hasAnklePeaks = (activeSession.ankleDorsiPeaks.ankleDorsiR > 0 || activeSession.ankleDorsiPeaks.shinAngleR > 0);
          }
        }
        hasData = !!imgSrc || hasVideo || hasAnklePeaks;
      } else if (p.isThoracicExtension) {
        const videoKey = 'videoThoracicExtension';
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);
        let hasThoracicPeaks = !!(activeSession.thoracicExtension && activeSession.thoracicExtension.peakAngle > 0);
        hasData = !!imgSrc || hasVideo || hasThoracicPeaks;
      } else {
        hasData = !!imgSrc || !!activeSession[p.metricsKey];
      }

      if (hasData) {
        if (statusEl) {
          statusEl.textContent = "Complete";
          statusEl.className = 'text-emerald';
        }
        if (containerEl) {
          containerEl.classList.remove('hidden');
          containerEl.innerHTML = '';

          if ((p.isSquat || p.isShoulderRotation || p.isHipRotation || p.isAnkleDorsi || p.isThoracicExtension) && hasVideo) {
            const videoKey = p.key === 'squat-l' ? 'videoSquatL' : 
                             (p.key === 'squat-r' ? 'videoSquatR' : 
                             (p.key === 'squat-frontal' ? 'videoSquatFrontal' : 
                             (p.key === 'shoulder-rotation-l' ? 'videoShoulderRotationL' : 
                             (p.key === 'shoulder-rotation-r' ? 'videoShoulderRotationR' : 
                             (p.key === 'hip-rotation-l' ? 'videoHipRotationL' : 
                             (p.key === 'hip-rotation-r' ? 'videoHipRotationR' : 
                             (p.key === 'ankle-dorsi-l' ? 'videoAnkleDorsiL' : 
                             (p.key === 'ankle-dorsi-r' ? 'videoAnkleDorsiR' : 'videoThoracicExtension'))))))));
            const sVideo = activeSession[videoKey];
            const safeBlob = getSafeVideoBlob(sVideo);
            const videoUrl = safeBlob ? URL.createObjectURL(safeBlob) : '';
            trackUrl(videoUrl);

            const cardWrapper = document.createElement('div');
            cardWrapper.className = 'premium-video-preview-card';
            cardWrapper.style.cssText = 'position: relative; width: 100%; max-height: 120px; aspect-ratio: 16/9; overflow: hidden; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); background: #000; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);';

            const previewVideo = document.createElement('video');
            previewVideo.src = videoUrl;
            previewVideo.muted = true;
            previewVideo.playsInline = true;
            previewVideo.style.cssText = 'width: 100%; height: 100%; object-fit: cover; filter: brightness(0.65) contrast(1.05); transition: all 0.3s ease; pointer-events: none;';
            
            previewVideo.addEventListener('loadedmetadata', () => {
              previewVideo.currentTime = Math.min(0.5, previewVideo.duration / 2);
            });

            const playOverlay = document.createElement('div');
            playOverlay.className = 'play-overlay-button';
            playOverlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: rgba(15, 22, 38, 0.45); backdrop-filter: blur(1px); transition: all 0.3s ease;';

            playOverlay.innerHTML = `
              <div class="glowing-play-circle" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(0, 229, 255, 0.08); border: 1.5px solid #00e5ff; display: flex; align-items: center; justify-content: center; color: #00e5ff; font-size: 11px; font-weight: bold; text-shadow: 0 0 5px rgba(0, 229, 255, 0.5); transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); transform: scale(1);">
                ▶
              </div>
              <span class="glowing-play-label" style="font-size: 9px; font-weight: 700; color: #a7b1b7; letter-spacing: 0.8px; text-transform: uppercase;">Review Video</span>
            `;

            cardWrapper.appendChild(previewVideo);
            cardWrapper.appendChild(playOverlay);
            containerEl.appendChild(cardWrapper);

            cardWrapper.addEventListener('mouseenter', () => {
              cardWrapper.style.transform = 'translateY(-2px)';
              cardWrapper.style.borderColor = '#00e5ff';
              cardWrapper.style.boxShadow = '0 4px 12px rgba(0, 229, 255, 0.15)';
              previewVideo.style.filter = 'brightness(0.85) contrast(1.02)';
              const circle = playOverlay.querySelector('.glowing-play-circle');
              if (circle) {
                circle.style.transform = 'scale(1.12)';
                circle.style.background = '#00e5ff';
                circle.style.color = '#0b0f19';
                circle.style.boxShadow = '0 0 15px #00e5ff';
              }
            });

            cardWrapper.addEventListener('mouseleave', () => {
              cardWrapper.style.transform = 'translateY(0)';
              cardWrapper.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              cardWrapper.style.boxShadow = 'none';
              previewVideo.style.filter = 'brightness(0.65) contrast(1.05)';
              const circle = playOverlay.querySelector('.glowing-play-circle');
              if (circle) {
                circle.style.transform = 'scale(1)';
                circle.style.background = 'rgba(0, 229, 255, 0.08)';
                circle.style.color = '#00e5ff';
                circle.style.boxShadow = 'none';
              }
            });

            cardWrapper.addEventListener('click', (e) => {
              e.stopPropagation();
              if (window.expandLightboxVideo) {
                window.expandLightboxVideo(videoUrl, `${p.title} Video Capture`);
              }
            });
          } else if (p.isShoulder) {
            if (imgSrc) {
              const myImgEl = document.createElement('img');
              myImgEl.src = imgSrc;
              myImgEl.alt = `${p.title} Preview`;
              myImgEl.style.cssText = 'width: 100%; height: auto; max-height: 120px; object-fit: contain; display: block; border-radius: 4px; cursor: pointer; transition: transform 0.2s, border-color 0.2s;';
              myImgEl.onmouseover = () => {
                myImgEl.style.transform = 'scale(1.02)';
                myImgEl.style.borderColor = 'rgba(0, 229, 255, 0.45)';
              };
              myImgEl.onmouseout = () => {
                myImgEl.style.transform = 'scale(1)';
                myImgEl.style.borderColor = 'rgba(255,255,255,0.05)';
              };
              myImgEl.onclick = (e) => {
                e.stopPropagation();
                if (window.expandLightboxImage) {
                  window.expandLightboxImage(imgSrc, `${p.title} Snapshot`);
                }
              };
              containerEl.appendChild(myImgEl);
            }
            
            const videoKey = p.key === 'shoulder-l' ? 'videoShoulderL' : 'videoShoulderR';
            const sVideo = activeSession[videoKey];
            if (sVideo && sVideo.blob) {
              const safeBlob = getSafeVideoBlob(sVideo);
              const videoUrl = safeBlob ? URL.createObjectURL(safeBlob) : '';
              trackUrl(videoUrl);

              const playOverlayBtn = document.createElement('button');
              playOverlayBtn.className = 'btn';
              playOverlayBtn.textContent = '▶ Play Video Playout';
              playOverlayBtn.style.cssText = 'width: 100%; margin-top: 6px; padding: 4px 8px; font-size: 0.75rem; border-radius: 4px; font-weight: 600; cursor: pointer; background: rgba(0, 229, 255, 0.1); border: 1px solid rgba(0, 229, 255, 0.25); color: #00e5ff;';
              
              playOverlayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.expandLightboxVideo) {
                  window.expandLightboxVideo(videoUrl, `${p.title} Video Capture`);
                }
              });
              containerEl.appendChild(playOverlayBtn);
            }
          } else if (imgSrc) {
            const myImgEl = document.createElement('img');
            myImgEl.src = imgSrc;
            myImgEl.alt = `${p.title} Preview`;
            myImgEl.style.cssText = 'width: 100%; height: auto; max-height: 120px; object-fit: contain; display: block; border-radius: 4px;';
            containerEl.appendChild(myImgEl);
          } else {
            containerEl.classList.add('hidden');
          }
        }

        const deleteBtn = container.querySelector(`#btn-delete-pose-${p.key}`);
        if (deleteBtn) {
          deleteBtn.classList.remove('hidden');
          deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm(`Are you sure you want to permanently delete all data (image, video, metrics) for ${p.title}? This cannot be undone.`)) {
              return;
            }
            try {
              const freshProfile = await snapshotStore.getProfile(profileId);
              if (!freshProfile) return;
              
              const freshProfileMigrated = ensureProfileSessions(freshProfile);
              const freshActiveSession = freshProfileMigrated.sessions.find(s => String(s.id) === String(activeSession.id)) || freshProfileMigrated.sessions[0];
              
              freshActiveSession[p.imgKey] = null;
              
              if (p.isSquat) {
                const videoKey = p.key === 'squat-l' ? 'videoSquatL' : (p.key === 'squat-r' ? 'videoSquatR' : 'videoSquatFrontal');
                const sVideo = freshActiveSession[videoKey];
                if (sVideo) {
                   freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                   freshActiveSession[videoKey] = null;
                }
                
                if (freshActiveSession.squatPeaks) {
                  if (p.key === 'squat-l') {
                    freshActiveSession.squatPeaks.kneeL = 0;
                    freshActiveSession.squatPeaks.kneeLTime = 0;
                    freshActiveSession.squatPeaks.hipL = 0;
                    freshActiveSession.squatPeaks.ankleL = 0;
                  } else if (p.key === 'squat-r') {
                    freshActiveSession.squatPeaks.kneeR = 0;
                    freshActiveSession.squatPeaks.kneeRTime = 0;
                    freshActiveSession.squatPeaks.hipR = 0;
                    freshActiveSession.squatPeaks.ankleR = 0;
                  } else if (p.key === 'squat-frontal') {
                    freshActiveSession.squatPeaks.maxKneeCaveL = 0;
                    freshActiveSession.squatPeaks.maxKneeCaveR = 0;
                    freshActiveSession.squatPeaks.maxKneeBowL = 0;
                    freshActiveSession.squatPeaks.maxKneeBowR = 0;
                    freshActiveSession.jointsOverhead = null;
                  }
                }
              } else if (p.isShoulder) {
                const videoKey = p.key === 'shoulder-l' ? 'videoShoulderL' : 'videoShoulderR';
                const sVideo = freshActiveSession[videoKey];
                if (sVideo) {
                  freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                  freshActiveSession[videoKey] = null;
                }

                if (p.key === 'shoulder-l') {
                  freshActiveSession.imageShoulderLStart = null;
                  freshActiveSession.imageShoulderLEnd = null;
                  if (freshActiveSession.shoulderPeaks) {
                    freshActiveSession.shoulderPeaks.excursionL = 0;
                    freshActiveSession.shoulderPeaks.startAngleL = null;
                    freshActiveSession.shoulderPeaks.endAngleL = null;
                    freshActiveSession.shoulderPeaks.jointsL = null;
                  }
                } else {
                  freshActiveSession.imageShoulderRStart = null;
                  freshActiveSession.imageShoulderREnd = null;
                  if (freshActiveSession.shoulderPeaks) {
                    freshActiveSession.shoulderPeaks.excursionR = 0;
                    freshActiveSession.shoulderPeaks.startAngleR = null;
                    freshActiveSession.shoulderPeaks.endAngleR = null;
                    freshActiveSession.shoulderPeaks.jointsR = null;
                  }
                }
              } else if (p.isShoulderRotation) {
                const videoKey = p.key === 'shoulder-rotation-l' ? 'videoShoulderRotationL' : 'videoShoulderRotationR';
                const sVideo = freshActiveSession[videoKey];
                if (sVideo) {
                  freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                  freshActiveSession[videoKey] = null;
                }

                if (p.key === 'shoulder-rotation-l') {
                  freshActiveSession.imageShoulderRotationL = null;
                  if (freshActiveSession.shoulderRotation) {
                    freshActiveSession.shoulderRotation.maxExternalRotationL = 0;
                    freshActiveSession.shoulderRotation.maxInternalRotationL = 0;
                    freshActiveSession.shoulderRotation.timeSeriesL = [];
                  }
                } else {
                  freshActiveSession.imageShoulderRotationR = null;
                  if (freshActiveSession.shoulderRotation) {
                    freshActiveSession.shoulderRotation.maxExternalRotationR = 0;
                    freshActiveSession.shoulderRotation.maxInternalRotationR = 0;
                    freshActiveSession.shoulderRotation.timeSeriesR = [];
                  }
                }
              } else if (p.isHipRotation) {
                const videoKey = p.key === 'hip-rotation-l' ? 'videoHipRotationL' : 'videoHipRotationR';
                const sVideo = freshActiveSession[videoKey];
                if (sVideo) {
                  freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                  freshActiveSession[videoKey] = null;
                }

                if (p.key === 'hip-rotation-l') {
                  freshActiveSession.imageHipRotationL = null;
                  if (freshActiveSession.hipRotation) {
                    freshActiveSession.hipRotation.maxExternalRotationL = 0;
                    freshActiveSession.hipRotation.maxInternalRotationL = 0;
                    freshActiveSession.hipRotation.timeSeriesL = [];
                  }
                } else {
                  freshActiveSession.imageHipRotationR = null;
                  if (freshActiveSession.hipRotation) {
                    freshActiveSession.hipRotation.maxExternalRotationR = 0;
                    freshActiveSession.hipRotation.maxInternalRotationR = 0;
                    freshActiveSession.hipRotation.timeSeriesR = [];
                  }
                }
              } else if (p.isThoracicExtension) {
                const sVideo = freshActiveSession.videoThoracicExtension;
                if (sVideo) {
                  freshProfileMigrated.videos = (freshProfileMigrated.videos || []).filter(v => v.id !== sVideo.id);
                  freshActiveSession.videoThoracicExtension = null;
                }
                freshActiveSession.imageThoracicExtension = null;
                if (freshActiveSession.thoracicExtension) {
                  freshActiveSession.thoracicExtension.peakAngle = 0;
                  freshActiveSession.thoracicExtension.liveAngle = 0;
                }
              } else {
                freshActiveSession[p.metricsKey] = null;
              }
              
              freshProfileMigrated.metricsA = freshActiveSession.metricsA;
              freshProfileMigrated.metricsT = freshActiveSession.metricsT;
              freshProfileMigrated.metricsOverhead = freshActiveSession.metricsOverhead;
              freshProfileMigrated.squatPeaks = freshActiveSession.squatPeaks;
              freshProfileMigrated.shoulderPeaks = freshActiveSession.shoulderPeaks;
              freshProfileMigrated.shoulderRotation = freshActiveSession.shoulderRotation;
              freshProfileMigrated.hipRotation = freshActiveSession.hipRotation;
              freshProfileMigrated.thoracicExtension = freshActiveSession.thoracicExtension;
              freshProfileMigrated.imageA = freshActiveSession.imageA;
              freshProfileMigrated.imageT = freshActiveSession.imageT;
              freshProfileMigrated.imageOverhead = freshActiveSession.imageOverhead;
              freshProfileMigrated.imageSquatL = freshActiveSession.imageSquatL;
              freshProfileMigrated.imageSquatR = freshActiveSession.imageSquatR;
              freshProfileMigrated.imageSquatFrontal = freshActiveSession.imageSquatFrontal;
              freshProfileMigrated.imageShoulderLStart = freshActiveSession.imageShoulderLStart;
              freshProfileMigrated.imageShoulderLEnd = freshActiveSession.imageShoulderLEnd;
              freshProfileMigrated.imageShoulderRStart = freshActiveSession.imageShoulderRStart;
              freshProfileMigrated.imageShoulderREnd = freshActiveSession.imageShoulderREnd;
              freshProfileMigrated.imageShoulderRotationL = freshActiveSession.imageShoulderRotationL;
              freshProfileMigrated.imageShoulderRotationR = freshActiveSession.imageShoulderRotationR;
              freshProfileMigrated.imageHipRotationL = freshActiveSession.imageHipRotationL || null;
              freshProfileMigrated.imageHipRotationR = freshActiveSession.imageHipRotationR || null;
              freshProfileMigrated.jointsOverhead = freshActiveSession.jointsOverhead || null;
              freshProfileMigrated.jointsShoulderL = freshActiveSession.jointsShoulderL || null;
              freshProfileMigrated.jointsShoulderR = freshActiveSession.jointsShoulderR || null;
              
              await snapshotStore.saveProfile(freshProfileMigrated);
              state.allProfiles = await snapshotStore.getAllProfiles();
              if (state.activeProfileId === profileId) {
                await loadProfileIntoState(profileId);
              }
              
              alert(`${p.title} data deleted successfully.`);
              updateProfileUI(profileId);
            } catch (err) {
              console.error(`[DeletePoseData] Failed to delete data for ${p.key}:`, err);
              alert("Failed to delete posture data: " + err.message);
            }
          };
        }
      } else {
        if (statusEl) {
          statusEl.textContent = "Missing";
          statusEl.className = 'text-red';
        }
        if (containerEl) containerEl.classList.add('hidden');
        if (imgEl) imgEl.src = "";

        const deleteBtn = container.querySelector(`#btn-delete-pose-${p.key}`);
        if (deleteBtn) {
          deleteBtn.classList.add('hidden');
          deleteBtn.onclick = null;
        }
      }
    });

    const mA = activeSession.metricsA || {};
    const mT = activeSession.metricsT || {};
    const mO = activeSession.metricsOverhead || {};

    const getVal = (poseKey, metricKey, fallbackSources) => {
      let rawVal = null;
      if (poseKey === 'a') rawVal = mA[metricKey];
      else if (poseKey === 't') rawVal = mT[metricKey];
      else if (poseKey === 'overhead') rawVal = mO[metricKey];

      if (rawVal !== null && rawVal !== undefined) return rawVal;

      if (fallbackSources) {
        for (const srcKey of fallbackSources) {
          const src = srcKey === 'a' ? mA : (srcKey === 't' ? mT : mO);
          if (src && src[metricKey] !== null && src[metricKey] !== undefined) {
            return src[metricKey];
          }
        }
      }
      return null;
    };

    const getValPair = (poseKey, leftKey, rightKey, fallbackSources) => {
      let rawL = null, rawR = null;
      if (poseKey === 'a') {
        rawL = mA[leftKey];
        rawR = mA[rightKey];
      } else if (poseKey === 't') {
        rawL = mT[leftKey];
        rawR = mT[rightKey];
      } else if (poseKey === 'overhead') {
        rawL = mO[leftKey];
        rawR = mO[rightKey];
      }

      let finalL = (rawL !== null && rawL !== undefined) ? rawL : null;
      let finalR = (rawR !== null && rawR !== undefined) ? rawR : null;

      if (finalL === null && fallbackSources) {
        for (const srcKey of fallbackSources) {
          const src = srcKey === 'a' ? mA : (srcKey === 't' ? mT : mO);
          if (src && src[leftKey] !== null && src[leftKey] !== undefined) {
            finalL = src[leftKey];
            break;
          }
        }
      }
      if (finalR === null && fallbackSources) {
        for (const srcKey of fallbackSources) {
          const src = srcKey === 'a' ? mA : (srcKey === 't' ? mT : mO);
          if (src && src[rightKey] !== null && src[rightKey] !== undefined) {
            finalR = src[rightKey];
            break;
          }
        }
      }
      return [finalL, finalR];
    };

    const formatPair = (left, right) => {
      if ((left === null || left === undefined) && (right === null || right === undefined)) return '--';
      return `L: ${formatLength(left)} / R: ${formatLength(right)}`;
    };

    const formatSingle = (val) => {
      if (val === null || val === undefined) return '--';
      return formatLength(val);
    };

    const renderCellSingle = (poseKey, metricKey, val) => {
      if (!state.isEditingProfileMetrics) {
        return formatSingle(val);
      }
      let displayVal = "";
      if (val !== null && val !== undefined && !isNaN(val)) {
        displayVal = state.useInches ? (val / 2.54).toFixed(1) : val.toFixed(1);
      }
      const suffix = state.useInches ? "in" : "cm";
      return `
        <div class="profile-cell-flex">
          <input type="number" step="0.1" min="0" class="profile-edit-input single" 
                 data-pose="${poseKey}" data-key="${metricKey}" 
                 value="${displayVal}" placeholder="--">
          <span class="profile-unit-suffix">${suffix}</span>
        </div>
      `;
    };

    const renderCellPair = (poseKey, leftMetricKey, rightMetricKey, leftVal, rightVal) => {
      if (!state.isEditingProfileMetrics) {
        return formatPair(leftVal, rightVal);
      }
      let displayLeft = "";
      if (leftVal !== null && leftVal !== undefined && !isNaN(leftVal)) {
        displayLeft = state.useInches ? (leftVal / 2.54).toFixed(1) : leftVal.toFixed(1);
      }
      let displayRight = "";
      if (rightVal !== null && rightVal !== undefined && !isNaN(rightVal)) {
        displayRight = state.useInches ? (rightVal / 2.54).toFixed(1) : rightVal.toFixed(1);
      }
      const suffix = state.useInches ? "in" : "cm";
      return `
        <div class="profile-cell-flex-col">
          <div class="profile-cell-flex">
            <span class="profile-side-label">L:</span>
            <input type="number" step="0.1" min="0" class="profile-edit-input pair" 
                   data-pose="${poseKey}" data-key="${leftMetricKey}" 
                   value="${displayLeft}" placeholder="--">
            <span class="profile-unit-suffix">${suffix}</span>
          </div>
          <div class="profile-cell-flex">
            <span class="profile-side-label">R:</span>
            <input type="number" step="0.1" min="0" class="profile-edit-input pair" 
                   data-pose="${poseKey}" data-key="${rightMetricKey}" 
                   value="${displayRight}" placeholder="--">
            <span class="profile-unit-suffix">${suffix}</span>
          </div>
        </div>
      `;
    };

    const renderSquatPeakEdit = (jointKey, valL, valR) => {
      if (!state.isEditingProfileMetrics) {
        return `${valL || 0}° / ${valR || 0}°`;
      }
      return `
        <div class="profile-cell-flex-center">
          <span class="profile-squat-label">L:</span>
          <input type="number" step="1" min="0" max="180" class="profile-squat-edit-input profile-edit-input squat" 
                 data-joint="${jointKey}" data-side="L" 
                 value="${valL || 0}">
          <span class="profile-deg-suffix">°</span>
          <span class="profile-squat-label right">R:</span>
          <input type="number" step="1" min="0" max="180" class="profile-squat-edit-input profile-edit-input squat" 
                 data-joint="${jointKey}" data-side="R" 
                 value="${valR || 0}">
          <span class="profile-deg-suffix">°</span>
        </div>
      `;
    };

    const thA = container.querySelector('#detail-table-height-a');
    const thT = container.querySelector('#detail-table-height-t');
    const thO = container.querySelector('#detail-table-height-overhead');
    if (thA) thA.innerHTML = renderCellSingle('a', 'skeletal_height', getVal('a', 'skeletal_height', ['t', 'overhead']));
    if (thT) thT.innerHTML = renderCellSingle('t', 'skeletal_height', getVal('t', 'skeletal_height', ['a', 'overhead']));
    if (thO) thO.innerHTML = renderCellSingle('overhead', 'skeletal_height', getVal('overhead', 'skeletal_height', ['a', 't']));

    const twA = container.querySelector('#detail-table-wingspan-a');
    const twT = container.querySelector('#detail-table-wingspan-t');
    const twO = container.querySelector('#detail-table-wingspan-overhead');
    if (twA) twA.innerHTML = renderCellSingle('a', 'wingspan', getVal('a', 'wingspan', ['t', 'overhead']));
    if (twT) twT.innerHTML = renderCellSingle('t', 'wingspan', getVal('t', 'wingspan', ['a', 'overhead']));
    if (twO) {
      const [reachL, reachR] = getValPair('overhead', 'fingerToToeL', 'fingerToToeR', ['a', 't']);
      twO.innerHTML = renderCellPair('overhead', 'fingerToToeL', 'fingerToToeR', reachL, reachR);
    }

    const ttA = container.querySelector('#detail-table-torso-a');
    const ttT = container.querySelector('#detail-table-torso-t');
    const ttO = container.querySelector('#detail-table-torso-overhead');
    if (ttA) {
      const [valL, valR] = getValPair('a', 'torso_l', 'torso_r', ['t', 'overhead']);
      ttA.innerHTML = renderCellPair('a', 'torso_l', 'torso_r', valL, valR);
    }
    if (ttT) {
      const [valL, valR] = getValPair('t', 'torso_l', 'torso_r', ['a', 'overhead']);
      ttT.innerHTML = renderCellPair('t', 'torso_l', 'torso_r', valL, valR);
    }
    if (ttO) {
      const [valL, valR] = getValPair('overhead', 'torso_l', 'torso_r', ['a', 't']);
      ttO.innerHTML = renderCellPair('overhead', 'torso_l', 'torso_r', valL, valR);
    }

    const tthA = container.querySelector('#detail-table-thigh-a');
    const tthT = container.querySelector('#detail-table-thigh-t');
    const tthO = container.querySelector('#detail-table-thigh-overhead');
    if (tthA) {
      const [valL, valR] = getValPair('a', 'thigh_l', 'thigh_r', ['t', 'overhead']);
      tthA.innerHTML = renderCellPair('a', 'thigh_l', 'thigh_r', valL, valR);
    }
    if (tthT) {
      const [valL, valR] = getValPair('t', 'thigh_l', 'thigh_r', ['a', 'overhead']);
      tthT.innerHTML = renderCellPair('t', 'thigh_l', 'thigh_r', valL, valR);
    }
    if (tthO) {
      const [valL, valR] = getValPair('overhead', 'thigh_l', 'thigh_r', ['a', 't']);
      tthO.innerHTML = renderCellPair('overhead', 'thigh_l', 'thigh_r', valL, valR);
    }

    const tsA = container.querySelector('#detail-table-shin-a');
    const tsT = container.querySelector('#detail-table-shin-t');
    const tsO = container.querySelector('#detail-table-shin-overhead');
    if (tsA) {
      const [valL, valR] = getValPair('a', 'shin_l', 'shin_r', ['t', 'overhead']);
      tsA.innerHTML = renderCellPair('a', 'shin_l', 'shin_r', valL, valR);
    }
    if (tsT) {
      const [valL, valR] = getValPair('t', 'shin_l', 'shin_r', ['a', 'overhead']);
      tsT.innerHTML = renderCellPair('t', 'shin_l', 'shin_r', valL, valR);
    }
    if (tsO) {
      const [valL, valR] = getValPair('overhead', 'shin_l', 'shin_r', ['a', 't']);
      tsO.innerHTML = renderCellPair('overhead', 'shin_l', 'shin_r', valL, valR);
    }

    const tuaA = container.querySelector('#detail-table-upperarm-a');
    const tuaT = container.querySelector('#detail-table-upperarm-t');
    const tuaO = container.querySelector('#detail-table-upperarm-overhead');
    if (tuaA) {
      const [valL, valR] = getValPair('a', 'upperarm_l', 'upperarm_r', ['t', 'overhead']);
      tuaA.innerHTML = renderCellPair('a', 'upperarm_l', 'upperarm_r', valL, valR);
    }
    if (tuaT) {
      const [valL, valR] = getValPair('t', 'upperarm_l', 'upperarm_r', ['a', 'overhead']);
      tuaT.innerHTML = renderCellPair('t', 'upperarm_l', 'upperarm_r', valL, valR);
    }
    if (tuaO) {
      const [valL, valR] = getValPair('overhead', 'upperarm_l', 'upperarm_r', ['a', 't']);
      tuaO.innerHTML = renderCellPair('overhead', 'upperarm_l', 'upperarm_r', valL, valR);
    }

    const tfaA = container.querySelector('#detail-table-forearm-a');
    const tfaT = container.querySelector('#detail-table-forearm-t');
    const tfaO = container.querySelector('#detail-table-forearm-overhead');
    if (tfaA) {
      const [valL, valR] = getValPair('a', 'forearm_l', 'forearm_r', ['t', 'overhead']);
      tfaA.innerHTML = renderCellPair('a', 'forearm_l', 'forearm_r', valL, valR);
    }
    if (tfaT) {
      const [valL, valR] = getValPair('t', 'forearm_l', 'forearm_r', ['a', 'overhead']);
      tfaT.innerHTML = renderCellPair('t', 'forearm_l', 'forearm_r', valL, valR);
    }
    if (tfaO) {
      const [valL, valR] = getValPair('overhead', 'forearm_l', 'forearm_r', ['a', 't']);
      tfaO.innerHTML = renderCellPair('overhead', 'forearm_l', 'forearm_r', valL, valR);
    }

    const cHeight = container.querySelector('#consolidated-val-height');
    const cWingspan = container.querySelector('#consolidated-val-wingspan');
    const cReach = container.querySelector('#consolidated-val-reach');
    const cTorso = container.querySelector('#consolidated-val-torso');
    const cThigh = container.querySelector('#consolidated-val-thigh');
    const cShin = container.querySelector('#consolidated-val-shin');
    const cUpperarm = container.querySelector('#consolidated-val-upperarm');
    const cForearm = container.querySelector('#consolidated-val-forearm');

    const compiled = compileImportedMetricsFromProfile(profile, activeSession.id) || {};

    if (cHeight) cHeight.innerHTML = formatSingle(compiled.skeletal_height);
    if (cWingspan) cWingspan.innerHTML = formatSingle(compiled.wingspan);
    if (cReach) cReach.innerHTML = formatPair(compiled.fingerToToeL, compiled.fingerToToeR);
    if (cTorso) cTorso.innerHTML = formatPair(compiled.torso_l, compiled.torso_r);
    if (cThigh) cThigh.innerHTML = formatPair(compiled.thigh_l, compiled.thigh_r);
    if (cShin) cShin.innerHTML = formatPair(compiled.shin_l, compiled.shin_r);
    if (cUpperarm) cUpperarm.innerHTML = formatPair(compiled.upperarm_l, compiled.upperarm_r);
    if (cForearm) cForearm.innerHTML = formatPair(compiled.forearm_l, compiled.forearm_r);

    // Toggle the edit section blocks visibility depending on state.isEditingProfileMetrics
    const posturalSection = container.querySelector('#profile-edit-section-postural');
    if (posturalSection) {
      posturalSection.style.display = state.isEditingProfileMetrics ? 'block' : 'none';
    }
    const mobilitySections = container.querySelectorAll('.profile-edit-section-mobility');
    mobilitySections.forEach(sec => {
      sec.style.display = state.isEditingProfileMetrics ? 'block' : 'none';
    });

    const editBtn = container.querySelector('#btn-edit-baseline-metrics');
    if (editBtn) {
      editBtn.classList.remove('btn-save-metrics', 'btn-edit-metrics');
      if (state.isEditingProfileMetrics) {
        editBtn.innerHTML = '💾 Save Metrics';
        editBtn.classList.add('btn-save-metrics');
        
        let cancelBtn = container.querySelector('#btn-cancel-baseline-metrics');
        if (!cancelBtn) {
          cancelBtn = document.createElement('button');
          cancelBtn.id = 'btn-cancel-baseline-metrics';
          cancelBtn.className = 'btn btn-cancel-metrics';
          cancelBtn.innerHTML = 'Cancel';
          editBtn.parentNode.appendChild(cancelBtn);
        }
        
        cancelBtn.onclick = () => {
          state.isEditingProfileMetrics = false;
          updateProfileUI(profileId);
        };
        
        editBtn.onclick = async () => {
          try {
            const freshProfile = await snapshotStore.getProfile(profileId);
            if (!freshProfile) return;
            
            const freshProfileMigrated = ensureProfileSessions(freshProfile);
            const freshActiveSession = freshProfileMigrated.sessions.find(s => String(s.id) === String(activeSession.id)) || freshProfileMigrated.sessions[0];
            
            if (!freshActiveSession.metricsA) freshActiveSession.metricsA = {};
            if (!freshActiveSession.metricsT) freshActiveSession.metricsT = {};
            if (!freshActiveSession.metricsOverhead) freshActiveSession.metricsOverhead = {};
            
            const inputs = document.querySelectorAll('.profile-edit-input');
            inputs.forEach(input => {
              const pose = input.getAttribute('data-pose');
              const key = input.getAttribute('data-key');
              const rawVal = input.value.trim();
              
              let targetMetrics;
              if (pose === 'a') targetMetrics = freshActiveSession.metricsA;
              else if (pose === 't') targetMetrics = freshActiveSession.metricsT;
              else if (pose === 'overhead') targetMetrics = freshActiveSession.metricsOverhead;
              
              if (targetMetrics) {
                if (rawVal === "") {
                  targetMetrics[key] = null;
                } else {
                  const parsed = parseFloat(rawVal);
                  if (!isNaN(parsed)) {
                    const cmVal = state.useInches ? parsed * 2.54 : parsed;
                    targetMetrics[key] = cmVal;
                  }
                }
              }
            });

            if (!freshActiveSession.squatPeaks) {
              freshActiveSession.squatPeaks = getDefaultSquatPeaks();
            }
            const squatInputs = document.querySelectorAll('.profile-squat-edit-input');
            squatInputs.forEach(input => {
              const joint = input.getAttribute('data-joint');
              const side = input.getAttribute('data-side');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseInt(rawVal, 10);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              const key = joint + side;
              freshActiveSession.squatPeaks[key] = val;
            });

            if (!freshActiveSession.shoulderPeaks) {
              freshActiveSession.shoulderPeaks = getDefaultShoulderPeaks();
            }
            const shoulderInputs = document.querySelectorAll('.profile-shoulder-edit-input');
            shoulderInputs.forEach(input => {
              const side = input.getAttribute('data-side');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseFloat(rawVal);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              if (side === 'L') {
                freshActiveSession.shoulderPeaks.excursionL = val;
              } else {
                freshActiveSession.shoulderPeaks.excursionR = val;
              }
            });
            
            if (!freshActiveSession.shoulderRotation) {
              freshActiveSession.shoulderRotation = getDefaultShoulderRotation();
            }
            const shoulderRotationInputs = document.querySelectorAll('.profile-shoulder-rotation-edit-input');
            shoulderRotationInputs.forEach(input => {
              const key = input.getAttribute('data-key');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseFloat(rawVal);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              freshActiveSession.shoulderRotation[key] = val;
            });

            if (!freshActiveSession.hipRotation) {
              freshActiveSession.hipRotation = getDefaultHipRotation();
            }
            const hipRotationInputs = document.querySelectorAll('.profile-hip-rotation-edit-input');
            hipRotationInputs.forEach(input => {
              const key = input.getAttribute('data-key');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseFloat(rawVal);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              freshActiveSession.hipRotation[key] = val;
            });

            if (!freshActiveSession.ankleDorsiPeaks) {
              freshActiveSession.ankleDorsiPeaks = getDefaultAnkleDorsiPeaks();
            }
            const ankleRotationInputs = document.querySelectorAll('.profile-ankle-dorsi-edit-input');
            ankleRotationInputs.forEach(input => {
              const key = input.getAttribute('data-key');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseFloat(rawVal);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              freshActiveSession.ankleDorsiPeaks[key] = val;
            });

            if (!freshActiveSession.thoracicExtension) {
              freshActiveSession.thoracicExtension = getDefaultThoracicExtension();
            }
            const thoracicInputs = document.querySelectorAll('.profile-thoracic-extension-edit-input');
            thoracicInputs.forEach(input => {
              const key = input.getAttribute('data-key');
              const rawVal = input.value.trim();
              let val = 0;
              if (rawVal !== "") {
                const parsed = parseFloat(rawVal);
                if (!isNaN(parsed)) {
                  val = parsed;
                }
              }
              freshActiveSession.thoracicExtension[key] = val;
            });
            
            freshProfileMigrated.metricsA = freshActiveSession.metricsA;
            freshProfileMigrated.metricsT = freshActiveSession.metricsT;
            freshProfileMigrated.metricsOverhead = freshActiveSession.metricsOverhead;
            freshProfileMigrated.squatPeaks = freshActiveSession.squatPeaks;
            freshProfileMigrated.shoulderPeaks = freshActiveSession.shoulderPeaks;
            freshProfileMigrated.shoulderRotation = freshActiveSession.shoulderRotation;
            freshProfileMigrated.hipRotation = freshActiveSession.hipRotation;
            freshProfileMigrated.ankleDorsiPeaks = freshActiveSession.ankleDorsiPeaks;
            freshProfileMigrated.thoracicExtension = freshActiveSession.thoracicExtension;
            freshProfileMigrated.imageA = freshActiveSession.imageA;
            freshProfileMigrated.imageT = freshActiveSession.imageT;
            freshProfileMigrated.imageOverhead = freshActiveSession.imageOverhead;
            freshProfileMigrated.imageSquatL = freshActiveSession.imageSquatL;
            freshProfileMigrated.imageSquatR = freshActiveSession.imageSquatR;
            freshProfileMigrated.imageSquatFrontal = freshActiveSession.imageSquatFrontal;
            freshProfileMigrated.jointsOverhead = freshActiveSession.jointsOverhead || null;

            await snapshotStore.saveProfile(freshProfileMigrated);
            state.allProfiles = await snapshotStore.getAllProfiles();
            if (state.activeProfileId === profileId) {
              await loadProfileIntoState(profileId);
            }
            
            state.isEditingProfileMetrics = false;
            alert("Metrics updated successfully!");
            updateProfileUI(profileId);
          } catch (err) {
            console.error("[SaveMetrics] Failed to save metrics:", err);
            alert("Failed to save metrics: " + err.message);
          }
        };
      } else {
        editBtn.innerHTML = 'Edit Metrics';
        editBtn.classList.add('btn-edit-metrics');
        
        const cancelBtn = container.querySelector('#btn-cancel-baseline-metrics');
        if (cancelBtn) {
          cancelBtn.parentNode.removeChild(cancelBtn);
        }
        
        editBtn.onclick = () => {
          state.isEditingProfileMetrics = true;
          updateProfileUI(profileId);
        };
      }
    }

    const dsqKnee = container.querySelector('#detail-squat-knee');
    const dsqHip = container.querySelector('#detail-squat-hip');
    const dsqAnkle = container.querySelector('#detail-squat-ankle');
    
    const sPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
    if (sPeaks.maxKneeCaveL > 90.0) sPeaks.maxKneeCaveL = 0;
    if (sPeaks.maxKneeCaveR > 90.0) sPeaks.maxKneeCaveR = 0;
    if ((sPeaks.maxKneeBowL || 0) > 90.0) sPeaks.maxKneeBowL = 0;
    if ((sPeaks.maxKneeBowR || 0) > 90.0) sPeaks.maxKneeBowR = 0;

    if (dsqKnee) dsqKnee.innerHTML = renderSquatPeakEdit('knee', sPeaks.kneeL, sPeaks.kneeR);
    if (dsqHip) dsqHip.innerHTML = renderSquatPeakEdit('hip', sPeaks.hipL, sPeaks.hipR);
    if (dsqAnkle) dsqAnkle.innerHTML = renderSquatPeakEdit('ankle', sPeaks.ankleL, sPeaks.ankleR);

    const dshExcursionL = container.querySelector('#detail-shoulder-excursion-l');
    const dshExcursionR = container.querySelector('#detail-shoulder-excursion-r');
    const shPeaks = getDefaultShoulderPeaks(activeSession.shoulderPeaks);

    if (dshExcursionL) {
      if (!state.isEditingProfileMetrics) {
        dshExcursionL.innerHTML = shPeaks.excursionL ? `${shPeaks.excursionL.toFixed(1)}°` : '0°';
      } else {
        dshExcursionL.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-shoulder-edit-input profile-edit-input shoulder" 
                   data-side="L" 
                   value="${shPeaks.excursionL ? shPeaks.excursionL.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dshExcursionR) {
      if (!state.isEditingProfileMetrics) {
        dshExcursionR.innerHTML = shPeaks.excursionR ? `${shPeaks.excursionR.toFixed(1)}°` : '0°';
      } else {
        dshExcursionR.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-shoulder-edit-input profile-edit-input shoulder" 
                   data-side="R" 
                   value="${shPeaks.excursionR ? shPeaks.excursionR.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }

    const dshRotExtL = container.querySelector('#detail-shoulder-rotation-external-l');
    const dshRotIntL = container.querySelector('#detail-shoulder-rotation-internal-l');
    const dshRotExtR = container.querySelector('#detail-shoulder-rotation-external-r');
    const dshRotIntR = container.querySelector('#detail-shoulder-rotation-internal-r');
    const shRot = getDefaultShoulderRotation(activeSession.shoulderRotation);

    if (dshRotExtL) {
      if (!state.isEditingProfileMetrics) {
        dshRotExtL.innerHTML = shRot.maxExternalRotationL ? `${shRot.maxExternalRotationL.toFixed(1)}°` : '0°';
      } else {
        dshRotExtL.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-shoulder-rotation-edit-input profile-edit-input" 
                   data-key="maxExternalRotationL" 
                   value="${shRot.maxExternalRotationL ? shRot.maxExternalRotationL.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dshRotIntL) {
      if (!state.isEditingProfileMetrics) {
        dshRotIntL.innerHTML = shRot.maxInternalRotationL ? `${shRot.maxInternalRotationL.toFixed(1)}°` : '0°';
      } else {
        dshRotIntL.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="-180" max="0" class="profile-shoulder-rotation-edit-input profile-edit-input" 
                   data-key="maxInternalRotationL" 
                   value="${shRot.maxInternalRotationL ? shRot.maxInternalRotationL.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dshRotExtR) {
      if (!state.isEditingProfileMetrics) {
        dshRotExtR.innerHTML = shRot.maxExternalRotationR ? `${shRot.maxExternalRotationR.toFixed(1)}°` : '0°';
      } else {
        dshRotExtR.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-shoulder-rotation-edit-input profile-edit-input" 
                   data-key="maxExternalRotationR" 
                   value="${shRot.maxExternalRotationR ? shRot.maxExternalRotationR.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dshRotIntR) {
      if (!state.isEditingProfileMetrics) {
        dshRotIntR.innerHTML = shRot.maxInternalRotationR ? `${shRot.maxInternalRotationR.toFixed(1)}°` : '0°';
      } else {
        dshRotIntR.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="-180" max="0" class="profile-shoulder-rotation-edit-input profile-edit-input" 
                   data-key="maxInternalRotationR" 
                   value="${shRot.maxInternalRotationR ? shRot.maxInternalRotationR.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }

    const dhipRotExtL = container.querySelector('#detail-hip-rotation-external-l');
    const dhipRotIntL = container.querySelector('#detail-hip-rotation-internal-l');
    const dhipRotExtR = container.querySelector('#detail-hip-rotation-external-r');
    const dhipRotIntR = container.querySelector('#detail-hip-rotation-internal-r');
    const hRot = getDefaultHipRotation(activeSession.hipRotation);

    if (dhipRotExtL) {
      if (!state.isEditingProfileMetrics) {
        dhipRotExtL.innerHTML = hRot.maxExternalRotationL ? `${hRot.maxExternalRotationL.toFixed(1)}°` : '0°';
      } else {
        dhipRotExtL.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-hip-rotation-edit-input profile-edit-input" 
                   data-key="maxExternalRotationL" 
                   value="${hRot.maxExternalRotationL ? hRot.maxExternalRotationL.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dhipRotIntL) {
      if (!state.isEditingProfileMetrics) {
        dhipRotIntL.innerHTML = hRot.maxInternalRotationL ? `${hRot.maxInternalRotationL.toFixed(1)}°` : '0°';
      } else {
        dhipRotIntL.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-hip-rotation-edit-input profile-edit-input" 
                   data-key="maxInternalRotationL" 
                   value="${hRot.maxInternalRotationL ? hRot.maxInternalRotationL.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dhipRotExtR) {
      if (!state.isEditingProfileMetrics) {
        dhipRotExtR.innerHTML = hRot.maxExternalRotationR ? `${hRot.maxExternalRotationR.toFixed(1)}°` : '0°';
      } else {
        dhipRotExtR.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-hip-rotation-edit-input profile-edit-input" 
                   data-key="maxExternalRotationR" 
                   value="${hRot.maxExternalRotationR ? hRot.maxExternalRotationR.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }
    if (dhipRotIntR) {
      if (!state.isEditingProfileMetrics) {
        dhipRotIntR.innerHTML = hRot.maxInternalRotationR ? `${hRot.maxInternalRotationR.toFixed(1)}°` : '0°';
      } else {
        dhipRotIntR.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-hip-rotation-edit-input profile-edit-input" 
                   data-key="maxInternalRotationR" 
                   value="${hRot.maxInternalRotationR ? hRot.maxInternalRotationR.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }

    const dankleShinL = container.querySelector('#detail-ankle-dorsi-shin-l');
    const dankleShinR = container.querySelector('#detail-ankle-dorsi-shin-r');
    const dankleDorsiL = container.querySelector('#detail-ankle-dorsi-l');
    const dankleDorsiR = container.querySelector('#detail-ankle-dorsi-r');
    const anklePeaks = getDefaultAnkleDorsiPeaks(activeSession.ankleDorsiPeaks);

    const renderAnkleEditField = (el, val, key) => {
      if (!el) return;
      if (!state.isEditingProfileMetrics) {
        el.innerHTML = val ? `${val.toFixed(1)}°` : '0°';
      } else {
        el.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="90" class="profile-ankle-dorsi-edit-input profile-edit-input" 
                   data-key="${key}" 
                   value="${val ? val.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    };

    renderAnkleEditField(dankleShinL, anklePeaks.shinAngleL, "shinAngleL");
    renderAnkleEditField(dankleShinR, anklePeaks.shinAngleR, "shinAngleR");
    renderAnkleEditField(dankleDorsiL, anklePeaks.ankleDorsiL, "ankleDorsiL");
    renderAnkleEditField(dankleDorsiR, anklePeaks.ankleDorsiR, "ankleDorsiR");

    const dthoracicExtension = container.querySelector('#detail-thoracic-extension');
    const thoracicExtension = getDefaultThoracicExtension(activeSession.thoracicExtension);
    if (dthoracicExtension) {
      if (!state.isEditingProfileMetrics) {
        dthoracicExtension.innerHTML = thoracicExtension.peakAngle ? `${thoracicExtension.peakAngle.toFixed(1)}°` : '0°';
      } else {
        dthoracicExtension.innerHTML = `
          <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
            <input type="number" step="0.1" min="0" max="180" class="profile-thoracic-extension-edit-input profile-edit-input" 
                   data-key="peakAngle" 
                   value="${thoracicExtension.peakAngle ? thoracicExtension.peakAngle.toFixed(1) : 0}" style="width: 60px; padding: 2px 4px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-align: center; border-radius: 4px;">
            <span style="font-size: 11px;">°</span>
          </div>
        `;
      }
    }

    await renderShoulderRotationGrading(activeSession, container);

    const dsqDepth = container.querySelector('#detail-squat-depth');
    if (dsqDepth) {
      const maxKneeMob = Math.max(sPeaks.kneeL || 0, sPeaks.kneeR || 0);
      let depthStatus = "Standing Upright";
      let statusClass = "text-slate";

      if (maxKneeMob >= 110) {
        depthStatus = "Deep Squat";
        statusClass = "text-emerald";
      } else if (maxKneeMob >= 75) {
        depthStatus = "Parallel Squat";
        statusClass = "text-red";
      } else if (maxKneeMob >= 30) {
        depthStatus = "Partial Squat";
        statusClass = "text-amber";
      }

      dsqDepth.textContent = depthStatus;
      dsqDepth.className = `squat-peak-detail-val ${statusClass}`;
    }

    const detailSquatAsymmetrySummary = container.querySelector('#detail-squat-asymmetry-summary');
    if (detailSquatAsymmetrySummary) {
      let imageHtml = "";
      let videoHtml = "";

      let hasImage = false;
      if (activeSession.jointsOverhead) {
        hasImage = true;
        const valgus = calculateValgusFromJoints(activeSession.jointsOverhead);
        const varus = calculateVarusFromJoints(activeSession.jointsOverhead);
        
        const imgValgusL = valgus.pctL || 0;
        const imgValgusR = valgus.pctR || 0;
        const maxImgValgus = Math.max(imgValgusL, imgValgusR);
        
        const imgVarusL = varus.pctL || 0;
        const imgVarusR = varus.pctR || 0;
        const maxImgVarus = Math.max(imgVarusL, imgVarusR);

        let color = "#10b981";
        let statusText = `Excellent Alignment: Both knees perpendicular to baseline.`;

        if (maxImgValgus > maxImgVarus) {
          const lStr = `${imgValgusL.toFixed(1)}°`;
          const rStr = `${imgValgusR.toFixed(1)}°`;
          if (maxImgValgus > 15.0) {
            color = "#ef4444";
            statusText = `Severe Medial Deviation: Significant knee cave-in (Valgus) detected (L: ${lStr}, R: ${rStr}). Focus on stability.`;
          } else if (maxImgValgus > 8.0) {
            color = "#ff9f43";
            statusText = `Moderate Medial Deviation: Knees cave inward (Valgus) past baseline (L: ${lStr}, R: ${rStr}).`;
          } else if (maxImgValgus >= 3.0) {
            color = "#ffb300";
            statusText = `Mild Medial Deviation: Minor knee tracking variance (Valgus) (L: ${lStr}, R: ${rStr}).`;
          }
        } else {
          const lStr = `${imgVarusL.toFixed(1)}°`;
          const rStr = `${imgVarusR.toFixed(1)}°`;
          if (maxImgVarus > 15.0) {
            color = "#ef4444";
            statusText = `Severe Lateral Deviation: Significant knee bow-out (Varus) detected (L: ${lStr}, R: ${rStr}).`;
          } else if (maxImgVarus > 8.0) {
            color = "#f97316";
            statusText = `Moderate Lateral Deviation: Knees bow outward (Varus) past baseline (L: ${lStr}, R: ${rStr}).`;
          } else if (maxImgVarus >= 3.0) {
            color = "#ffb300";
            statusText = `Mild Lateral Deviation: Minor knee tracking variance (Varus) (L: ${lStr}, R: ${rStr}).`;
          }
        }

        imageHtml = `
          <div style="padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.015); text-align: left;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #d4a017;"></span> Static Overhead Snapshot
            </div>
            <div style="font-size: 13px; color: ${color}; font-weight: 500;">
              ${statusText}
            </div>
          </div>
        `;
      }

      let hasVideoData = false;
      const vidCaveL = sPeaks.maxKneeCaveL || 0;
      const vidCaveR = sPeaks.maxKneeCaveR || 0;
      const maxVidCave = Math.max(vidCaveL, vidCaveR);

      const vidBowL = sPeaks.maxKneeBowL || 0;
      const vidBowR = sPeaks.maxKneeBowR || 0;
      const maxVidBow = Math.max(vidBowL, vidBowR);

      if (maxVidCave > 0 || maxVidBow > 0) {
        hasVideoData = true;

        let color = "#10b981";
        let statusTitle = "Stable Knee Alignment (Video Scan)";
        let explanationText = `Knees tracking cleanly over feet.`;
        let timestampText = "";

        if (maxVidCave > maxVidBow) {
          const lStr = `${vidCaveL.toFixed(1)}°`;
          const rStr = `${vidCaveR.toFixed(1)}°`;
          explanationText = `Knees caved inward past safe tracking boundaries. Peak: L: ${lStr}, R: ${rStr}.`;
          
          if (maxVidCave > 8.0) {
            const isSevere = maxVidCave > 15.0;
            color = isSevere ? "#ef4444" : "#ff9f43";
            statusTitle = isSevere ? "Severe Knee Valgus (Cave-In) Detected" : "Moderate Knee Valgus (Cave-In) Detected";
            
            const tFirst = sPeaks.valgusFirstTimestamp;
            const tPeak = sPeaks.valgusPeakTimestamp;
            
            if (tFirst !== null && tFirst !== undefined) {
              timestampText = `
                <div style="margin-top: 6px; font-size: 11px; color: #9ca3af; display: flex; flex-direction: column; gap: 2px;">
                  <span>Valgus first appeared at: <strong>${tFirst.toFixed(1)}s</strong> in the video timeline.</span>
                  ${tPeak !== null && tPeak !== undefined ? `<span>Peak Valgus reached at: <strong>${tPeak.toFixed(1)}s</strong> (deviation of ${maxVidCave.toFixed(1)}°).</span>` : ""}
                </div>
              `;
            } else {
              timestampText = `
                <div style="margin-top: 6px; font-size: 11px; color: #9ca3af;">
                  Peak deviation of <strong>${maxVidCave.toFixed(1)}°</strong> recorded during scan.
                </div>
              `;
            }
          } else if (maxVidCave >= 3.0) {
            color = "#ffb300";
            statusTitle = "Mild Knee Valgus Deviation";
            explanationText = `Slight knee tracking cave-in during squat video. Peak: L: ${lStr}, R: ${rStr}.`;
          }
        } else {
          const lStr = `${vidBowL.toFixed(1)}°`;
          const rStr = `${vidBowR.toFixed(1)}°`;
          explanationText = `Knees bowed outward past safe tracking boundaries. Peak: L: ${lStr}, R: ${rStr}.`;

          if (maxVidBow > 8.0) {
            const isSevere = maxVidBow > 15.0;
            color = isSevere ? "#ef4444" : "#f97316";
            statusTitle = isSevere ? "Severe Knee Varus (Bow-Out) Detected" : "Moderate Knee Varus (Bow-Out) Detected";
            
            const tFirst = sPeaks.varusFirstTimestamp;
            const tPeak = sPeaks.varusPeakTimestamp;
            
            if (tFirst !== null && tFirst !== undefined) {
              timestampText = `
                <div style="margin-top: 6px; font-size: 11px; color: #9ca3af; display: flex; flex-direction: column; gap: 2px;">
                  <span>Varus first appeared at: <strong>${tFirst.toFixed(1)}s</strong> in the video timeline.</span>
                  ${tPeak !== null && tPeak !== undefined ? `<span>Peak Varus reached at: <strong>${tPeak.toFixed(1)}s</strong> (deviation of ${maxVidBow.toFixed(1)}°).</span>` : ""}
                </div>
              `;
            } else {
              timestampText = `
                <div style="margin-top: 6px; font-size: 11px; color: #9ca3af;">
                  Peak deviation of <strong>${maxVidBow.toFixed(1)}°</strong> recorded during scan.
                </div>
              `;
            }
          } else if (maxVidBow >= 3.0) {
            color = "#ffb300";
            statusTitle = "Mild Knee Varus Deviation";
            explanationText = `Slight knee tracking bow-out during squat video. Peak: L: ${lStr}, R: ${rStr}.`;
          }
        }

        videoHtml = `
          <div style="padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); background: rgba(255,255,255,0.015); text-align: left;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #ec4899;"></span> Frontal Squat Video Timeline
            </div>
            <div style="font-size: 13px; color: ${color}; font-weight: 600;">
              ${statusTitle}
            </div>
            <div style="font-size: 12px; color: #ccc; margin-top: 2px;">
              ${explanationText}
            </div>
            ${timestampText}
          </div>
        `;
      }

      if (!hasImage && !hasVideoData) {
        detailSquatAsymmetrySummary.innerHTML = `
          <span style="color: #888; font-style: italic;">Knee Alignment & Valgus Tracking: No frontal squat image or video scan completed yet.</span>
        `;
        detailSquatAsymmetrySummary.style.color = "#aaa";
        detailSquatAsymmetrySummary.style.borderColor = "rgba(255, 255, 255, 0.03)";
        detailSquatAsymmetrySummary.style.background = "rgba(255, 255, 255, 0.01)";
        detailSquatAsymmetrySummary.style.padding = "6px 12px";
        detailSquatAsymmetrySummary.style.border = "1px solid rgba(255,255,255,0.03)";
      } else {
        detailSquatAsymmetrySummary.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
            ${videoHtml}
            ${imageHtml}
          </div>
        `;
        detailSquatAsymmetrySummary.style.border = "none";
        detailSquatAsymmetrySummary.style.background = "transparent";
        detailSquatAsymmetrySummary.style.padding = "0";
      }
    }

    const videosListEl = container.querySelector('#profile-details-videos-list');
    const videoPlaceholder = container.querySelector('#profile-details-video-placeholder');

    if (mainVideoPlayer) {
      mainVideoPlayer.src = '';
      mainVideoPlayer.style.display = 'none';
      mainVideoPlayer.classList.add('hidden');
      mainVideoPlayer.classList.remove('visible-block');
    }
    if (videoPlaceholder) {
      videoPlaceholder.classList.add('visible-flex');
      videoPlaceholder.classList.remove('hidden');
      videoPlaceholder.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="playlist-placeholder-icon"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
        <span>Select a recording from the playlist below to play</span>
      `;
    }

    if (videosListEl) {
      videosListEl.innerHTML = '';
      
      const metricVideoIds = new Set();
      if (profile.sessions && Array.isArray(profile.sessions)) {
        profile.sessions.forEach(s => {
          if (s.videoSquatL) metricVideoIds.add(s.videoSquatL.id);
          if (s.videoSquatR) metricVideoIds.add(s.videoSquatR.id);
          if (s.videoSquatFrontal) metricVideoIds.add(s.videoSquatFrontal.id);
          if (s.videoShoulderL) metricVideoIds.add(s.videoShoulderL.id);
          if (s.videoShoulderR) metricVideoIds.add(s.videoShoulderR.id);
          if (s.videoShoulderRotationL) metricVideoIds.add(s.videoShoulderRotationL.id);
          if (s.videoShoulderRotationR) metricVideoIds.add(s.videoShoulderRotationR.id);
          if (s.videoHipRotationL) metricVideoIds.add(s.videoHipRotationL.id);
          if (s.videoHipRotationR) metricVideoIds.add(s.videoHipRotationR.id);
          if (s.videoAnkleDorsiL) metricVideoIds.add(s.videoAnkleDorsiL.id);
          if (s.videoAnkleDorsiR) metricVideoIds.add(s.videoAnkleDorsiR.id);
          if (s.videoThoracicExtension) metricVideoIds.add(s.videoThoracicExtension.id);
        });
      }
      const savedVideos = profile.videos || [];

      if (savedVideos.length === 0) {
        if (videoPlaceholder) {
          videoPlaceholder.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="playlist-placeholder-icon-empty"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            <span class="playlist-empty-text">No uploaded videos saved for this profile yet.</span>
          `;
        }
        videosListEl.innerHTML = `
          <div class="playlist-empty-placeholder">
            Playlist Empty
          </div>
        `;
      } else {
        savedVideos.forEach((video, idx) => {
          const videoRow = document.createElement('div');
          videoRow.className = 'profile-video-row-item';
          videoRow.setAttribute('data-video-id', video.id);
          videoRow.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 4px; padding: 0.5rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; cursor: pointer; transition: all 0.2s;';
          
          const safeBlob = getSafeVideoBlob(video);
          const videoUrl = safeBlob ? URL.createObjectURL(safeBlob) : '';
          trackUrl(videoUrl);
          
          const dateStr = video.timestamp ? new Date(video.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown Date';
          const sizeMb = (video.blob.size / (1024 * 1024)).toFixed(1);
          const durationStr = video.duration ? `${(video.duration / 1000).toFixed(1)}s` : '--';
          
          videoRow.innerHTML = `
            <div class="playlist-video-info-container">
              <div class="playlist-play-icon">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </div>
              <div class="playlist-video-details">
                <div class="playlist-video-title-row">
                  <span class="playlist-video-name">${video.name || 'Video Capture'}</span>
                  <button class="btn btn-rename-video" title="Rename Video">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                  </button>
                </div>
                <span class="playlist-video-meta">${dateStr} &bull; ${sizeMb} MB &bull; ${durationStr}</span>
              </div>
            </div>
            <div class="playlist-row-actions">
              <button class="btn btn-dl-video">DL</button>
              <button class="btn btn-del-video">DEL</button>
            </div>
          `;

          const selectVideo = () => {
            const allItems = videosListEl.querySelectorAll('.profile-video-row-item');
            allItems.forEach(item => item.classList.remove('active-playlist-item'));

            videoRow.classList.add('active-playlist-item');

            const lowerName = (video.name || '').toLowerCase();
            if (lowerName.includes('left')) {
              state.squatTestingSide = 'left';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('right')) {
              state.squatTestingSide = 'right';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('frontal') || lowerName.includes('front')) {
              state.squatTestingSide = 'frontal';
              state.allowFrontalUpdateL = (!state.squatPeaks || (state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0));
              state.allowFrontalUpdateR = (!state.squatPeaks || (state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0));
            } else {
              state.squatTestingSide = state.squatTestingSide || 'frontal';
            }

            if (mainVideoPlayer) {
              state.activeModalVideoProcessing = false;
              clearSmoothBuffer('*');
              state.latestPoseResults = null;
              state.latestHandResults = null;
              state.lastModalInferenceSrc = null;

              const canvas = container.querySelector('#profile-details-video-canvas');
              if (canvas) {
                canvas.style.display = 'none';
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
              mainVideoPlayer.src = videoUrl;
              mainVideoPlayer.style.display = 'block';
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
              const btnFullscreen = container.querySelector('#btn-profile-video-fullscreen');
              if (btnFullscreen) {
                btnFullscreen.style.display = 'flex';
              }
              
              // Replay Mode: Do not generate or draw pose overlays during replay
              state.activeModalVideoProcessing = false;
              
              mainVideoPlayer.play().catch(e => console.log("[VideoPlay] Autoplay blocked:", e));
            }
          };

          videoRow.addEventListener('click', (e) => {
            if (e.target.closest('.btn-rename-video') || e.target.closest('.btn-dl-video') || e.target.closest('.btn-del-video')) {
              return;
            }
            selectVideo();
          });

          if (idx === 0) {
            videoRow.classList.add('active-playlist-item');
            if (mainVideoPlayer) {
              mainVideoPlayer.src = videoUrl;
              mainVideoPlayer.style.display = 'block';
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
              const btnFullscreen = container.querySelector('#btn-profile-video-fullscreen');
              if (btnFullscreen) {
                btnFullscreen.style.display = 'flex';
              }
              const canvas = container.querySelector('#profile-details-video-canvas');
              if (canvas) {
                canvas.style.display = 'none';
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
              // Replay Mode: Do not generate or draw pose overlays during replay
              state.activeModalVideoProcessing = false;
            }

            const lowerName = (video.name || '').toLowerCase();
            if (lowerName.includes('left')) {
              state.squatTestingSide = 'left';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('right')) {
              state.squatTestingSide = 'right';
              state.allowFrontalUpdateL = false;
              state.allowFrontalUpdateR = false;
            } else if (lowerName.includes('frontal') || lowerName.includes('front')) {
              state.squatTestingSide = 'frontal';
              state.allowFrontalUpdateL = (!state.squatPeaks || (state.squatPeaks.kneeL === 0 && state.squatPeaks.hipL === 0));
              state.allowFrontalUpdateR = (!state.squatPeaks || (state.squatPeaks.kneeR === 0 && state.squatPeaks.hipR === 0));
            } else {
              state.squatTestingSide = state.squatTestingSide || 'frontal';
            }
          }

          const renameBtn = videoRow.querySelector('.btn-rename-video');
          renameBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentName = video.name || 'Video Capture';
            const newName = prompt("Enter a new name for this video:", currentName);
            if (newName === null) return;
            const trimmedName = newName.trim();
            if (!trimmedName) {
              alert("Video name cannot be empty.");
              return;
            }
            try {
              const freshProfile = await snapshotStore.getProfile(profileId);
              if (freshProfile && freshProfile.videos) {
                const vToUpdate = freshProfile.videos.find(v => v.id === video.id);
                if (vToUpdate) {
                  vToUpdate.name = trimmedName;
                  await snapshotStore.saveProfile(freshProfile);
                  state.allProfiles = await snapshotStore.getAllProfiles();
                  updateProfileUI(profileId);
                }
              }
            } catch (err) {
              console.error("[VideoRename] Failed to rename saved video:", err);
            }
          });

          const dlBtn = videoRow.querySelector('.btn-dl-video');
          dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = document.createElement('a');
            a.classList.add('hidden');
            a.href = videoUrl;
            const fileExt = video.fileExt || 'webm';
            const cleanSubjectName = profile.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
            a.download = `scarlet_biomechanics_${cleanSubjectName}_saved_recording_${video.id}.${fileExt}`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              document.body.removeChild(a);
            }, 100);
          });

          const delBtn = videoRow.querySelector('.btn-del-video');
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm("Are you sure you want to permanently delete this saved video from the profile?")) {
              return;
            }
            try {
              const freshProfile = await snapshotStore.getProfile(profileId);
              if (freshProfile && freshProfile.videos) {
                freshProfile.videos = freshProfile.videos.filter(v => v.id !== video.id);
                
                const freshProfileMigrated = ensureProfileSessions(freshProfile);
                if (freshProfileMigrated.sessions && Array.isArray(freshProfileMigrated.sessions)) {
                  freshProfileMigrated.sessions.forEach(s => {
                    if (s.videoSquatL && s.videoSquatL.id === video.id) s.videoSquatL = null;
                    if (s.videoSquatR && s.videoSquatR.id === video.id) s.videoSquatR = null;
                    if (s.videoSquatFrontal && s.videoSquatFrontal.id === video.id) s.videoSquatFrontal = null;
                    if (s.videoShoulderL && s.videoShoulderL.id === video.id) s.videoShoulderL = null;
                    if (s.videoShoulderR && s.videoShoulderR.id === video.id) s.videoShoulderR = null;
                    if (s.videoShoulderRotationL && s.videoShoulderRotationL.id === video.id) s.videoShoulderRotationL = null;
                    if (s.videoShoulderRotationR && s.videoShoulderRotationR.id === video.id) s.videoShoulderRotationR = null;
                    if (s.videoHipRotationL && s.videoHipRotationL.id === video.id) s.videoHipRotationL = null;
                    if (s.videoHipRotationR && s.videoHipRotationR.id === video.id) s.videoHipRotationR = null;
                    if (s.videoAnkleDorsiL && s.videoAnkleDorsiL.id === video.id) s.videoAnkleDorsiL = null;
                    if (s.videoAnkleDorsiR && s.videoAnkleDorsiR.id === video.id) s.videoAnkleDorsiR = null;
                    if (s.videoThoracicExtension && s.videoThoracicExtension.id === video.id) s.videoThoracicExtension = null;
                  });
                }
                
                await snapshotStore.saveProfile(freshProfileMigrated);
                state.allProfiles = await snapshotStore.getAllProfiles();
                if (state.activeProfileId === profileId) {
                  await loadProfileIntoState(profileId);
                }
                updateProfileUI(profileId);
              }
            } catch (err) {
              console.error("[VideoDelete] Failed to delete saved video:", err);
            }
          });

          videosListEl.appendChild(videoRow);
        });
      }
    }

    // ==========================================
    // Athlete Comparison Engine Logic
    // ==========================================
    const compareSelect = container.querySelector('#profile-compare-select');
    if (compareSelect) {
      compareSelect.innerHTML = '<option value="">Select Athlete to Compare</option>';
      
      let allProfiles = state.allProfiles || [];
      if (allProfiles.length === 0) {
        allProfiles = await snapshotStore.getAllProfiles();
        state.allProfiles = allProfiles;
      }
      
      allProfiles.forEach(p => {
        if (p.id !== profileId) {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.name || `Profile #${p.id}`;
          if (state.comparedProfileId && p.id === state.comparedProfileId) {
            option.selected = true;
          }
          compareSelect.appendChild(option);
        }
      });

      const placeholderCard = container.querySelector('#compare-placeholder-card');
      const contentBlock = container.querySelector('#compare-content-block');

      const renderComparison = async (otherProfileId) => {
        if (!otherProfileId) {
          if (placeholderCard) placeholderCard.classList.remove('hidden');
          if (contentBlock) contentBlock.classList.add('hidden');
          return;
        }

        try {
          const otherProfile = await snapshotStore.getProfile(otherProfileId);
          if (!otherProfile) {
            if (placeholderCard) placeholderCard.classList.remove('hidden');
            if (contentBlock) contentBlock.classList.add('hidden');
            return;
          }

          const otherSession = otherProfile.sessions ? (otherProfile.sessions.find(s => String(s.id) === String(otherProfile.activeSessionId)) || otherProfile.sessions[otherProfile.sessions.length - 1]) : null;

          if (placeholderCard) placeholderCard.classList.add('hidden');
          if (contentBlock) contentBlock.classList.remove('hidden');

          // Update header athlete names
          const nameAEl = container.querySelector('#compare-metric-name-a');
          const nameBEl = container.querySelector('#compare-metric-name-b');
          const romNameAEl = container.querySelector('#compare-rom-name-a');
          const romNameBEl = container.querySelector('#compare-rom-name-b');

          const nameA = profile.name || "Subject A";
          const nameB = otherProfile.name || "Subject B";

          if (nameAEl) nameAEl.textContent = nameA;
          if (nameBEl) nameBEl.textContent = nameB;
          if (romNameAEl) romNameAEl.textContent = nameA;
          if (romNameBEl) romNameBEl.textContent = nameB;

          // Compile baselines
          const compiledA = compileImportedMetricsFromProfile(profile, activeSession.id) || {};
          const compiledB = compileImportedMetricsFromProfile(otherProfile, otherSession ? otherSession.id : null) || {};

          // Baselines rows mapping: [Label, key, isPair]
          const baselineRows = [
            ["Stature Height", "skeletal_height", false],
            ["Wingspan", "wingspan", false],
            ["Overhead Reach (L/R)", ["fingerToToeL", "fingerToToeR"], true],
            ["Torso Length (L/R)", ["torso_l", "torso_r"], true],
            ["Thigh Length (L/R)", ["thigh_l", "thigh_r"], true],
            ["Shank/Shin Length (L/R)", ["shin_l", "shin_r"], true],
            ["Upper Arm (L/R)", ["upperarm_l", "upperarm_r"], true],
            ["Forearm (L/R)", ["forearm_l", "forearm_r"], true]
          ];

          const baselinesTbody = container.querySelector('#compare-baselines-tbody');
          if (baselinesTbody) {
            baselinesTbody.innerHTML = '';
            
            baselineRows.forEach(([label, key, isPair]) => {
              const tr = document.createElement('tr');
              tr.className = 'compare-details-tr';

              const tdLabel = document.createElement('td');
              tdLabel.className = 'compare-details-td-label';
              tdLabel.textContent = label;
              tr.appendChild(tdLabel);

              const tdValA = document.createElement('td');
              tdValA.className = 'compare-details-td-val-a';
              
              const tdValB = document.createElement('td');
              tdValB.className = 'compare-details-td-val-b';

              const tdDelta = document.createElement('td');
              tdDelta.className = 'compare-details-td-delta';

              if (!isPair) {
                const valA = compiledA[key] !== undefined ? compiledA[key] : null;
                const valB = compiledB[key] !== undefined ? compiledB[key] : null;
                
                tdValA.textContent = valA !== null ? formatLength(valA) : '--';
                tdValB.textContent = valB !== null ? formatLength(valB) : '--';
                
                // Diff calculation (valA - valB)
                if (valA !== null && valB !== null) {
                  const diff = valA - valB;
                  if (Math.abs(diff) < 0.05) {
                    tdDelta.innerHTML = '<span class="compare-delta-neutral">0.0</span>';
                  } else {
                    const dispDiff = state.useInches ? diff / 2.54 : diff;
                    const suffix = state.useInches ? ' in' : ' cm';
                    const sign = diff > 0 ? '+' : '';
                    const cls = diff > 0 ? 'compare-delta-positive' : 'compare-delta-negative';
                    tdDelta.innerHTML = `<span class="${cls}">${sign}${dispDiff.toFixed(1)}${suffix}</span>`;
                  }
                } else {
                  tdDelta.innerHTML = '<span class="compare-delta-neutral">--</span>';
                }
              } else {
                const [keyL, keyR] = key;
                const valLA = compiledA[keyL] !== undefined ? compiledA[keyL] : null;
                const valRA = compiledA[keyR] !== undefined ? compiledA[keyR] : null;
                const valLB = compiledB[keyL] !== undefined ? compiledB[keyL] : null;
                const valRB = compiledB[keyR] !== undefined ? compiledB[keyR] : null;

                const hasLA = valLA !== null && valLA !== undefined;
                const hasRA = valRA !== null && valRA !== undefined;
                const hasLB = valLB !== null && valLB !== undefined;
                const hasRB = valRB !== null && valRB !== undefined;

                tdValA.innerHTML = `
                  <div style="font-size: 0.8rem; display: flex; flex-direction: column; align-items: center;">
                    <div>L: ${hasLA ? formatLength(valLA) : '--'}</div>
                    <div>R: ${hasRA ? formatLength(valRA) : '--'}</div>
                  </div>
                `;

                tdValB.innerHTML = `
                  <div style="font-size: 0.8rem; display: flex; flex-direction: column; align-items: center;">
                    <div>L: ${hasLB ? formatLength(valLB) : '--'}</div>
                    <div>R: ${hasRB ? formatLength(valRB) : '--'}</div>
                  </div>
                `;

                // Calculate Deltas for Left and Right
                let deltaLStr = '--';
                let deltaRStr = '--';
                const suffix = state.useInches ? ' in' : ' cm';

                if (hasLA && hasLB) {
                  const diffL = valLA - valLB;
                  if (Math.abs(diffL) < 0.05) {
                    deltaLStr = '<span class="compare-delta-neutral">0.0</span>';
                  } else {
                    const dispL = state.useInches ? diffL / 2.54 : diffL;
                    const signL = diffL > 0 ? '+' : '';
                    const clsL = diffL > 0 ? 'compare-delta-positive' : 'compare-delta-negative';
                    deltaLStr = `<span class="${clsL}">${signL}${dispL.toFixed(1)}${suffix}</span>`;
                  }
                }

                if (hasRA && hasRB) {
                  const diffR = valRA - valRB;
                  if (Math.abs(diffR) < 0.05) {
                    deltaRStr = '<span class="compare-delta-neutral">0.0</span>';
                  } else {
                    const dispR = state.useInches ? diffR / 2.54 : diffR;
                    const signR = diffR > 0 ? '+' : '';
                    const clsR = diffR > 0 ? 'compare-delta-positive' : 'compare-delta-negative';
                    deltaRStr = `<span class="${clsR}">${signR}${dispR.toFixed(1)}${suffix}</span>`;
                  }
                }

                tdDelta.innerHTML = `
                  <div style="font-size: 0.8rem; display: flex; flex-direction: column; align-items: center; gap: 2px;">
                    <div>L: ${deltaLStr}</div>
                    <div>R: ${deltaRStr}</div>
                  </div>
                `;
              }

              tr.appendChild(tdValA);
              tr.appendChild(tdValB);
              tr.appendChild(tdDelta);
              baselinesTbody.appendChild(tr);
            });
          }

          // Compile ROM details
          const shRotA = getDefaultShoulderRotation(activeSession.shoulderRotation);
          const shPeaksA = getDefaultShoulderPeaks(activeSession.shoulderPeaks);
          const sPeaksA = getDefaultSquatPeaks(activeSession.squatPeaks);
          const hRotA = getDefaultHipRotation(activeSession.hipRotation);
          const ankleDorsiPeaksA = getDefaultAnkleDorsiPeaks(activeSession.ankleDorsiPeaks);

          const otherActiveSession = otherSession || {};
          const shRotB = getDefaultShoulderRotation(otherActiveSession.shoulderRotation);
          const shPeaksB = getDefaultShoulderPeaks(otherActiveSession.shoulderPeaks);
          const sPeaksB = getDefaultSquatPeaks(otherActiveSession.squatPeaks);
          const hRotB = getDefaultHipRotation(otherActiveSession.hipRotation);
          const ankleDorsiPeaksB = getDefaultAnkleDorsiPeaks(otherActiveSession.ankleDorsiPeaks);

          // Category 4 ROM Peaks logic: L/R shin or ankle peak
          const ankleLA = ankleDorsiPeaksA.ankleDorsiL || ankleDorsiPeaksA.shinAngleL || 0;
          const ankleRA = ankleDorsiPeaksA.ankleDorsiR || ankleDorsiPeaksA.shinAngleR || 0;
          const ankleLB = ankleDorsiPeaksB.ankleDorsiL || ankleDorsiPeaksB.shinAngleL || 0;
          const ankleRB = ankleDorsiPeaksB.ankleDorsiR || ankleDorsiPeaksB.shinAngleR || 0;

          // ROM rows definition: [Label, leftValA, rightValA, leftValB, rightValB]
          const romRows = [
            ["Shoulder Flexion", shPeaksA.excursionL, shPeaksA.excursionR, shPeaksB.excursionL, shPeaksB.excursionR],
            ["Shoulder External Rotation", shRotA.maxExternalRotationL, shRotA.maxExternalRotationR, shRotB.maxExternalRotationL, shRotB.maxExternalRotationR],
            ["Shoulder Internal Rotation", shRotA.maxInternalRotationL, shRotA.maxInternalRotationR, shRotB.maxInternalRotationL, shRotB.maxInternalRotationR],
            ["Hip External Rotation", hRotA.maxExternalRotationL, hRotA.maxExternalRotationR, hRotB.maxExternalRotationL, hRotB.maxExternalRotationR],
            ["Hip Internal Rotation", hRotA.maxInternalRotationL, hRotA.maxInternalRotationR, hRotB.maxInternalRotationL, hRotB.maxInternalRotationR],
            ["Ankle Dorsiflexion", ankleLA, ankleRA, ankleLB, ankleRB],
            ["Knee Flexion (OH Squat)", sPeaksA.kneeL, sPeaksA.kneeR, sPeaksB.kneeL, sPeaksB.kneeR]
          ];

          const romTbody = container.querySelector('#compare-rom-tbody');
          if (romTbody) {
            romTbody.innerHTML = '';

            romRows.forEach(([label, lA, rA, lB, rB]) => {
              const tr = document.createElement('tr');
              tr.className = 'compare-details-tr';

              const tdLabel = document.createElement('td');
              tdLabel.className = 'compare-details-td-label';
              tdLabel.textContent = label;
              tr.appendChild(tdLabel);

              const tdValA = document.createElement('td');
              tdValA.className = 'compare-details-td-val-a';

              const tdValB = document.createElement('td');
              tdValB.className = 'compare-details-td-val-b';

              const tdDelta = document.createElement('td');
              tdDelta.className = 'compare-details-td-delta';

              const hasLA = lA !== null && lA !== undefined && lA > 0;
              const hasRA = rA !== null && rA !== undefined && rA > 0;
              const hasLB = lB !== null && lB !== undefined && lB > 0;
              const hasRB = rB !== null && rB !== undefined && rB > 0;

              tdValA.innerHTML = `
                <div style="font-size: 0.8rem; display: flex; flex-direction: column; align-items: center;">
                  <div>L: ${hasLA ? Math.round(lA) + '°' : '--'}</div>
                  <div>R: ${hasRA ? Math.round(rA) + '°' : '--'}</div>
                </div>
              `;

              tdValB.innerHTML = `
                <div style="font-size: 0.8rem; display: flex; flex-direction: column; align-items: center;">
                  <div>L: ${hasLB ? Math.round(lB) + '°' : '--'}</div>
                  <div>R: ${hasRB ? Math.round(rB) + '°' : '--'}</div>
                </div>
              `;

              // Deltas
              let deltaLStr = '--';
              let deltaRStr = '--';

              if (hasLA && hasLB) {
                const diffL = Math.round(lA) - Math.round(lB);
                if (diffL === 0) {
                  deltaLStr = '<span class="compare-delta-neutral">0°</span>';
                } else {
                  const signL = diffL > 0 ? '+' : '';
                  const clsL = diffL > 0 ? 'compare-delta-positive' : 'compare-delta-negative';
                  deltaLStr = `<span class="${clsL}">${signL}${diffL}°</span>`;
                }
              }

              if (hasRA && hasRB) {
                const diffR = Math.round(rA) - Math.round(rB);
                if (diffR === 0) {
                  deltaRStr = '<span class="compare-delta-neutral">0°</span>';
                } else {
                  const signR = diffR > 0 ? '+' : '';
                  const clsR = diffR > 0 ? 'compare-delta-positive' : 'compare-delta-negative';
                  deltaRStr = `<span class="${clsR}">${signR}${diffR}°</span>`;
                }
              }

              tdDelta.innerHTML = `
                <div style="font-size: 0.8rem; display: flex; flex-direction: column; align-items: center; gap: 2px;">
                  <div>L: ${deltaLStr}</div>
                  <div>R: ${deltaRStr}</div>
                </div>
              `;

              tr.appendChild(tdValA);
              tr.appendChild(tdValB);
              tr.appendChild(tdDelta);
              romTbody.appendChild(tr);
            });
          }

        } catch (err) {
          console.error("[ComparisonEngine] Failed rendering comparisons:", err);
        }
      };

      compareSelect.onchange = async (e) => {
        const val = e.target.value;
        if (!val) {
          state.comparedProfileId = null;
          await renderComparison(null);
        } else {
          const selectedId = Number(val);
          state.comparedProfileId = selectedId;
          await renderComparison(selectedId);
        }
      };

      // Trigger initial comparison if state has an active compared profile
      if (state.comparedProfileId && state.comparedProfileId !== profileId) {
        renderComparison(state.comparedProfileId);
      } else {
        renderComparison(null);
      }
    }

    // ==========================================
    // Athlete Video Comparison Engine Logic
    // ==========================================
    const compareVideoSelectA = container.querySelector('#compare-video-select-a');
    const compareVideoAthleteB = container.querySelector('#compare-video-athlete-b');
    const compareVideoSelectB = container.querySelector('#compare-video-select-b');

    if (compareVideoSelectA && compareVideoAthleteB && compareVideoSelectB) {
      
      // Helper function to extract and normalize all videos for an athlete profile
      const getAllVideosForProfile = (prof) => {
        const list = [];
        const addedIds = new Set();

        const addVid = (v, sessionName, typeName) => {
          if (!v || !v.blob || addedIds.has(v.id)) return;
          addedIds.add(v.id);
          list.push({
            id: v.id,
            blob: v.blob,
            name: v.name || `${typeName} (${sessionName})`,
            timestamp: v.timestamp || Date.now(),
            typeName: typeName,
            sessionName: sessionName,
            meta: v
          });
        };

        // 1. Check all sessions
        if (prof.sessions && Array.isArray(prof.sessions)) {
          prof.sessions.forEach(s => {
            const sName = s.name || "Unnamed Session";
            addVid(s.videoSquatL, sName, "Squat Left");
            addVid(s.videoSquatR, sName, "Squat Right");
            addVid(s.videoSquatFrontal, sName, "Squat Frontal");
            addVid(s.videoShoulderL, sName, "Shoulder Left");
            addVid(s.videoShoulderR, sName, "Shoulder Right");
            addVid(s.videoShoulderRotationL, sName, "Shoulder ER/IR Left");
            addVid(s.videoShoulderRotationR, sName, "Shoulder ER/IR Right");
            addVid(s.videoAnkleDorsiL, sName, "Ankle Dorsi Left");
            addVid(s.videoAnkleDorsiR, sName, "Ankle Dorsi Right");
            addVid(s.videoHipRotationL, sName, "Hip Rotation Left");
            addVid(s.videoHipRotationR, sName, "Hip Rotation Right");
            addVid(s.videoThoracicExtension, sName, "Thoracic Extension");
          });
        }

        // 2. Check general archive videos
        if (prof.videos && Array.isArray(prof.videos)) {
          prof.videos.forEach(v => {
            addVid(v, "Archive", v.mode || "General Archive");
          });
        }

        // Sort by timestamp desc
        list.sort((a, b) => b.timestamp - a.timestamp);
        return list;
      };

      // Get list of profiles
      let allProfiles = state.allProfiles || [];
      if (allProfiles.length === 0) {
        allProfiles = await snapshotStore.getAllProfiles();
        state.allProfiles = allProfiles;
      }

      // Populate Athlete B selector
      compareVideoAthleteB.innerHTML = '<option value="">Select Athlete B</option>';
      allProfiles.forEach(p => {
        if (p.id !== profileId) {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.name || `Profile #${p.id}`;
          if (state.comparedVideoAthleteBId && p.id === state.comparedVideoAthleteBId) {
            option.selected = true;
          }
          compareVideoAthleteB.appendChild(option);
        }
      });

      // Track URL objects to revoke on selection change
      let currentUrlA = null;
      let currentUrlB = null;

      const playerA = container.querySelector('#compare-video-player-a');
      const playerB = container.querySelector('#compare-video-player-b');
      const wrapA = container.querySelector('#compare-video-wrap-a');
      const wrapB = container.querySelector('#compare-video-wrap-b');
      const emptyA = container.querySelector('#compare-video-empty-a');
      const emptyB = container.querySelector('#compare-video-empty-b');
      const metaA = container.querySelector('#compare-video-meta-a');
      const metaB = container.querySelector('#compare-video-meta-b');
      const controlBar = container.querySelector('#compare-video-controls');

      const updateControlsVisibility = () => {
        if (controlBar) {
          const sourceA = playerA && playerA.src;
          const sourceB = playerB && playerB.src;
          if (sourceA || sourceB) {
            controlBar.classList.remove('hidden');
          } else {
            controlBar.classList.add('hidden');
          }
        }
      };

      // Populate list of videos for Athlete A (Current)
      const listA = getAllVideosForProfile(profile);
      compareVideoSelectA.innerHTML = '<option value="">Select Video A</option>';
      listA.forEach((v, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${v.typeName} - ${v.sessionName} (${new Date(v.timestamp).toLocaleDateString()})`;
        if (state.comparedVideoIndexA !== undefined && index === state.comparedVideoIndexA) {
          option.selected = true;
        }
        compareVideoSelectA.appendChild(option);
      });

      const loadVideoA = (videoIndex) => {
        if (currentUrlA) {
          URL.revokeObjectURL(currentUrlA);
          currentUrlA = null;
        }

        if (videoIndex === "" || isNaN(videoIndex)) {
          if (playerA) playerA.src = '';
          if (wrapA) wrapA.classList.add('hidden');
          if (emptyA) emptyA.classList.remove('hidden');
          if (metaA) metaA.classList.add('hidden');
          state.comparedVideoIndexA = undefined;
          updateControlsVisibility();
          return;
        }

        const v = listA[videoIndex];
        if (v && v.blob) {
          const safeBlob = getSafeVideoBlob(v);
          currentUrlA = safeBlob ? URL.createObjectURL(safeBlob) : '';
          trackUrl(currentUrlA);
          
          if (playerA) {
            playerA.src = currentUrlA;
            playerA.load();
          }
          if (wrapA) wrapA.classList.remove('hidden');
          if (emptyA) emptyA.classList.add('hidden');
          
          if (metaA) {
            metaA.classList.remove('hidden');
            metaA.innerHTML = `
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: #aaa; background: rgba(255,255,255,0.02); padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">
                <div><strong>Category:</strong> ${v.typeName}</div>
                <div><strong>Session:</strong> ${v.sessionName}</div>
                <div><strong>Recorded:</strong> ${new Date(v.timestamp).toLocaleString()}</div>
                <div><strong>Size:</strong> ${(v.blob.size / (1024 * 1024)).toFixed(1)} MB</div>
              </div>
            `;
          }
          state.comparedVideoIndexA = Number(videoIndex);
        }
        updateControlsVisibility();
      };

      compareVideoSelectA.onchange = (e) => {
        loadVideoA(e.target.value);
      };

      // Populate list of videos for Athlete B
      let listB = [];
      const populateVideosB = async (athleteBId) => {
        if (currentUrlB) {
          URL.revokeObjectURL(currentUrlB);
          currentUrlB = null;
        }

        if (!athleteBId) {
          compareVideoSelectB.innerHTML = '<option value="">Select Video B</option>';
          compareVideoSelectB.disabled = true;
          if (playerB) playerB.src = '';
          if (wrapB) wrapB.classList.add('hidden');
          if (emptyB) emptyB.classList.remove('hidden');
          if (metaB) metaB.classList.add('hidden');
          state.comparedVideoAthleteBId = undefined;
          state.comparedVideoIndexB = undefined;
          updateControlsVisibility();
          return;
        }

        try {
          const otherProfile = await snapshotStore.getProfile(Number(athleteBId));
          if (!otherProfile) return;

          listB = getAllVideosForProfile(otherProfile);
          compareVideoSelectB.innerHTML = '<option value="">Select Video B</option>';
          
          if (listB.length === 0) {
            const opt = document.createElement('option');
            opt.value = "";
            opt.textContent = "No videos recorded";
            compareVideoSelectB.appendChild(opt);
            compareVideoSelectB.disabled = true;
          } else {
            compareVideoSelectB.disabled = false;
            listB.forEach((v, index) => {
              const option = document.createElement('option');
              option.value = index;
              option.textContent = `${v.typeName} - ${v.sessionName} (${new Date(v.timestamp).toLocaleDateString()})`;
              if (state.comparedVideoIndexB !== undefined && index === state.comparedVideoIndexB) {
                option.selected = true;
              }
              compareVideoSelectB.appendChild(option);
            });
          }

          state.comparedVideoAthleteBId = Number(athleteBId);

          if (state.comparedVideoIndexB !== undefined && state.comparedVideoIndexB < listB.length) {
            loadVideoB(state.comparedVideoIndexB);
          } else {
            loadVideoB("");
          }

        } catch (err) {
          console.error("[ComparisonEngine] Error loading athlete B videos:", err);
        }
      };

      const loadVideoB = (videoIndex) => {
        if (currentUrlB) {
          URL.revokeObjectURL(currentUrlB);
          currentUrlB = null;
        }

        if (videoIndex === "" || isNaN(videoIndex)) {
          if (playerB) playerB.src = '';
          if (wrapB) wrapB.classList.add('hidden');
          if (emptyB) emptyB.classList.remove('hidden');
          if (metaB) metaB.classList.add('hidden');
          state.comparedVideoIndexB = undefined;
          updateControlsVisibility();
          return;
        }

        const v = listB[videoIndex];
        if (v && v.blob) {
          const safeBlob = getSafeVideoBlob(v);
          currentUrlB = safeBlob ? URL.createObjectURL(safeBlob) : '';
          trackUrl(currentUrlB);
          
          if (playerB) {
            playerB.src = currentUrlB;
            playerB.load();
          }
          if (wrapB) wrapB.classList.remove('hidden');
          if (emptyB) emptyB.classList.add('hidden');
          
          if (metaB) {
            metaB.classList.remove('hidden');
            metaB.innerHTML = `
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: #aaa; background: rgba(255,255,255,0.02); padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">
                <div><strong>Category:</strong> ${v.typeName}</div>
                <div><strong>Session:</strong> ${v.sessionName}</div>
                <div><strong>Recorded:</strong> ${new Date(v.timestamp).toLocaleString()}</div>
                <div><strong>Size:</strong> ${(v.blob.size / (1024 * 1024)).toFixed(1)} MB</div>
              </div>
            `;
          }
          state.comparedVideoIndexB = Number(videoIndex);
        }
        updateControlsVisibility();
      };

      compareVideoAthleteB.onchange = (e) => {
        state.comparedVideoIndexB = undefined;
        populateVideosB(e.target.value);
      };

      compareVideoSelectB.onchange = (e) => {
        loadVideoB(e.target.value);
      };

      // Wire Unified Sync controls
      const playBtn = container.querySelector('#btn-sync-play');
      const pauseBtn = container.querySelector('#btn-sync-pause');
      const restartBtn = container.querySelector('#btn-sync-restart');
      const speedSelect = container.querySelector('#compare-video-speed');

      if (playBtn) {
        playBtn.onclick = () => {
          if (playerA && playerA.src) playerA.play();
          if (playerB && playerB.src) playerB.play();
        };
      }

      if (pauseBtn) {
        pauseBtn.onclick = () => {
          if (playerA) playerA.pause();
          if (playerB) playerB.pause();
        };
      }

      if (restartBtn) {
        restartBtn.onclick = () => {
          if (playerA) playerA.currentTime = 0;
          if (playerB) playerB.currentTime = 0;
        };
      }

      if (speedSelect) {
        speedSelect.onchange = (e) => {
          const speed = parseFloat(e.target.value) || 1.0;
          if (playerA) playerA.playbackRate = speed;
          if (playerB) playerB.playbackRate = speed;
        };
      }

      // Initial Restore states
      if (state.comparedVideoIndexA !== undefined && state.comparedVideoIndexA < listA.length) {
        loadVideoA(state.comparedVideoIndexA);
      } else {
        loadVideoA("");
      }

      if (state.comparedVideoAthleteBId) {
        populateVideosB(state.comparedVideoAthleteBId);
      } else {
        populateVideosB("");
      }
    }

    const profileDetailsModal = container.querySelector('#profile-details-modal');
    if (profileDetailsModal) {
      profileDetailsModal.classList.add('active');
      if (!preserveTab) {
        const firstTabBtn = document.querySelector('.athlete-tab-btn[data-tab="tab-anthropometrics"]');
        if (firstTabBtn) {
          firstTabBtn.click();
        }
      }
    }

  } catch (err) {
    console.error("[openProfileDetailsModal] Error showing profile details modal:", err);
  }
}


export async function updateProfileUI(profileId, preserveTab = false) {
  if (!profileId) return;
  const modal = document.getElementById('profile-details-modal');
  if (modal && modal.classList.contains('active')) {
    await populateProfileDetails(profileId, modal, preserveTab);
  }
  const leftSidebar = document.getElementById('left-videos-sidebar');
  if (leftSidebar && !leftSidebar.classList.contains('hidden')) {
    await populateProfileDetails(profileId, leftSidebar, true);
  }
}

export async function openProfileDetailsModal(profileId, preserveTab = false) {
  if (!profileId) return;
  const modal = document.getElementById('profile-details-modal');
  if (modal) {
    modal.classList.add('active');
  }
  await updateProfileUI(profileId, preserveTab);
}

export async function renderShoulderRotationGrading(activeSession, container = document) {
  const panel = container.querySelector('#shoulder-rotation-grading-panel');
  if (!panel) return;

  const shRot = getDefaultShoulderRotation(activeSession.shoulderRotation);
  const shPeaks = getDefaultShoulderPeaks(activeSession.shoulderPeaks);
  const sPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
  const hRot = getDefaultHipRotation(activeSession.hipRotation);
  const ankleDorsiPeaks = getDefaultAnkleDorsiPeaks(activeSession.ankleDorsiPeaks);
  const thoracicExtension = getDefaultThoracicExtension(activeSession.thoracicExtension);
  
  const thresholds = await getROMThresholds();
  
  const extThresh = thresholds["External Rotation"] || { low: 60, high: 85 };
  const intThresh = thresholds["Internal Rotation"] || { low: 50, high: 75 };
  const flexThresh = thresholds["Shoulder Flexion"] || { low: 150, high: 170 };
  const kneeThresh = thresholds["Knee Flexion"] || { low: 80, high: 110 };
  const hipExtThresh = thresholds["Hip External Rotation"] || { low: 30, high: 45 };
  const hipIntThresh = thresholds["Hip Internal Rotation"] || { low: 30, high: 45 };
  const ankleDorsiThresh = thresholds["Ankle Dorsiflexion"] || { low: 30, high: 38 };
  const thoracicThresh = thresholds["Thoracic Extension"] || { low: 15, high: 25 };

  const getGradeInfo = (val, thresh) => {
    const absVal = Math.abs(val);
    if (absVal === 0 || isNaN(absVal)) {
      return { grade: null, label: "Unrecorded", color: "#888", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.05)" };
    }
    if (absVal <= thresh.low) {
      return { grade: 1, label: "Poor", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", border: "rgba(239, 68, 68, 0.3)" };
    }
    if (absVal <= thresh.high) {
      return { grade: 2, label: "Functional", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.3)" };
    }
    return { grade: 3, label: "Great", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.3)" };
  };

  // 1. Rotation Grades
  const extGradeL = getGradeInfo(shRot.maxExternalRotationL, extThresh);
  const intGradeL = getGradeInfo(shRot.maxInternalRotationL, intThresh);
  const extGradeR = getGradeInfo(shRot.maxExternalRotationR, extThresh);
  const intGradeR = getGradeInfo(shRot.maxInternalRotationR, intThresh);

  // 2. Flexion Grades
  const flexGradeL = getGradeInfo(shPeaks.excursionL, flexThresh);
  const flexGradeR = getGradeInfo(shPeaks.excursionR, flexThresh);

  // 3. Knee Flexion Grades
  const kneeGradeL = getGradeInfo(sPeaks.kneeL, kneeThresh);
  const kneeGradeR = getGradeInfo(sPeaks.kneeR, kneeThresh);

  // 4. Hip Rotation Grades
  const hipExtGradeL = getGradeInfo(hRot.maxExternalRotationL, hipExtThresh);
  const hipIntGradeL = getGradeInfo(hRot.maxInternalRotationL, hipIntThresh);
  const hipExtGradeR = getGradeInfo(hRot.maxExternalRotationR, hipExtThresh);
  const hipIntGradeR = getGradeInfo(hRot.maxInternalRotationR, hipIntThresh);

  // 5. Ankle Dorsiflexion Grades
  const ankleDorsiGradeL = getGradeInfo(ankleDorsiPeaks.ankleDorsiL || ankleDorsiPeaks.shinAngleL || 0, ankleDorsiThresh);
  const ankleDorsiGradeR = getGradeInfo(ankleDorsiPeaks.ankleDorsiR || ankleDorsiPeaks.shinAngleR || 0, ankleDorsiThresh);

  // 6. Thoracic Extension Grade
  const thoracicGrade = getGradeInfo(thoracicExtension.peakAngle, thoracicThresh);

  panel.innerHTML = `
    <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.5rem; font-family: inherit;">
      <span style="display: flex; align-items: center; gap: 6px;">COMPREHENSIVE RANGE OF MOTION (ROM) ASSESSMENT</span>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 1rem; font-family: inherit;">
      <!-- CATEGORY 1: SHOULDER INTERNAL/EXTERNAL ROTATION -->
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.75rem;">
        <div style="font-size: 0.8rem; font-weight: bold; color: var(--color-gold); margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(212,160,23,0.15); padding-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>Shoulder Internal / External Rotation</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <!-- Left Rotation -->
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #BA0C2F; margin-bottom: 0.4rem; text-align: center; border-bottom: 1px solid rgba(186, 12, 47, 0.15); padding-bottom: 2px;">Left Side</div>
            
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">Internal Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${shRot.maxInternalRotationL ? `${Math.abs(shRot.maxInternalRotationL).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${intGradeL.bg}; border: 1px solid ${intGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${intGradeL.color};">${intGradeL.grade ? `Grade ${intGradeL.grade} (${intGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">External Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${shRot.maxExternalRotationL ? `${Math.abs(shRot.maxExternalRotationL).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${extGradeL.bg}; border: 1px solid ${extGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${extGradeL.color};">${extGradeL.grade ? `Grade ${extGradeL.grade} (${extGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>

          <!-- Right Rotation -->
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #BA0C2F; margin-bottom: 0.4rem; text-align: center; border-bottom: 1px solid rgba(186, 12, 47, 0.15); padding-bottom: 2px;">Right Side</div>
            
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">Internal Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${shRot.maxInternalRotationR ? `${Math.abs(shRot.maxInternalRotationR).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${intGradeR.bg}; border: 1px solid ${intGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${intGradeR.color};">${intGradeR.grade ? `Grade ${intGradeR.grade} (${intGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">External Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${shRot.maxExternalRotationR ? `${Math.abs(shRot.maxExternalRotationR).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${extGradeR.bg}; border: 1px solid ${extGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${extGradeR.color};">${extGradeR.grade ? `Grade ${extGradeR.grade} (${extGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Threshold Legend (Rotation) -->
        <div style="margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06); display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <div style="font-size: 0.65rem; font-weight: bold; color: #aaa; margin-bottom: 1px;">Internal Rotation Cutoffs:</div>
            <div style="font-size: 0.6rem; color: #888; display: flex; justify-content: space-between;">
              <span>G1: &le; ${intThresh.low}°</span> <span>G2: ${intThresh.low + 1}-${intThresh.high}°</span> <span>G3: &gt; ${intThresh.high}°</span>
            </div>
          </div>
          <div>
            <div style="font-size: 0.65rem; font-weight: bold; color: #aaa; margin-bottom: 1px;">External Rotation Cutoffs:</div>
            <div style="font-size: 0.6rem; color: #888; display: flex; justify-content: space-between;">
              <span>G1: &le; ${extThresh.low}°</span> <span>G2: ${extThresh.low + 1}-${extThresh.high}°</span> <span>G3: &gt; ${extThresh.high}°</span>
            </div>
          </div>
        </div>
      </div>

      <!-- CATEGORY 2: SHOULDER FLEXION EXCURSION & SQUAT KNEE FLEXION -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        
        <!-- Shoulder Flexion Card -->
        <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.6rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 0.75rem; font-weight: bold; color: var(--color-gold); margin-bottom: 0.4rem; border-bottom: 1px solid rgba(212,160,23,0.15); padding-bottom: 2px; text-transform: uppercase;">
              Shoulder Flexion
            </div>
            
            <!-- Left Flexion -->
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1px;">
                <span style="font-size: 0.68rem; color: #ccc;">Left Excursion:</span>
                <span style="font-size: 0.7rem; font-weight: bold; color: #fff;">${shPeaks.excursionL ? `${shPeaks.excursionL.toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${flexGradeL.bg}; border: 1px solid ${flexGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.58rem; color: #999;">Grade:</span>
                <span style="font-size: 0.62rem; font-weight: bold; color: ${flexGradeL.color};">${flexGradeL.grade ? `Grade ${flexGradeL.grade} (${flexGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>

            <!-- Right Flexion -->
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1px;">
                <span style="font-size: 0.68rem; color: #ccc;">Right Excursion:</span>
                <span style="font-size: 0.7rem; font-weight: bold; color: #fff;">${shPeaks.excursionR ? `${shPeaks.excursionR.toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${flexGradeR.bg}; border: 1px solid ${flexGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.58rem; color: #999;">Grade:</span>
                <span style="font-size: 0.62rem; font-weight: bold; color: ${flexGradeR.color};">${flexGradeR.grade ? `Grade ${flexGradeR.grade} (${flexGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>

          <!-- Thresholds -->
          <div style="margin-top: 0.4rem; padding-top: 0.3rem; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 0.62rem; font-weight: bold; color: #aaa; margin-bottom: 1px;">Shoulder Flexion Cutoffs:</div>
            <div style="font-size: 0.58rem; color: #888; display: flex; justify-content: space-between;">
              <span>G1: &le; ${flexThresh.low}°</span> <span>G2: ${flexThresh.low + 1}-${flexThresh.high}°</span> <span>G3: &gt; ${flexThresh.high}°</span>
            </div>
          </div>
        </div>

        <!-- Knee Flexion Card -->
        <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.6rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 0.75rem; font-weight: bold; color: var(--color-gold); margin-bottom: 0.4rem; border-bottom: 1px solid rgba(212,160,23,0.15); padding-bottom: 2px; text-transform: uppercase;">
              Knee Flexion (Squat)
            </div>
            
            <!-- Left Knee -->
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1px;">
                <span style="font-size: 0.68rem; color: #ccc;">Left Knee:</span>
                <span style="font-size: 0.7rem; font-weight: bold; color: #fff;">${sPeaks.kneeL ? `${sPeaks.kneeL.toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${kneeGradeL.bg}; border: 1px solid ${kneeGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.58rem; color: #999;">Grade:</span>
                <span style="font-size: 0.62rem; font-weight: bold; color: ${kneeGradeL.color};">${kneeGradeL.grade ? `Grade ${kneeGradeL.grade} (${kneeGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>

            <!-- Right Knee -->
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1px;">
                <span style="font-size: 0.68rem; color: #ccc;">Right Knee:</span>
                <span style="font-size: 0.7rem; font-weight: bold; color: #fff;">${sPeaks.kneeR ? `${sPeaks.kneeR.toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${kneeGradeR.bg}; border: 1px solid ${kneeGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.58rem; color: #999;">Grade:</span>
                <span style="font-size: 0.62rem; font-weight: bold; color: ${kneeGradeR.color};">${kneeGradeR.grade ? `Grade ${kneeGradeR.grade} (${kneeGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>

          <!-- Thresholds -->
          <div style="margin-top: 0.4rem; padding-top: 0.3rem; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 0.62rem; font-weight: bold; color: #aaa; margin-bottom: 1px;">Knee Flexion Cutoffs:</div>
            <div style="font-size: 0.58rem; color: #888; display: flex; justify-content: space-between;">
              <span>G1: &le; ${kneeThresh.low}°</span> <span>G2: ${kneeThresh.low + 1}-${kneeThresh.high}°</span> <span>G3: &gt; ${kneeThresh.high}°</span>
            </div>
          </div>
        </div>

      </div>

      <!-- CATEGORY 3: HIP INTERNAL/EXTERNAL ROTATION -->
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.75rem;">
        <div style="font-size: 0.8rem; font-weight: bold; color: var(--color-gold); margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(212,160,23,0.15); padding-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>Hip Internal / External Rotation</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <!-- Left Hip Rotation -->
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #10b981; margin-bottom: 0.4rem; text-align: center; border-bottom: 1px solid rgba(16,185,129,0.1); padding-bottom: 2px;">Left Side</div>
            
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">Internal Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${hRot.maxInternalRotationL ? `${Math.abs(hRot.maxInternalRotationL).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${hipIntGradeL.bg}; border: 1px solid ${hipIntGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${hipIntGradeL.color};">${hipIntGradeL.grade ? `Grade ${hipIntGradeL.grade} (${hipIntGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">External Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${hRot.maxExternalRotationL ? `${Math.abs(hRot.maxExternalRotationL).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${hipExtGradeL.bg}; border: 1px solid ${hipExtGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${hipExtGradeL.color};">${hipExtGradeL.grade ? `Grade ${hipExtGradeL.grade} (${hipExtGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>

          <!-- Right Hip Rotation -->
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #10b981; margin-bottom: 0.4rem; text-align: center; border-bottom: 1px solid rgba(16,185,129,0.1); padding-bottom: 2px;">Right Side</div>
            
            <div style="margin-bottom: 0.4rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">Internal Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${hRot.maxInternalRotationR ? `${Math.abs(hRot.maxInternalRotationR).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${hipIntGradeR.bg}; border: 1px solid ${hipIntGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${hipIntGradeR.color};">${hipIntGradeR.grade ? `Grade ${hipIntGradeR.grade} (${hipIntGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">External Rotation:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${hRot.maxExternalRotationR ? `${Math.abs(hRot.maxExternalRotationR).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${hipExtGradeR.bg}; border: 1px solid ${hipExtGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${hipExtGradeR.color};">${hipExtGradeR.grade ? `Grade ${hipExtGradeR.grade} (${hipExtGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Threshold Legend (Hip Rotation) -->
        <div style="margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06); display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <div style="font-size: 0.65rem; font-weight: bold; color: #aaa; margin-bottom: 1px;">Hip Internal Rotation Cutoffs:</div>
            <div style="font-size: 0.6rem; color: #888; display: flex; justify-content: space-between;">
              <span>G1: &le; ${hipIntThresh.low}°</span> <span>G2: ${hipIntThresh.low + 1}-${hipIntThresh.high}°</span> <span>G3: &gt; ${hipIntThresh.high}°</span>
            </div>
          </div>
          <div>
            <div style="font-size: 0.65rem; font-weight: bold; color: #aaa; margin-bottom: 1px;">Hip External Rotation Cutoffs:</div>
            <div style="font-size: 0.6rem; color: #888; display: flex; justify-content: space-between;">
              <span>G1: &le; ${hipExtThresh.low}°</span> <span>G2: ${hipExtThresh.low + 1}-${hipExtThresh.high}°</span> <span>G3: &gt; ${hipExtThresh.high}°</span>
            </div>
          </div>
        </div>
      </div>

      <!-- CATEGORY 4: ANKLE DORSIFLEXION / TIBIAL INCLINATION -->
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.75rem;">
        <div style="font-size: 0.8rem; font-weight: bold; color: var(--color-gold); margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(212,160,23,0.15); padding-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>Ankle Dorsiflexion (Tibial Inclination)</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <!-- Left Ankle Dorsiflexion -->
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #10b981; margin-bottom: 0.4rem; text-align: center; border-bottom: 1px solid rgba(16,185,129,0.1); padding-bottom: 2px;">Left Side</div>
            
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">Peak Dorsiflexion:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${(ankleDorsiPeaks.ankleDorsiL || ankleDorsiPeaks.shinAngleL) ? `${(ankleDorsiPeaks.ankleDorsiL || ankleDorsiPeaks.shinAngleL).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${ankleDorsiGradeL.bg}; border: 1px solid ${ankleDorsiGradeL.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${ankleDorsiGradeL.color};">${ankleDorsiGradeL.grade ? `Grade ${ankleDorsiGradeL.grade} (${ankleDorsiGradeL.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>

          <!-- Right Ankle Dorsiflexion -->
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #10b981; margin-bottom: 0.4rem; text-align: center; border-bottom: 1px solid rgba(16,185,129,0.1); padding-bottom: 2px;">Right Side</div>
            
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-size: 0.7rem; color: #ccc;">Peak Dorsiflexion:</span>
                <span style="font-size: 0.75rem; font-weight: bold; color: #fff;">${(ankleDorsiPeaks.ankleDorsiR || ankleDorsiPeaks.shinAngleR) ? `${(ankleDorsiPeaks.ankleDorsiR || ankleDorsiPeaks.shinAngleR).toFixed(1)}°` : '--'}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${ankleDorsiGradeR.bg}; border: 1px solid ${ankleDorsiGradeR.border}; border-radius: 3px;">
                <span style="font-size: 0.6rem; color: #999;">Grade:</span>
                <span style="font-size: 0.65rem; font-weight: bold; color: ${ankleDorsiGradeR.color};">${ankleDorsiGradeR.grade ? `Grade ${ankleDorsiGradeR.grade} (${ankleDorsiGradeR.label})` : 'Unrecorded'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Threshold Legend (Ankle Dorsiflexion) -->
        <div style="margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.65rem; font-weight: bold; color: #aaa;">Ankle Dorsiflexion Cutoffs:</div>
          <div style="font-size: 0.6rem; color: #888; display: flex; gap: 15px;">
            <span>G1: &le; ${ankleDorsiThresh.low}°</span> <span>G2: ${ankleDorsiThresh.low + 1}-${ankleDorsiThresh.high}°</span> <span>G3: &gt; ${ankleDorsiThresh.high}°</span>
          </div>
        </div>
      </div>

      <!-- CATEGORY 5: THORACIC EXTENSION -->
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.75rem;">
        <div style="font-size: 0.8rem; font-weight: bold; color: var(--color-gold); margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(212,160,23,0.15); padding-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>Thoracic Extension Mobility</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr; gap: 0.75rem;">
          <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <span style="font-size: 0.75rem; color: #ccc;">Peak Thoracic Extension:</span>
              <span style="font-size: 0.8rem; font-weight: bold; color: #fff;">${thoracicExtension.peakAngle ? `${thoracicExtension.peakAngle.toFixed(1)}°` : '--'}</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; background: ${thoracicGrade.bg}; border: 1px solid ${thoracicGrade.border}; border-radius: 3px;">
              <span style="font-size: 0.6rem; color: #999;">Grade:</span>
              <span style="font-size: 0.65rem; font-weight: bold; color: ${thoracicGrade.color};">${thoracicGrade.grade ? `Grade ${thoracicGrade.grade} (${thoracicGrade.label})` : 'Unrecorded'}</span>
            </div>
          </div>
        </div>

        <!-- Threshold Legend (Thoracic Extension) -->
        <div style="margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.65rem; font-weight: bold; color: #aaa;">Thoracic Extension Cutoffs:</div>
          <div style="font-size: 0.6rem; color: #888; display: flex; gap: 15px;">
            <span>G1: &le; ${thoracicThresh.low}°</span> <span>G2: ${thoracicThresh.low + 1}-${thoracicThresh.high}°</span> <span>G3: &gt; ${thoracicThresh.high}°</span>
          </div>
        </div>
      </div>

      <!-- ADVICE / COACHING TAB HUB -->
      <div style="background: rgba(186, 12, 47, 0.02); border: 1px dashed rgba(186, 12, 47, 0.25); border-radius: 8px; padding: 0.75rem; margin-top: 0.5rem;">
        <div style="font-size: 0.8rem; font-weight: bold; color: #BA0C2F; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid rgba(186, 12, 47, 0.15); padding-bottom: 0.25rem; text-transform: uppercase;">
          <span>Dynamic Corrective Advice & Coaching</span>
        </div>
        
        <!-- Mobility Level Definitions -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; background: rgba(0, 0, 0, 0.2); border-radius: 6px; padding: 0.6rem; margin-bottom: 0.75rem; border: 1px solid rgba(255, 255, 255, 0.04); font-size: 0.725rem; line-height: 1.4;">
          <div style="border-left: 3px solid #ef4444; padding-left: 6px;">
            <strong style="color: #ef4444; display: block; margin-bottom: 2px; text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.5px;">Restricted</strong>
            <span style="color: #cbd5e1;">High risk of injury for the tested body part; movement is limited, compensatory, or dysfunctional.</span>
          </div>
          <div style="border-left: 3px solid #f59e0b; padding-left: 6px;">
            <strong style="color: #f59e0b; display: block; margin-bottom: 2px; text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.5px;">Functional</strong>
            <span style="color: #cbd5e1;">Movement is adequate and safe for sport, but not yet efficient or fully expressed.</span>
          </div>
          <div style="border-left: 3px solid #10b981; padding-left: 6px;">
            <strong style="color: #10b981; display: block; margin-bottom: 2px; text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.5px;">Optimal</strong>
            <span style="color: #cbd5e1;">Movement is efficient, controlled, and expressed through the intended joint or segment with no compensation.</span>
          </div>
        </div>
        
        ${(() => {
          const adviceItems = [];
          
          const hipIntL = hRot.maxInternalRotationL || 0;
          const hipIntR = hRot.maxInternalRotationR || 0;
          const hipExtL = hRot.maxExternalRotationL || 0;
          const hipExtR = hRot.maxExternalRotationR || 0;
          
          const shIntL = shRot.maxInternalRotationL || 0;
          const shIntR = shRot.maxInternalRotationR || 0;
          const shExtL = shRot.maxExternalRotationL || 0;
          const shExtR = shRot.maxExternalRotationR || 0;
          
          const shFlexL = shPeaks.excursionL || 0;
          const shFlexR = shPeaks.excursionR || 0;

          // ==========================================
          // 1. HIP INTERNAL/EXTERNAL ROTATION RULES
          // ==========================================
          
          // Rule 1.1: Hip Internal Rotation < 25° (on either side)
          const hasLowHipIR_L = hipIntL > 0 && hipIntL < 25;
          const hasLowHipIR_R = hipIntR > 0 && hipIntR < 25;
          if (hasLowHipIR_L || hasLowHipIR_R) {
            let sideLabel = "";
            if (hasLowHipIR_L && hasLowHipIR_R) sideLabel = "Both Sides";
            else if (hasLowHipIR_L) sideLabel = "Left Side";
            else sideLabel = "Right Side";

            adviceItems.push({
              metric: "Hip IR < 25°",
              sides: sideLabel,
              title: "Restricted Hip Internal Rotation",
              desc: "Mobility is below the recommended 25° functional baseline.",
              bullets: [
                "**90/90 hip stretch** (both IR and ER position)",
                "**prone hip IR self-mob with belt**",
                "**hip joint capsule posterior glide mobilisation**"
              ]
            });
          }

          // Rule 1.2: Hip Internal Rotation Asymmetry > 10°
          if (hipIntL > 0 && hipIntR > 0) {
            const diff = Math.abs(hipIntL - hipIntR);
            if (diff > 10) {
              const restrictedSide = hipIntL < hipIntR ? "Left Side" : "Right Side";
              adviceItems.push({
                metric: `Hip IR Asymmetry > 10° (Delta: ${diff.toFixed(1)}°)`,
                sides: `${restrictedSide} Restricted`,
                title: "Hip Internal Rotation Asymmetry",
                desc: `Significant structural or muscular imbalance detected between sides (${diff.toFixed(1)}° difference).`,
                bullets: [
                  "**Prioritise restricted side**: SL hip IR strengthening (clamshell variation with IR bias)",
                  "**manual therapy referral** if structural cause suspected"
                ]
              });
            }
          }

          // Rule 1.3: Hip External Rotation < 35° (on either side)
          const hasLowHipER_L = hipExtL > 0 && hipExtL < 35;
          const hasLowHipER_R = hipExtR > 0 && hipExtR < 35;
          if (hasLowHipER_L || hasLowHipER_R) {
            let sideLabel = "";
            if (hasLowHipER_L && hasLowHipER_R) sideLabel = "Both Sides";
            else if (hasLowHipER_L) sideLabel = "Left Side";
            else sideLabel = "Right Side";

            adviceItems.push({
              metric: "Hip ER < 35°",
              sides: sideLabel,
              title: "Restricted Hip External Rotation",
              desc: "Mobility is below the recommended 35° functional baseline.",
              bullets: [
                "**Figure-4 stretch**",
                "**pigeon pose**",
                "**lateral hip rotator mobilisation**",
                "**seated hip ER with resistance band**"
              ]
            });
          }

          // ==========================================
          // 2. SHOULDER INTERNAL/EXTERNAL ROTATION RULES
          // ==========================================
          
          // Rule 2.1: Shoulder External Rotation < 70° bilateral (both sides under 70)
          if (shExtL > 0 && shExtR > 0 && shExtL < 70 && shExtR < 70) {
            adviceItems.push({
              metric: "Shoulder ER < 70° Bilateral",
              sides: "Bilateral",
              title: "Restricted Shoulder External Rotation",
              desc: "Both shoulders fall short of the 70° external rotation baseline.",
              bullets: [
                "**Anterior capsule stretching** (sleeper modified, doorway stretch)",
                "**subscapularis release**",
                "**horizontal abduction stretch with arm at 90°**"
              ]
            });
          }

          // Rule 2.2: Net Arc Deficit > 10°
          if (shIntL > 0 && shIntR > 0 && shExtL > 0 && shExtR > 0) {
            const netArcL = shIntL + shExtL;
            const netArcR = shIntR + shExtR;
            const diff = Math.abs(netArcL - netArcR);
            if (diff > 10) {
              const restrictedSide = netArcL < netArcR ? "Left Side" : "Right Side";
              adviceItems.push({
                metric: `Net Arc Deficit > 10° (Delta: ${diff.toFixed(1)}°)`,
                sides: `${restrictedSide} Restricted`,
                title: "Shoulder Total Motion Arc Deficit",
                desc: `Imbalance in total rotational range (IR + ER) exceeds 10° (${diff.toFixed(1)}° difference).`,
                bullets: [
                  "**See Net Rotation Arc screen** — requires combined IR and ER intervention strategy based on where the arc is lost"
                ]
              });
            }
          }

          // Rule 2.3: GIRD > 20° (Glenohumeral Internal Rotation Deficit)
          if (shIntL > 0 && shIntR > 0) {
            const diff = Math.abs(shIntL - shIntR);
            if (diff > 20) {
              const restrictedSide = shIntL < shIntR ? "Left Side" : "Right Side";
              adviceItems.push({
                metric: `GIRD > 20° (Delta: ${diff.toFixed(1)}°)`,
                sides: `${restrictedSide} Restricted`,
                title: "Shoulder Internal Rotation Deficit (GIRD)",
                desc: `Imbalance in internal rotation between sides exceeds 20° (${diff.toFixed(1)}° difference).`,
                bullets: [
                  "**Sleeper stretch** (prone, arm over edge, gentle IR of humerus)",
                  "**cross-body horizontal adduction stretch**",
                  "**posterior capsule manual mobilisation**"
                ]
              });
            }
          }

          // Rule 2.4: Bilateral IR < 50°
          if (shIntL > 0 && shIntR > 0 && shIntL < 50 && shIntR < 50) {
            adviceItems.push({
              metric: "Shoulder IR < 50° Bilateral",
              sides: "Bilateral",
              title: "Bilateral Shoulder Internal Rotation Deficit",
              desc: "Both shoulders fall short of the 50° internal rotation baseline.",
              bullets: [
                "**Bilateral posterior capsule tightness** — common in swimmers and weight room athletes",
                "**foam roller lat release** + **bilateral sleeper stretch program**"
              ]
            });
          }

          // ==========================================
          // 3. SHOULDER FLEXION RULES
          // ==========================================
          
          // Rule 3.1: Shoulder Flexion < 150° Bilateral
          if (shFlexL > 0 && shFlexR > 0 && shFlexL < 150 && shFlexR < 150) {
            adviceItems.push({
              metric: "Shoulder Flexion < 150° Bilateral",
              sides: "Bilateral",
              title: "Restricted Shoulder Flexion",
              desc: "Both shoulder flexion excursions are below the 150° functional baseline.",
              bullets: [
                "**Doorway stretch** (chest and anterior shoulder)",
                "**overhead lat stretch**",
                "**wall slide with thoracic extension**",
                "**wall slide with thoracic extension**",
                "**thoracic foam roll + arm reach overhead**"
              ]
            });
          }

          if (Math.abs(shFlexL - shFlexR) > 10) {
            adviceItems.push({
              metric: "Shoulder Flexion Asymmetry",
              sides: "Bilateral",
              title: "Restricted Shoulder Flexion",
              desc: `Imbalance in internal rotation between sides exceeds 10° (${Math.abs(shFlexL - shFlexR)}° difference).`,
              bullets: [
                "**Unilateral dumbbell flexion raises",
                "**Single‑arm overhead holds**",
                "**Thoracic extension over foam roller**",
                "**Wall lateral stretch**",
                "**thoracic foam roll**"
              ]
            });
          }

          // ==========================================
          // 4. KNEE VALGUS (CAVE-IN) RULES
          // ==========================================
          const staticValgusL = (activeSession.jointsOverhead) ? (calculateValgusFromJoints(activeSession.jointsOverhead).pctL || 0) : 0;
          const staticValgusR = (activeSession.jointsOverhead) ? (calculateValgusFromJoints(activeSession.jointsOverhead).pctR || 0) : 0;
          const vidValgusL = sPeaks.maxKneeCaveL || 0;
          const vidValgusR = sPeaks.maxKneeCaveR || 0;
          
          const maxStaticCave = Math.max(staticValgusL, staticValgusR);
          const maxVideoCave = Math.max(vidValgusL, vidValgusR);
          const peakCave = Math.max(maxStaticCave, maxVideoCave);
          
          if (peakCave >= 3.0) {
            let severity = "Mild";
            if (peakCave > 15.0) {
              severity = "Severe";
            } else if (peakCave > 8.0) {
              severity = "Moderate";
            }
            
            let sourceLabel = maxVideoCave >= maxStaticCave ? "Video" : "Static";
            let sideLabel = "";
            let lVal = maxVideoCave >= maxStaticCave ? vidValgusL : staticValgusL;
            let rVal = maxVideoCave >= maxStaticCave ? vidValgusR : staticValgusR;
            
            if (lVal >= 3.0 && rVal >= 3.0) sideLabel = "Bilateral";
            else if (lVal >= 3.0) sideLabel = "Left Side";
            else sideLabel = "Right Side";
            
            adviceItems.push({
              metric: `Knee Valgus (${sourceLabel}): ${peakCave.toFixed(1)}°`,
              sides: sideLabel,
              title: `${severity} Knee Valgus (Cave-In)`,
              desc: `Knee tracking inward deviation detected during squat assessment (Peak: L: ${lVal.toFixed(1)}°, R: ${rVal.toFixed(1)}°).`,
              bullets: [
                "**Reactive Neuromuscular Training (RNT) Squats**: Perform squats with a resistance band looped around your knees pulling them inward to actively force hip abduction and outward tracking.",
                "**Lateral Hip Rotator & Glute Strengthening**: Perform clamshells, monster walks, and single-leg glute bridges to strengthen hip abductors.",
                "**Ankle Dorsiflexion Mobility**: Address restricted calf/soleus tissues and ankle joint capsule limitations using weight-bearing dorsiflexion stretches."
              ]
            });
          }

          // ==========================================
          // 4.5. KNEE VARUS (BOW-OUT) RULES
          // ==========================================
          const staticVarusL = (activeSession.jointsOverhead) ? (calculateVarusFromJoints(activeSession.jointsOverhead).pctL || 0) : 0;
          const staticVarusR = (activeSession.jointsOverhead) ? (calculateVarusFromJoints(activeSession.jointsOverhead).pctR || 0) : 0;
          const vidVarusL = sPeaks.maxKneeBowL || 0;
          const vidVarusR = sPeaks.maxKneeBowR || 0;
          
          const maxStaticBow = Math.max(staticVarusL, staticVarusR);
          const maxVideoBow = Math.max(vidVarusL, vidVarusR);
          const peakBow = Math.max(maxStaticBow, maxVideoBow);
          
          if (peakBow >= 3.0) {
            let severity = "Mild";
            if (peakBow > 15.0) {
              severity = "Severe";
            } else if (peakBow > 8.0) {
              severity = "Moderate";
            }
            
            let sourceLabel = maxVideoBow >= maxStaticBow ? "Video" : "Static";
            let sideLabel = "";
            let lVal = maxVideoBow >= maxStaticBow ? vidVarusL : staticVarusL;
            let rVal = maxVideoBow >= maxStaticBow ? vidVarusR : staticVarusR;
            
            if (lVal >= 3.0 && rVal >= 3.0) sideLabel = "Bilateral";
            else if (lVal >= 3.0) sideLabel = "Left Side";
            else sideLabel = "Right Side";
            
            adviceItems.push({
              metric: `Knee Varus (${sourceLabel}): ${peakBow.toFixed(1)}°`,
              sides: sideLabel,
              title: `${severity} Knee Varus (Bow-Out)`,
              desc: `Knee tracking outward deviation detected during squat assessment (Peak: L: ${lVal.toFixed(1)}°, R: ${rVal.toFixed(1)}°).`,
              bullets: [
                "**Outer Hip/TFL Release**: Stretch and roll the Tensor Fasciae Latae (TFL) and lateral hamstring structures which can contribute to outward knee bowing.",
                "**Adductor Activation and Core Integration**: Perform squeeze-ball squats or adductor slides to strengthen the inner thigh stabilizers.",
                "**Symmetric Foot/Ankle Loading**: Ensure proper weight distribution across the first metatarsal head (big toe knuckle) to prevent rolling onto the outer edges of the feet."
              ]
            });
          }

          // ==========================================
          // 5. ANKLE DORSIFLEXION RULES
          // ==========================================
          const anklePeakL = ankleDorsiPeaks.ankleDorsiL || ankleDorsiPeaks.shinAngleL || 0;
          const anklePeakR = ankleDorsiPeaks.ankleDorsiR || ankleDorsiPeaks.shinAngleR || 0;

          // Rule 5.1: < 30° bilateral
          if (anklePeakL > 0 && anklePeakR > 0 && anklePeakL < 30 && anklePeakR < 30) {
            adviceItems.push({
              metric: "Ankle DF < 30° Bilateral",
              sides: "Bilateral",
              title: "Severe Ankle Dorsiflexion Restriction",
              desc: "Bilateral tibial inclination/ankle dorsiflexion is restricted below 30°.",
              bullets: [
                "**Banded talocrural joint mobilisation**",
                "**eccentric calf loading (Alfredson protocol variant)**"
              ]
            });
          } else {
            // Rule 5.2: 30–38°
            const hasRestrictedDF_L = anklePeakL > 0 && anklePeakL >= 30 && anklePeakL <= 38;
            const hasRestrictedDF_R = anklePeakR > 0 && anklePeakR >= 30 && anklePeakR <= 38;
            if (hasRestrictedDF_L || hasRestrictedDF_R) {
              let sideLabel = "";
              if (hasRestrictedDF_L && hasRestrictedDF_R) sideLabel = "Bilateral";
              else if (hasRestrictedDF_L) sideLabel = "Left Side";
              else sideLabel = "Right Side";

              adviceItems.push({
                metric: "Ankle DF 30–38°",
                sides: sideLabel,
                title: "Moderate Ankle Dorsiflexion Restriction",
                desc: "Ankle mobility is functional but has room for optimal progression.",
                bullets: [
                  "**Weighted heel raise with full DF at top**",
                  "**half-kneeling ankle mobility drill with band**"
                ]
              });
            }
          }

          // Rule 5.3: Asymmetry > 5°
          if (anklePeakL > 0 && anklePeakR > 0) {
            const diff = Math.abs(anklePeakL - anklePeakR);
            if (diff > 5) {
              const restrictedSide = anklePeakL < anklePeakR ? "Left Side" : "Right Side";
              adviceItems.push({
                metric: `Ankle Asymmetry > 5° (Delta: ${diff.toFixed(1)}°)`,
                sides: `${restrictedSide} Restricted`,
                title: "Ankle Dorsiflexion Asymmetry",
                desc: `Significant range of motion asymmetry detected between the left and right ankles (${diff.toFixed(1)}° difference).`,
                bullets: [
                  "**Unilateral calf stretch and banded mob** prioritised on restricted side",
                  "**loaded single-leg calf raise**"
                ]
              });
            }
          }

          // ==========================================
          // 6. THORACIC EXTENSION RULES
          // ==========================================
          const thoracicPeak = thoracicExtension.peakAngle || 0;
          
          if (thoracicPeak > 0 && thoracicPeak < thoracicThresh.low) {
            adviceItems.push({
              metric: `Thoracic Ext < ${thoracicThresh.low}°`,
              sides: "Spine",
              title: "Restricted Thoracic Extension",
              desc: `Your thoracic extension peak of ${thoracicPeak.toFixed(1)}° is below the functional threshold of ${thoracicThresh.low}°.`,
              bullets: [
                "**Thoracic foam rolling & extension**: Use a foam roller placed mid-back, supporting your head, and perform gentle extension over the roller.",
                "**Bench thoracic extensions**: Kneel in front of a bench, place elbows on the bench holding a dowel, and let your head sink between your shoulders.",
                "**Prone press-ups**: Lay on your stomach and perform gentle press-ups to actively extend your thoracic spine."
              ]
            });
          } else if (thoracicPeak > 0 && thoracicPeak >= thoracicThresh.low && thoracicPeak <= thoracicThresh.high) {
            adviceItems.push({
              metric: `Thoracic Ext ${thoracicThresh.low}–${thoracicThresh.high}°`,
              sides: "Spine",
              title: "Functional Thoracic Extension",
              desc: `Your thoracic extension peak of ${thoracicPeak.toFixed(1)}° is functional but has room for optimal athletic progression.`,
              bullets: [
                "**Quadruped rotation with extension**: Position yourself on all fours, place one hand behind your head, and rotate your elbow up towards the ceiling.",
                "**Cat-cow stretches**: Perform slow cat-cow movements, focusing specifically on articulating your upper/mid-back."
              ]
            });
          }

          if (adviceItems.length > 0) {
            return `
              <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                ${adviceItems.map(item => `
                  <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; padding: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                      <span style="font-size: 0.75rem; font-weight: bold; color: #fff; display: flex; align-items: center; gap: 4px;">
                        ${item.title} (${item.sides})
                      </span>
                      <span style="font-size: 0.6rem; font-weight: bold; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; background: rgba(255, 159, 67, 0.15); border: 1px solid rgba(255, 159, 67, 0.3); color: #ff9f43;">
                        ${item.metric}
                      </span>
                    </div>
                    <div style="font-size: 0.7rem; color: #bbb; margin-bottom: 0.4rem;">${item.desc}</div>
                    <ul style="margin: 0; padding-left: 1.1rem; font-size: 0.68rem; color: #eee; display: flex; flex-direction: column; gap: 3px;">
                      ${item.bullets.map(bullet => `<li style="line-height: 1.2;">${bullet.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}
                    </ul>
                  </div>
                `).join('')}
              </div>
            `;
          } else {
            return `
              <div style="text-align: center; padding: 0.5rem; color: #888; font-size: 0.72rem;">
                No significant range of motion issues detected across active hip or shoulder profiles.
              </div>
            `;
          }
        })()}
      </div>

    </div>
  `;
}

export function closeProfileDetailsModal() {
  const profileDetailsModal = document.getElementById('profile-details-modal');
  if (profileDetailsModal) {
    profileDetailsModal.classList.remove('active');
  }

  state.activeModalVideoProcessing = false;
  state.isModalVideoInferenceLoopRunning = false;
  clearSmoothBuffer('*');
  state.latestPoseResults = null;
  state.latestHandResults = null;
  state.lastModalInferenceSrc = null;

  const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.style.display = 'none';
  }

  const currentFullscreenElement = document.fullscreenElement || 
                                   document.webkitFullscreenElement || 
                                   document.mozFullScreenElement || 
                                   document.msFullscreenElement;
  if (currentFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(e => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  setTimeout(() => {
    if (state.modalObjectUrls) {
      const mainVideoPlayer = document.getElementById('profile-details-video-player');
      const activePlayingUrl = mainVideoPlayer ? mainVideoPlayer.src : '';
      state.modalObjectUrls.forEach(url => {
        if (activePlayingUrl && activePlayingUrl.includes(url)) {
          return;
        }
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      });
      state.modalObjectUrls = [];
    }
  }, 150);

  state.isEditingProfileMetrics = false;

  const canvas = document.getElementById('profile-details-video-canvas');
  if (canvas) {
    canvas.style.display = 'none';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function startModalVideoInferenceLoop() {
  // Replay Mode: Disable pose detection and drawing during replay
  state.isModalVideoInferenceLoopRunning = false;
}

export async function triggerSingleModalVideoInference() {
  // Replay Mode: Disable single frame inference
}

export function drawModalVideoPoseOverlay(results) {
  const canvas = document.getElementById('profile-details-video-canvas');
  if (canvas) {
    canvas.style.display = 'none';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
