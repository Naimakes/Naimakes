import design from "./card-design.json";

const [BOX_X, BOX_Y, BOX_W, BOX_H] = design.box;
const [LX, LY, LW, LH] = design.label;

export const CARD_WIDTH = 5;
export const CARD_HEIGHT = (CARD_WIDTH * BOX_H) / BOX_W;
export const CARD_CENTER_Y = CARD_HEIGHT / 2;
export const CARD_FACE_Z = 0.206;
const CARD_BACK_Z = -0.13;
export const CARD_DEPTH = CARD_FACE_Z - CARD_BACK_Z;

const K = CARD_WIDTH / BOX_W;

export const CARD_LABEL = {
  x: (LX + LW / 2 - (BOX_X + BOX_W / 2)) * K,
  y: (BOX_Y + BOX_H - (LY + LH / 2)) * K,
  z: 0.2146,
  width: LW * K,
  height: LH * K,
};

export const LABEL_CANVAS = { width: 1024, height: Math.round((1024 * LH) / LW) };

export const LABEL_NUMBER = { x: 10, baseline: 101, width: 124, size: 33, font: "600 33px 'Newsreader Variable', 'Noto Serif SC Variable', serif" };
export const LABEL_INK = "#121110";
const LABEL_STROKE = 0.45;

export function labelNumberLayout(c: CanvasRenderingContext2D) {
  c.save();
  c.font = LABEL_NUMBER.font;
  const squeeze = Math.min(1, LABEL_NUMBER.width / c.measureText("NO.000").width);
  const prefix = c.measureText("NO.").width * squeeze;
  const digit = Math.max(...[..."0123456789"].map((d) => c.measureText(d).width)) * squeeze;
  c.restore();
  return { squeeze, prefix, digit };
}

export function drawCardLabel(c: CanvasRenderingContext2D, number: number | null, mark: CanvasImageSource | null) {
  const s = LABEL_CANVAS.width / LW;
  const W = LABEL_CANVAS.width, H = LABEL_CANVAS.height;
  c.save();
  const paper = c.createLinearGradient(0, 0, 0, H);
  paper.addColorStop(0, "#ebe7e3");
  paper.addColorStop(1, "#e5e0dc");
  c.fillStyle = paper;
  c.fillRect(0, 0, W, H);
  c.scale(s, s);
  const ink = LABEL_INK;
  c.fillStyle = ink;
  c.strokeStyle = ink;
  c.lineWidth = LABEL_STROKE;
  c.lineJoin = "round";
  c.fillRect(5, 5.5, LW - 10, 3.6);
  c.textBaseline = "alphabetic";
  c.font = "700 21px 'Newsreader Variable', 'Noto Serif SC Variable', serif";
  c.fillText("NAIMAKES FORUM", 8, 37, 176);
  c.strokeText("NAIMAKES FORUM", 8, 37, 176);
  c.fillRect(193, 21, 75, 15);
  c.fillStyle = "#e9e4e0";
  for (const [x, w] of [[247, 3], [253, 2], [258, 4], [264, 1.6]] as const) c.fillRect(x, 24, w, 9);
  c.fillStyle = "#857d76";
  c.font = "600 8.5px 'Newsreader Variable', 'Noto Serif SC Variable', serif";
  c.fillText("INTERNAL DATABASE", 10, 55, 122);
  c.fillStyle = ink;
  c.font = "700 17.5px 'Newsreader Variable', 'Noto Serif SC Variable', serif";
  c.textAlign = "right";
  c.fillText("INFO", 268, 58);
  c.strokeText("INFO", 268, 58);
  c.textAlign = "left";
  c.fillStyle = "rgba(29,27,25,.5)";
  c.fillRect(5, 61.5, LW - 10, 1.2);
  c.fillStyle = "rgba(29,27,25,.22)";
  c.fillRect(202.5, 63, 1, 47);
  c.fillStyle = ink;
  c.font = LABEL_NUMBER.font;
  if (number !== null) {
    const no = "NO." + String(number).padStart(3, "0");
    c.fillText(no, LABEL_NUMBER.x, LABEL_NUMBER.baseline, LABEL_NUMBER.width);
    c.strokeText(no, LABEL_NUMBER.x, LABEL_NUMBER.baseline, LABEL_NUMBER.width);
  } else {
    const { squeeze } = labelNumberLayout(c);
    c.save();
    c.translate(LABEL_NUMBER.x, LABEL_NUMBER.baseline);
    c.scale(squeeze, 1);
    c.fillText("NO.", 0, 0);
    c.lineWidth = LABEL_STROKE / squeeze;
    c.strokeText("NO.", 0, 0);
    c.restore();
  }
  if (mark) {
    const k = 57 / 280;
    c.drawImage(mark, 210 - 15 * k, 80 - 35.7 * k, 310 * k, 145 * k);
  }
  c.fillStyle = "rgba(29,27,25,.28)";
  c.fillRect(5, 111.5, LW - 10, 1.2);
  c.restore();
}
