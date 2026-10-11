import logoLettering from "./logo-lettering.json";

export const letterforms = [
  "M15 35.7 L35 35.7 L104.28 107.3 L84.28 107.3 L32.97 54.28 L32.97 107.3 L15 107.3ZM85.72 35.7 L104.28 35.7 L104.28 102.51 L85.72 83.33Z",
  "M115.58 35.7 L134.13 35.7 L160.51 69.21 L186.88 35.7 L205.43 35.7 L205.43 107.3 L188.33 107.3 L188.33 58.51 L160.51 92.78 L132.68 58.51 L132.68 107.3 L115.58 107.3Z",
  "M215.29 35.7 L232.68 35.7 L232.68 107.3 L215.29 107.3ZM270.94 35.7 L293.84 35.7 L257.75 69.21 L295 107.3 L271.52 107.3 L235.87 69.38Z",
];

const mark = letterforms.join("");
const paths = `<path d="${mark}" fill="currentColor"/><path d="" fill="none"/>`;

export const labelMarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 310 145" color="#171713">${paths}</svg>`;

export const logo = `<svg viewBox="0 0 310 185" aria-label="Naimakes" role="img">${paths}<g class="logo-letters" fill="currentColor">${logoLettering.letters.map((d) => `<path d="${d}"/>`).join("")}</g></svg>`;

export const bootMarkContour = mark;

export const brandHeading = `<h1>NAIMAKES</h1><div>IDEAS BEFORE THE FUTURE</div><p><span class="brand-analysis">思想</span> <b>先于未来</b></p>`;
