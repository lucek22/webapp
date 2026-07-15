// =========================================================
// BUCKEYE PERSISTENT SUBJECT PROFILES MANAGER MODULE
// =========================================================

import { state, snapshotStore, formatLength, clearSmoothBuffer, getROMThresholds, getDefaultROMThresholds, calculateROMGrade } from './helpers.js';
import { getDefaultSquatPeaks, calculateValgusFromJoints } from './squatController.js';
import { getDefaultShoulderPeaks, getShoulderWristAngle, updateShoulderSidebarUI } from './shoulderController.js';
import { getDefaultShoulderRotation } from './shoulderRotationController.js';
import { getDefaultHipRotation } from './hipRotationController.js';
import { compileAndDownloadCombinedSession } from './reportCompiler.js';
import { pose, calculatePoseMetrics } from './mediapipeLogic.js';

// We import renderDashboard, updateDashboardOfflinePlaceholders, setUnitSystem from userController.js
// Since these are late-invoked inside interactive handlers, circular references are resolved fine by ES module loader.
// We register callbacks to break circular references
let renderDashboardFn = null;
let updateDashboardOfflinePlaceholdersFn = null;
let setUnitSystemFn = null;

export function registerProfileCallbacks(config) {
  renderDashboardFn = config.renderDashboard;
  updateDashboardOfflinePlaceholdersFn = config.updateDashboardOfflinePlaceholders;
  setUnitSystemFn = config.setUnitSystem;
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

export async function initializeProfilesSelector() {
  const profileSelect = document.getElementById('profile-select');
  const calProfileSelect = document.getElementById('cal-profile-select');
  const profileSearchInput = document.getElementById('profile-search-input');
  const btnSaveProfile = document.getElementById('btn-save-profile');
  const subjectNameInput = document.getElementById('subject-name-input');
  const btnDeleteProfile = document.getElementById('btn-delete-profile');
  const profileStatusBar = document.getElementById('profile-status-bar');
  const newProfileInputContainer = document.getElementById('new-profile-input-container');

  const profileActionRow = document.getElementById('profile-action-row');
  const btnViewProfileDetails = document.getElementById('btn-view-profile-details');
  const btnCloseProfileDetails = document.getElementById('btn-close-profile-details');
  const btnCloseProfileDetailsFooter = document.getElementById('btn-close-profile-details-footer');
  const btnProfileExportJson = document.getElementById('btn-profile-export-json');
  const modalUnitInchBtn = document.getElementById('modal-unit-inch-btn');
  const modalUnitCmBtn = document.getElementById('modal-unit-cm-btn');

  if (!profileSelect) return;

  function populateDropdown(filteredProfiles) {
    const currentSelected = profileSelect.value;
    profileSelect.innerHTML = '';
    
    const guestOpt = document.createElement('option');
    guestOpt.value = '';
    guestOpt.textContent = '-- Guest Session (Unsaved) --';
    profileSelect.appendChild(guestOpt);

    if (calProfileSelect) {
      calProfileSelect.innerHTML = '';
      const calGuestOpt = document.createElement('option');
      calGuestOpt.value = '';
      calGuestOpt.textContent = '-- Guest Session (Unsaved) --';
      calProfileSelect.appendChild(calGuestOpt);
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
    createOpt.textContent = '+ Create New Profile...';
    profileSelect.appendChild(createOpt);

    if (currentSelected && [...profileSelect.options].some(o => o.value === currentSelected)) {
      profileSelect.value = currentSelected;
    } else {
      profileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
    }

    if (calProfileSelect) {
      calProfileSelect.value = state.activeProfileId ? String(state.activeProfileId) : '';
    }
  }

  try {
    state.allProfiles = await snapshotStore.getAllProfiles();
    populateDropdown(state.allProfiles);
    if (state.activeProfileId) {
      if (profileActionRow) profileActionRow.classList.remove('hidden');
    } else {
      if (profileActionRow) profileActionRow.classList.add('hidden');
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
    if (selectedVal === 'new') {
      if (profileSelect) profileSelect.value = 'new';
      if (calProfileSelect) calProfileSelect.value = '';
      if (newProfileInputContainer) {
        newProfileInputContainer.classList.remove('hidden');
        newProfileInputContainer.classList.add('visible-flex');
      }
      if (profileStatusBar) profileStatusBar.classList.add('hidden');
      if (btnDeleteProfile) btnDeleteProfile.classList.add('hidden');
      if (profileActionRow) profileActionRow.classList.add('hidden');
      
      const sessionContainer = document.getElementById('profile-session-select-container');
      if (sessionContainer) sessionContainer.classList.add('hidden');
    } else if (selectedVal === '') {
      if (profileSelect) profileSelect.value = '';
      if (calProfileSelect) calProfileSelect.value = '';

      // Cleanly reset Guest state caches
      state.activeProfileId = null;
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

      const isDuplicate = state.allProfiles.some(p => p.name.toLowerCase() === nameVal.toLowerCase());
      if (isDuplicate) {
        alert(`A profile named "${nameVal}" already exists. Please choose a different name.`);
        return;
      }

      const newProfile = {
        name: nameVal,
        timestamp: Date.now(),
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
        profileSelect.value = '';
        if (calProfileSelect) calProfileSelect.value = '';
        
        if (updateDashboardOfflinePlaceholdersFn) updateDashboardOfflinePlaceholdersFn();

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
          statusElement.textContent = `Profile deleted successfully. Switched back to Guest Mode.`;
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
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tabPanes = document.querySelectorAll('.athlete-tab-pane');
      tabPanes.forEach(pane => pane.classList.add('hidden'));

      const targetTabId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) {
        targetPane.classList.remove('hidden');
      }
    });
  });

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
      compileAndDownloadCombinedSession();
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
      videoHipRotationR: profile.videoHipRotationR || null
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
    state.jointsOverhead = activeSession.jointsOverhead || null;
    state.jointsShoulderL = activeSession.jointsShoulderL || null;
    state.jointsShoulderR = activeSession.jointsShoulderR || null;
    
    updateShoulderSidebarUI();
    
    state.importedPortfolioMetrics = compileImportedMetricsFromProfile(profile, activeSession.id);

    const activeHeightCm = state.importedPortfolioMetrics && state.importedPortfolioMetrics.skeletal_height;
    if (activeHeightCm) {
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
      if (state.metricsA !== undefined) session.metricsA = state.metricsA;
      if (state.metricsT !== undefined) session.metricsT = state.metricsT;
      if (state.metricsOverhead !== undefined) session.metricsOverhead = state.metricsOverhead;
      if (state.imageA !== undefined) session.imageA = state.imageA;
      if (state.imageT !== undefined) session.imageT = state.imageT;
      if (state.imageOverhead !== undefined) session.imageOverhead = state.imageOverhead;
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

    if (state.videoHipRotationL !== undefined) session.videoHipRotationL = state.videoHipRotationL;
    if (state.videoHipRotationR !== undefined) session.videoHipRotationR = state.videoHipRotationR;

    if (state.imageHipRotationL !== undefined) session.imageHipRotationL = state.imageHipRotationL;
    if (state.imageHipRotationR !== undefined) session.imageHipRotationR = state.imageHipRotationR;

    profile.metricsA = session.metricsA;
    profile.metricsT = session.metricsT;
    profile.metricsOverhead = session.metricsOverhead;
    profile.squatPeaks = session.squatPeaks;
    profile.shoulderPeaks = session.shoulderPeaks;
    profile.shoulderRotation = session.shoulderRotation;
    profile.hipRotation = session.hipRotation;
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

export async function openProfileDetailsModal(profileId) {
  if (!profileId) return;

  const mainVideoPlayer = document.getElementById('profile-details-video-player');
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
  if (state.modalObjectUrls) {
    state.modalObjectUrls.forEach(url => URL.revokeObjectURL(url));
  }
  state.modalObjectUrls = [];

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

    const userSelect = document.getElementById('profile-detail-user-select');
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
        openProfileDetailsModal(selectedProfileId);
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

    const sessionSelect = document.getElementById('profile-detail-session-select');
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
        openProfileDetailsModal(profileId);
      };
    }

    const modalUnitInchBtn = document.getElementById('modal-unit-inch-btn');
    const modalUnitCmBtn = document.getElementById('modal-unit-cm-btn');
    if (modalUnitInchBtn && modalUnitCmBtn) {
      if (state.useInches) {
        modalUnitInchBtn.classList.add('active');
        modalUnitCmBtn.classList.remove('active');
      } else {
        modalUnitInchBtn.classList.remove('active');
        modalUnitCmBtn.classList.add('active');
      }
    }

    const btnNewSession = document.getElementById('btn-profile-new-session');
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
        openProfileDetailsModal(profileId);
      };
    }

    const btnRenameSession = document.getElementById('btn-profile-rename-session');
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
              openProfileDetailsModal(profileId);
            }
          }
        } catch (err) {
          console.error("[SessionRename] Failed to rename session:", err);
          alert("Failed to rename session: " + err.message);
        }
      };
    }

    const detailName = document.getElementById('profile-detail-name');
    const detailScale = document.getElementById('profile-detail-scale');
    const detailLastSession = document.getElementById('profile-detail-last-session');
    
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
              
              openProfileDetailsModal(profileId);
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
      { key: 'hip-rotation-r', metricsKey: 'hipRotation', imgKey: 'imageHipRotationR', title: 'Right Hip Rotation', color: '#10b981', isHipRotation: true }
    ];

    poses.forEach(p => {
      const statusEl = document.getElementById(`detail-status-${p.key}`);
      const imgEl = document.getElementById(`detail-preview-img-${p.key}`);
      const containerEl = document.getElementById(`detail-preview-container-${p.key}`);
      
      let hasData = false;
      let imgSrc = activeSession[p.imgKey] || null;
      let hasVideo = false;

      if (p.isSquat) {
        const videoKey = p.key === 'squat-l' ? 'videoSquatL' : (p.key === 'squat-r' ? 'videoSquatR' : 'videoSquatFrontal');
        const sVideo = activeSession[videoKey];
        hasVideo = !!(sVideo && sVideo.blob);

        let hasPeaks = false;
        if (activeSession.squatPeaks) {
          if (p.key === 'squat-l') {
            hasPeaks = (activeSession.squatPeaks.kneeL > 0 || activeSession.squatPeaks.kneeLTime > 0 || activeSession.squatPeaks.hipL > 0 || activeSession.squatPeaks.ankleL > 0);
          } else if (p.key === 'squat-r') {
            hasPeaks = (activeSession.squatPeaks.kneeR > 0 || activeSession.squatPeaks.kneeRTime > 0 || activeSession.squatPeaks.hipR > 0 || activeSession.squatPeaks.ankleR > 0);
          } else if (p.key === 'squat-frontal') {
            hasPeaks = (activeSession.squatPeaks.maxKneeCaveL > 0 || activeSession.squatPeaks.maxKneeCaveR > 0);
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

          if ((p.isSquat || p.isShoulderRotation || p.isHipRotation) && hasVideo) {
            const videoKey = p.key === 'squat-l' ? 'videoSquatL' : 
                             (p.key === 'squat-r' ? 'videoSquatR' : 
                             (p.key === 'squat-frontal' ? 'videoSquatFrontal' : 
                             (p.key === 'shoulder-rotation-l' ? 'videoShoulderRotationL' : 
                             (p.key === 'shoulder-rotation-r' ? 'videoShoulderRotationR' : 
                             (p.key === 'hip-rotation-l' ? 'videoHipRotationL' : 'videoHipRotationR')))));
            const sVideo = activeSession[videoKey];
            const videoUrl = URL.createObjectURL(sVideo.blob);
            state.modalObjectUrls.push(videoUrl);

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
              const videoUrl = URL.createObjectURL(sVideo.blob);
              state.modalObjectUrls.push(videoUrl);

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

        const deleteBtn = document.getElementById(`btn-delete-pose-${p.key}`);
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
              openProfileDetailsModal(profileId);
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

        const deleteBtn = document.getElementById(`btn-delete-pose-${p.key}`);
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

    const thA = document.getElementById('detail-table-height-a');
    const thT = document.getElementById('detail-table-height-t');
    const thO = document.getElementById('detail-table-height-overhead');
    if (thA) thA.innerHTML = renderCellSingle('a', 'skeletal_height', getVal('a', 'skeletal_height', ['t', 'overhead']));
    if (thT) thT.innerHTML = renderCellSingle('t', 'skeletal_height', getVal('t', 'skeletal_height', ['a', 'overhead']));
    if (thO) thO.innerHTML = renderCellSingle('overhead', 'skeletal_height', getVal('overhead', 'skeletal_height', ['a', 't']));

    const twA = document.getElementById('detail-table-wingspan-a');
    const twT = document.getElementById('detail-table-wingspan-t');
    const twO = document.getElementById('detail-table-wingspan-overhead');
    if (twA) twA.innerHTML = renderCellSingle('a', 'wingspan', getVal('a', 'wingspan', ['t', 'overhead']));
    if (twT) twT.innerHTML = renderCellSingle('t', 'wingspan', getVal('t', 'wingspan', ['a', 'overhead']));
    if (twO) {
      const [reachL, reachR] = getValPair('overhead', 'fingerToToeL', 'fingerToToeR', ['a', 't']);
      twO.innerHTML = renderCellPair('overhead', 'fingerToToeL', 'fingerToToeR', reachL, reachR);
    }

    const ttA = document.getElementById('detail-table-torso-a');
    const ttT = document.getElementById('detail-table-torso-t');
    const ttO = document.getElementById('detail-table-torso-overhead');
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

    const tthA = document.getElementById('detail-table-thigh-a');
    const tthT = document.getElementById('detail-table-thigh-t');
    const tthO = document.getElementById('detail-table-thigh-overhead');
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

    const tsA = document.getElementById('detail-table-shin-a');
    const tsT = document.getElementById('detail-table-shin-t');
    const tsO = document.getElementById('detail-table-shin-overhead');
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

    const tuaA = document.getElementById('detail-table-upperarm-a');
    const tuaT = document.getElementById('detail-table-upperarm-t');
    const tuaO = document.getElementById('detail-table-upperarm-overhead');
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

    const tfaA = document.getElementById('detail-table-forearm-a');
    const tfaT = document.getElementById('detail-table-forearm-t');
    const tfaO = document.getElementById('detail-table-forearm-overhead');
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

    const cHeight = document.getElementById('consolidated-val-height');
    const cWingspan = document.getElementById('consolidated-val-wingspan');
    const cReach = document.getElementById('consolidated-val-reach');
    const cTorso = document.getElementById('consolidated-val-torso');
    const cThigh = document.getElementById('consolidated-val-thigh');
    const cShin = document.getElementById('consolidated-val-shin');
    const cUpperarm = document.getElementById('consolidated-val-upperarm');
    const cForearm = document.getElementById('consolidated-val-forearm');

    const compiled = compileImportedMetricsFromProfile(profile, activeSession.id) || {};

    if (cHeight) cHeight.innerHTML = formatSingle(compiled.skeletal_height);
    if (cWingspan) cWingspan.innerHTML = formatSingle(compiled.wingspan);
    if (cReach) cReach.innerHTML = formatPair(compiled.fingerToToeL, compiled.fingerToToeR);
    if (cTorso) cTorso.innerHTML = formatPair(compiled.torso_l, compiled.torso_r);
    if (cThigh) cThigh.innerHTML = formatPair(compiled.thigh_l, compiled.thigh_r);
    if (cShin) cShin.innerHTML = formatPair(compiled.shin_l, compiled.shin_r);
    if (cUpperarm) cUpperarm.innerHTML = formatPair(compiled.upperarm_l, compiled.upperarm_r);
    if (cForearm) cForearm.innerHTML = formatPair(compiled.forearm_l, compiled.forearm_r);

    const editBtn = document.getElementById('btn-edit-baseline-metrics');
    if (editBtn) {
      editBtn.classList.remove('btn-save-metrics', 'btn-edit-metrics');
      if (state.isEditingProfileMetrics) {
        editBtn.innerHTML = '💾 Save Metrics';
        editBtn.classList.add('btn-save-metrics');
        
        let cancelBtn = document.getElementById('btn-cancel-baseline-metrics');
        if (!cancelBtn) {
          cancelBtn = document.createElement('button');
          cancelBtn.id = 'btn-cancel-baseline-metrics';
          cancelBtn.className = 'btn btn-cancel-metrics';
          cancelBtn.innerHTML = 'Cancel';
          editBtn.parentNode.appendChild(cancelBtn);
        }
        
        cancelBtn.onclick = () => {
          state.isEditingProfileMetrics = false;
          openProfileDetailsModal(profileId);
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
            
            freshProfileMigrated.metricsA = freshActiveSession.metricsA;
            freshProfileMigrated.metricsT = freshActiveSession.metricsT;
            freshProfileMigrated.metricsOverhead = freshActiveSession.metricsOverhead;
            freshProfileMigrated.squatPeaks = freshActiveSession.squatPeaks;
            freshProfileMigrated.shoulderPeaks = freshActiveSession.shoulderPeaks;
            freshProfileMigrated.shoulderRotation = freshActiveSession.shoulderRotation;
            freshProfileMigrated.hipRotation = freshActiveSession.hipRotation;
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
            openProfileDetailsModal(profileId);
          } catch (err) {
            console.error("[SaveMetrics] Failed to save metrics:", err);
            alert("Failed to save metrics: " + err.message);
          }
        };
      } else {
        editBtn.innerHTML = 'Edit Metrics';
        editBtn.classList.add('btn-edit-metrics');
        
        const cancelBtn = document.getElementById('btn-cancel-baseline-metrics');
        if (cancelBtn) {
          cancelBtn.parentNode.removeChild(cancelBtn);
        }
        
        editBtn.onclick = () => {
          state.isEditingProfileMetrics = true;
          openProfileDetailsModal(profileId);
        };
      }
    }

    const dsqKnee = document.getElementById('detail-squat-knee');
    const dsqHip = document.getElementById('detail-squat-hip');
    const dsqAnkle = document.getElementById('detail-squat-ankle');
    
    const sPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
    if (sPeaks.maxKneeCaveL > 90.0) sPeaks.maxKneeCaveL = 0;
    if (sPeaks.maxKneeCaveR > 90.0) sPeaks.maxKneeCaveR = 0;

    if (dsqKnee) dsqKnee.innerHTML = renderSquatPeakEdit('knee', sPeaks.kneeL, sPeaks.kneeR);
    if (dsqHip) dsqHip.innerHTML = renderSquatPeakEdit('hip', sPeaks.hipL, sPeaks.hipR);
    if (dsqAnkle) dsqAnkle.innerHTML = renderSquatPeakEdit('ankle', sPeaks.ankleL, sPeaks.ankleR);

    const dshExcursionL = document.getElementById('detail-shoulder-excursion-l');
    const dshExcursionR = document.getElementById('detail-shoulder-excursion-r');
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

    const dshRotExtL = document.getElementById('detail-shoulder-rotation-external-l');
    const dshRotIntL = document.getElementById('detail-shoulder-rotation-internal-l');
    const dshRotExtR = document.getElementById('detail-shoulder-rotation-external-r');
    const dshRotIntR = document.getElementById('detail-shoulder-rotation-internal-r');
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

    const dhipRotExtL = document.getElementById('detail-hip-rotation-external-l');
    const dhipRotIntL = document.getElementById('detail-hip-rotation-internal-l');
    const dhipRotExtR = document.getElementById('detail-hip-rotation-external-r');
    const dhipRotIntR = document.getElementById('detail-hip-rotation-internal-r');
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

    await renderShoulderRotationGrading(activeSession);

    const dsqDepth = document.getElementById('detail-squat-depth');
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

    const detailSquatAsymmetrySummary = document.getElementById('detail-squat-asymmetry-summary');
    if (detailSquatAsymmetrySummary) {
      let imageHtml = "";
      let videoHtml = "";

      let hasImage = false;
      if (activeSession.jointsOverhead) {
        hasImage = true;
        const valgus = calculateValgusFromJoints(activeSession.jointsOverhead);
        const imgL = valgus.pctL;
        const imgR = valgus.pctR;
        const maxImgCave = Math.max(imgL, imgR);
        const lStr = `${imgL.toFixed(1)}°`;
        const rStr = `${imgR.toFixed(1)}°`;
        
        let color = "#10b981";
        let statusText = `Excellent Alignment: Both knees perpendicular to baseline (L: ${lStr}, R: ${rStr}).`;
        if (maxImgCave > 15.0) {
          color = "#ef4444";
          statusText = `Severe Deviation: Significant knee cave-in detected (L: ${lStr}, R: ${rStr}). Focus on stability.`;
        } else if (maxImgCave > 8.0) {
          color = "#ff9f43";
          statusText = `Moderate Deviation: Knees cave inward past baseline (L: ${lStr}, R: ${rStr}).`;
        } else if (maxImgCave >= 3.0) {
          color = "#ffb300";
          statusText = `Mild Deviation: Minor knee tracking variance (L: ${lStr}, R: ${rStr}).`;
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
      if (sPeaks.maxKneeCaveL > 0 || sPeaks.maxKneeCaveR > 0) {
        hasVideoData = true;
        const vidL = sPeaks.maxKneeCaveL || 0;
        const vidR = sPeaks.maxKneeCaveR || 0;
        const maxVidCave = Math.max(vidL, vidR);
        const lStr = `${vidL.toFixed(1)}°`;
        const rStr = `${vidR.toFixed(1)}°`;

        let color = "#10b981";
        let statusTitle = "Stable Knee Alignment (Video Scan)";
        let explanationText = `Knees tracking cleanly over feet. Peak deviation: L: ${lStr}, R: ${rStr}.`;
        let timestampText = "";

        if (maxVidCave > 8.0) {
          const isSevere = maxVidCave > 15.0;
          color = isSevere ? "#ef4444" : "#ff9f43";
          statusTitle = isSevere ? "Severe Knee Valgus (Cave-In) Detected" : "Moderate Knee Valgus (Cave-In) Detected";
          explanationText = `Knees caved inward past safe tracking boundaries. Peak: L: ${lStr}, R: ${rStr}.`;
          
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
          statusTitle = "Mild Knee Tracking Deviation";
          explanationText = `Slight knee tracking deviation during squat video. Peak: L: ${lStr}, R: ${rStr}.`;
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

    const videosListEl = document.getElementById('profile-details-videos-list');
    const videoPlaceholder = document.getElementById('profile-details-video-placeholder');

    if (mainVideoPlayer) {
      mainVideoPlayer.src = '';
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
        });
      }
      const savedVideos = (profile.videos || []).filter(v => !metricVideoIds.has(v.id));

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
          
          const videoUrl = URL.createObjectURL(video.blob);
          state.modalObjectUrls.push(videoUrl);
          
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

              const canvas = document.getElementById('profile-details-video-canvas');
              if (canvas) {
                canvas.style.display = 'none';
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
              mainVideoPlayer.src = videoUrl;
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
              const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
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
              mainVideoPlayer.classList.add('visible-block');
              mainVideoPlayer.classList.remove('hidden');
              if (videoPlaceholder) {
                videoPlaceholder.classList.add('hidden');
                videoPlaceholder.classList.remove('visible-flex');
              }
              const btnFullscreen = document.getElementById('btn-profile-video-fullscreen');
              if (btnFullscreen) {
                btnFullscreen.style.display = 'flex';
              }
              const canvas = document.getElementById('profile-details-video-canvas');
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
                  openProfileDetailsModal(profileId);
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
                  });
                }
                
                await snapshotStore.saveProfile(freshProfileMigrated);
                state.allProfiles = await snapshotStore.getAllProfiles();
                if (state.activeProfileId === profileId) {
                  await loadProfileIntoState(profileId);
                }
                openProfileDetailsModal(profileId);
              }
            } catch (err) {
              console.error("[VideoDelete] Failed to delete saved video:", err);
            }
          });

          videosListEl.appendChild(videoRow);
        });
      }
    }

    const profileDetailsModal = document.getElementById('profile-details-modal');
    if (profileDetailsModal) {
      profileDetailsModal.classList.add('active');
      const firstTabBtn = document.querySelector('.athlete-tab-btn[data-tab="tab-anthropometrics"]');
      if (firstTabBtn) {
        firstTabBtn.click();
      }
    }

  } catch (err) {
    console.error("[openProfileDetailsModal] Error showing profile details modal:", err);
  }
}

export async function renderShoulderRotationGrading(activeSession) {
  const panel = document.getElementById('shoulder-rotation-grading-panel');
  if (!panel) return;

  const shRot = getDefaultShoulderRotation(activeSession.shoulderRotation);
  const shPeaks = getDefaultShoulderPeaks(activeSession.shoulderPeaks);
  const sPeaks = getDefaultSquatPeaks(activeSession.squatPeaks);
  const hRot = getDefaultHipRotation(activeSession.hipRotation);
  
  const thresholds = await getROMThresholds();
  
  const extThresh = thresholds["External Rotation"] || { low: 60, high: 85 };
  const intThresh = thresholds["Internal Rotation"] || { low: 50, high: 75 };
  const flexThresh = thresholds["Shoulder Flexion"] || { low: 150, high: 170 };
  const kneeThresh = thresholds["Knee Flexion"] || { low: 80, high: 110 };
  const hipExtThresh = thresholds["Hip External Rotation"] || { low: 30, high: 45 };
  const hipIntThresh = thresholds["Hip Internal Rotation"] || { low: 30, high: 45 };

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

      <!-- ADVICE / COACHING TAB HUB -->
      <div style="background: rgba(186, 12, 47, 0.02); border: 1px dashed rgba(186, 12, 47, 0.25); border-radius: 8px; padding: 0.75rem; margin-top: 0.5rem;">
        <div style="font-size: 0.8rem; font-weight: bold; color: #BA0C2F; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid rgba(186, 12, 47, 0.15); padding-bottom: 0.25rem; text-transform: uppercase;">
          <span>Dynamic Corrective Advice & Coaching</span>
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

  const mainVideoPlayer = document.getElementById('profile-details-video-player');
  if (mainVideoPlayer) {
    try {
      mainVideoPlayer.pause();
    } catch (e) {}
  }

  setTimeout(() => {
    const player = document.getElementById('profile-details-video-player');
    if (player) {
      player.src = "";
    }
    if (state.modalObjectUrls) {
      state.modalObjectUrls.forEach(url => {
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
