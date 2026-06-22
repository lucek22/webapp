// ==========================================
// COMPUTER VISION: ARUCO MARKER SETUP
// ==========================================
let arucoDetector = null;

if (typeof AR !== 'undefined') {
  try {
    // Register standard OpenCV DICT_4X4_50 ID 0 (16 bits)
    AR.DICTIONARIES.DICT_4X4_50 = {
      nBits: 16,
      tau: 1,
      codeList: [0xb532] // ID 0 canonical 4x4 representation
    };
    arucoDetector = new AR.Detector({ dictionaryName: 'DICT_4X4_50' });
  } catch (e) {
    console.warn("Failed to initialize custom ArUco dictionary:", e);
  }
} else {
  console.warn("ArUco library (AR) is not loaded. Auto-calibration will be unavailable.");
}

const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = 640;
offscreenCanvas.height = 480;
const offscreenCtx = offscreenCanvas.getContext('2d');

/**
 * Detects ArUco ID 0 marker in the given video stream frame.
 * @param {HTMLVideoElement} videoElem 
 * @returns {Object|null} The detected marker or null.
 */
function detectArucoMarker(videoElem) {
  if (!arucoDetector) return null;
  
  try {
    offscreenCtx.drawImage(videoElem, 0, 0, 640, 480);
    const imageData = offscreenCtx.getImageData(0, 0, 640, 480);
    const markers = arucoDetector.detect(imageData);
    
    for (const marker of markers) {
      if (marker.id === 0) {
        return marker;
      }
    }
  } catch (err) {
    console.error("ArUco detection error:", err);
  }
  
  return null;
}
