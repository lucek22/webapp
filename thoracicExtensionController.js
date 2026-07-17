
// =========================================================
// THORACIC EXTENSION CONTROLLER MODULE
// =========================================================
import { state, calculateAngle } from './helpers.js';

export class ThoracicExtensionMeasurer {
  constructor() {
    this.reset();
  }

  reset() {
    this.peakAngle = 0;
    this.liveAngle = 0;
  }

  /**
   * Process a single frame and calculate thoracic extension.
   * Uses the Hip as the vertex, comparing the Shoulder line to the Knee line.
   */
  processFrame(landmarks, side = 'left') {
    if (!landmarks) return null;

    const shoulderIdx = side === 'left' ? 11 : 12;
    const hipIdx = side === 'left' ? 23 : 24;
    const kneeIdx = side === 'left' ? 25 : 26;

    const shoulder = landmarks[shoulderIdx];
    const hip = landmarks[hipIdx];
    const knee = landmarks[kneeIdx];

    if (!shoulder || !hip || !knee) return null;

    // Calculate the angle between the torso (hip->shoulder) and thigh (hip->knee)
    // A fully upright person will have a value near 180°. 
    // Extension backward will push this beyond 180° or decrease depending on the vector math,
    // so we calculate absolute deviation from a standard upright baseline.
    let angle = calculateAngle(hip, shoulder, knee);
    
    // Convert into an "Extension Score" (assuming 180 is neutral upright posture)
    let extensionDeviation = Math.abs(180 - angle);

    this.liveAngle = extensionDeviation;
    
    if (this.liveAngle > this.peakAngle) {
      this.peakAngle = this.liveAngle;
    }

    return this.liveAngle;
  }

  getResults() {
    return {
      liveAngle: parseFloat(this.liveAngle.toFixed(1)),
      peakAngle: parseFloat(this.peakAngle.toFixed(1))
    };
  }
}

// DOM Elements
const thoracicLiveAngle = document.getElementById('thoracic-live-angle');
const thoracicPeakAngle = document.getElementById('thoracic-peak-angle');
const btnResetThoracic = document.getElementById('btn-reset-thoracic');
const thoracicStatusVal = document.getElementById('thoracic-status-val');

export function updateThoracicUI() {
  const p = state.thoracicExtension;
  if (thoracicLiveAngle) thoracicLiveAngle.textContent = `${Math.round(p.liveAngle)}°`;
  if (thoracicPeakAngle) thoracicPeakAngle.textContent = `${Math.round(p.peakAngle)}°`;
}

export function setupThoracicListeners() {
  if (btnResetThoracic) {
    btnResetThoracic.addEventListener('click', () => {
      // Reset State
      state.thoracicExtension.liveAngle = 0;
      state.thoracicExtension.peakAngle = 0;
      
      // Reset Measurer Instance if it exists
      if (state.liveThoracicMeasurer) {
        state.liveThoracicMeasurer.reset();
      }
      
      // Update UI
      updateThoracicUI();
      if (thoracicStatusVal) {
         thoracicStatusVal.textContent = 'Tracking Reset';
         thoracicStatusVal.classList.add('text-amber');
      }
    });
  }
}