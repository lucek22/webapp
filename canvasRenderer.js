// =========================================================
// SCARLET BIOMECHANICS CANVAS OVERLAY RENDERER MODULE
// =========================================================

import { state, getCanvasX, FINGER_COLORS, POSE_CONNECTIONS } from './helpers.js';

function getCanvasCtx() {
  const canvas = document.getElementById('overlay');
  return canvas ? canvas.getContext('2d') : null;
}

export function drawJoint(point, color, ctx = null) {
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx || !point) return;
  
  activeCtx.beginPath();
  activeCtx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
  activeCtx.fillStyle = color;
  activeCtx.fill();
  activeCtx.strokeStyle = 'white';
  activeCtx.lineWidth = 1.5;
  activeCtx.stroke();
}

export function drawBone(p1, p2, color, ctx = null) {
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx || !p1 || !p2) return;

  activeCtx.beginPath();
  activeCtx.moveTo(p1.x, p1.y);
  activeCtx.lineTo(p2.x, p2.y);
  activeCtx.strokeStyle = color;
  activeCtx.lineWidth = 3.5;
  activeCtx.stroke();
}

export function drawSkeletalFramework(joints, ctx = null) {
  if (!joints) return;
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx) return;

  const {
    shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
    shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
    head_top
  } = joints;

  // 1. Draw Bones
  drawBone(shoulder_l, shoulder_r, '#FFFFFF', activeCtx); 
  drawBone(hip_l, hip_r, '#FFFFFF', activeCtx); 
  drawBone(shoulder_l, hip_l, '#FFFFFF', activeCtx); 
  drawBone(shoulder_r, hip_r, '#FFFFFF', activeCtx); 

  // Left Arm & Leg
  drawBone(shoulder_l, elbow_l, '#FFFFFF', activeCtx); 
  drawBone(elbow_l, wrist_l, '#FFFFFF', activeCtx); 
  drawBone(hip_l, knee_l, '#FFFFFF', activeCtx); 
  drawBone(knee_l, ankle_l, '#FFFFFF', activeCtx); 
  drawBone(ankle_l, heel_l, '#FFFFFF', activeCtx); 
  drawBone(heel_l, toe_l, '#FFFFFF', activeCtx); 

  // Right Arm & Leg
  drawBone(shoulder_r, elbow_r, '#FFFFFF', activeCtx); 
  drawBone(elbow_r, wrist_r, '#FFFFFF', activeCtx); 
  drawBone(hip_r, knee_r, '#FFFFFF', activeCtx); 
  drawBone(knee_r, ankle_r, '#FFFFFF', activeCtx); 
  drawBone(ankle_r, heel_r, '#FFFFFF', activeCtx); 
  drawBone(heel_r, toe_r, '#FFFFFF', activeCtx); 

  // 2. Draw Joints (Always renders as vibrant glowing white with a dark border)
  drawJoint(shoulder_l, '#ffffff', activeCtx);
  drawJoint(shoulder_r, '#ffffff', activeCtx);
  drawJoint(elbow_l, '#ffffff', activeCtx);
  drawJoint(elbow_r, '#ffffff', activeCtx);
  drawJoint(wrist_l, '#ffffff', activeCtx);
  drawJoint(wrist_r, '#ffffff', activeCtx);
  drawJoint(hip_l, '#ffffff', activeCtx);
  drawJoint(hip_r, '#ffffff', activeCtx);
  drawJoint(knee_l, '#ffffff', activeCtx);
  drawJoint(knee_r, '#ffffff', activeCtx);
  drawJoint(ankle_l, '#ffffff', activeCtx);
  drawJoint(ankle_r, '#ffffff', activeCtx);
  drawJoint(toe_l, '#ffffff', activeCtx);
  drawJoint(toe_r, '#ffffff', activeCtx);
  
  if (head_top) {
    drawJoint(head_top, '#ffffff', activeCtx);
  }
}

export function drawFullSkeletalMesh(landmarks, ctx = null) {
  if (!landmarks || landmarks.length < 33) return;
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx) return;

  // 1. Draw thin, semi-transparent skeletal mesh connections
  activeCtx.beginPath();
  POSE_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2) {
      activeCtx.moveTo(p1.x, p1.y);
      activeCtx.lineTo(p2.x, p2.y);
    }
  });
  activeCtx.strokeStyle = 'rgba(99, 102, 241, 0.45)'; // Sleek translucent indigo vector line
  activeCtx.lineWidth = 1.5;
  activeCtx.stroke();

  // 2. Draw all 33 pose landmark nodes in vibrant white with high-contrast outlines
  landmarks.forEach((p, idx) => {
    if (!p) return;

    activeCtx.beginPath();
    activeCtx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
    activeCtx.fillStyle = '#ffffff'; 
    activeCtx.fill();
    activeCtx.strokeStyle = '#0f172a'; 
    activeCtx.lineWidth = 1.5;
    activeCtx.stroke();
  });
}

export function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  } else {
    // Fallback for older browsers
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

export function drawAngleBadge(ctx, point, value, color) {
  if (!point || value === undefined || value === null || isNaN(value)) return;
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx) return;

  activeCtx.save();
  activeCtx.font = 'bold 11px sans-serif';
  const text = `${Math.round(value)}°`;
  const paddingX = 6;
  const paddingY = 4;
  const textWidth = activeCtx.measureText(text).width;
  const bgW = textWidth + paddingX * 2;
  const bgH = 14 + paddingY * 2;

  const offsetX = 15;
  const offsetY = -10;
  const badgeX = point.x + offsetX;
  const badgeY = point.y + offsetY;

  activeCtx.fillStyle = 'rgba(15, 22, 38, 0.85)';
  activeCtx.strokeStyle = color || '#00e5ff';
  activeCtx.lineWidth = 1.5;

  activeCtx.shadowColor = color || '#00e5ff';
  activeCtx.shadowBlur = 4;

  drawRoundedRect(activeCtx, badgeX, badgeY, bgW, bgH, 4);
  activeCtx.fill();
  activeCtx.stroke();

  activeCtx.shadowBlur = 0;
  activeCtx.fillStyle = '#ffffff';
  activeCtx.textAlign = 'left';
  activeCtx.textBaseline = 'top';
  activeCtx.fillText(text, badgeX + paddingX, badgeY + paddingY);
  activeCtx.restore();
}

export function drawValgusBadge(ctx, point, value) {
  if (!point || value === undefined || value === null || isNaN(value)) return;
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx) return;
  
  activeCtx.save();
  activeCtx.font = 'bold 10px sans-serif';
  const text = `VALGUS: ${value.toFixed(1)}°`;
  const paddingX = 6;
  const paddingY = 4;
  const textWidth = activeCtx.measureText(text).width;
  const bgW = textWidth + paddingX * 2;
  const bgH = 12 + paddingY * 2;

  const offsetX = -bgW / 2;
  const offsetY = 15;
  const badgeX = point.x + offsetX;
  const badgeY = point.y + offsetY;

  activeCtx.fillStyle = 'rgba(15, 22, 38, 0.9)';
  activeCtx.strokeStyle = '#BA0C2F'; 
  activeCtx.lineWidth = 1.5;
  activeCtx.shadowColor = '#BA0C2F';
  activeCtx.shadowBlur = 6;

  drawRoundedRect(activeCtx, badgeX, badgeY, bgW, bgH, 4);
  activeCtx.fill();
  activeCtx.stroke();

  activeCtx.shadowBlur = 0;
  activeCtx.fillStyle = '#ef4444'; 
  activeCtx.textAlign = 'left';
  activeCtx.textBaseline = 'top';
  activeCtx.fillText(text, badgeX + paddingX, badgeY + paddingY + 1);
  activeCtx.restore();
}

export function drawHandMesh(multiHandLandmarks, multiHandedness, ctx = null) {
  if (!multiHandLandmarks || !Array.isArray(multiHandLandmarks)) return;
  const activeCtx = ctx || getCanvasCtx();
  if (!activeCtx) return;

  multiHandLandmarks.forEach((landmarks, handIdx) => {
    if (!landmarks || !Array.isArray(landmarks) || landmarks.length < 21) return;
    const handedness = multiHandedness ? multiHandedness[handIdx] : null;
    const isLeft = handedness ? handedness.label === 'Left' : true;
    const sidePrefix = isLeft ? 'L' : 'R';

    const height = state.canvasHeight || 480;
    const pts = landmarks.map(lm => ({ x: getCanvasX(lm.x), y: lm.y * height }));

    activeCtx.beginPath();
    activeCtx.moveTo(pts[0].x, pts[0].y);
    activeCtx.lineTo(pts[1].x, pts[1].y);
    activeCtx.lineTo(pts[5].x, pts[5].y);
    activeCtx.lineTo(pts[9].x, pts[9].y);
    activeCtx.lineTo(pts[13].x, pts[13].y);
    activeCtx.lineTo(pts[17].x, pts[17].y);
    activeCtx.closePath();
    activeCtx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    activeCtx.lineWidth = 1.5;
    activeCtx.stroke();
    activeCtx.fillStyle = 'rgba(99, 102, 241, 0.05)';
    activeCtx.fill();

    const drawFingerBones = (indices, color) => {
      activeCtx.beginPath();
      activeCtx.moveTo(pts[indices[0]].x, pts[indices[0]].y);
      for (let i = 1; i < indices.length; i++) {
        activeCtx.lineTo(pts[indices[i]].x, pts[indices[i]].y);
      }
      activeCtx.strokeStyle = color + '80';
      activeCtx.lineWidth = 2.0;
      activeCtx.stroke();
    };

    drawFingerBones([1, 2, 3, 4], FINGER_COLORS.thumb);
    drawFingerBones([5, 6, 7, 8], FINGER_COLORS.index);
    drawFingerBones([9, 10, 11, 12], FINGER_COLORS.middle);
    drawFingerBones([13, 14, 15, 16], FINGER_COLORS.ring);
    drawFingerBones([17, 18, 19, 20], FINGER_COLORS.pinky);

    pts.forEach((pt, idx) => {
      if ([4, 8, 12, 16, 20].includes(idx)) return;
      if (idx === 0) {
        activeCtx.beginPath();
        activeCtx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        activeCtx.fillStyle = '#ffffff'; 
        activeCtx.fill();
        activeCtx.strokeStyle = '#0f172a'; 
        activeCtx.lineWidth = 1.5;
        activeCtx.stroke();
        return;
      }

      activeCtx.beginPath();
      activeCtx.arc(pt.x, pt.y, 2.5, 0, 2 * Math.PI);
      activeCtx.fillStyle = '#ffffff'; 
      activeCtx.fill();
      activeCtx.strokeStyle = '#0f172a'; 
      activeCtx.lineWidth = 1.0;
      activeCtx.stroke();
    });

    const tips = [
      { idx: 4, color: FINGER_COLORS.thumb, label: sidePrefix + ' Thumb' },
      { idx: 8, color: FINGER_COLORS.index, label: sidePrefix + ' Index' },
      { idx: 12, color: FINGER_COLORS.middle, label: sidePrefix + ' Middle' },
      { idx: 16, color: FINGER_COLORS.ring, label: sidePrefix + ' Ring' },
      { idx: 20, color: FINGER_COLORS.pinky, label: sidePrefix + ' Pinky' }
    ];

    tips.forEach(tip => {
      const pt = pts[tip.idx];
      
      activeCtx.beginPath();
      activeCtx.arc(pt.x, pt.y, 7, 0, 2 * Math.PI);
      activeCtx.fillStyle = 'rgba(255, 255, 255, 0.25)'; 
      activeCtx.fill();

      activeCtx.beginPath();
      activeCtx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
      activeCtx.fillStyle = '#ffffff'; 
      activeCtx.fill();
      activeCtx.strokeStyle = tip.color;
      activeCtx.lineWidth = 1.5;
      activeCtx.stroke();
    });
  });
}
