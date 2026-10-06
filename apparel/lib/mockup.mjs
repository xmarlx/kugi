// 服のシルエットにデザインを合成したモックアップSVGを作る。
// デザインSVG内の {{INK}} はプリント色、{{BG}} は生地色に置き換える。

const LONG_SLEEVE =
  "M400 110 Q500 175 600 110 L720 140 Q830 290 910 700 L840 722 L716 370 L715 870 L285 870 L284 370 L160 722 L90 700 Q170 290 280 140 Z";
// ボクシー（ドロップショルダー・身幅広め・着丈短め）
const BOXY_TEE = "M395 120 Q500 180 605 120 L745 150 L885 335 L792 398 L738 340 L738 800 L262 800 L262 340 L208 398 L115 335 L255 150 Z";
// ベビーT（細身・短丈）
const BABY_TEE =
  "M415 140 Q500 185 585 140 L665 158 L745 262 L688 300 L648 262 L640 520 Q644 590 652 640 L348 640 Q356 590 360 520 L352 262 L312 300 L255 262 L335 158 Z";

const OUTLINES = { tee: BOXY_TEE, babytee: BABY_TEE, longsleeve: LONG_SLEEVE, hoodie: LONG_SLEEVE, quarterzip: LONG_SLEEVE };
// 背面は襟ぐりが浅い
const backOf = (d) => d.replace(/Q500 1(75|80|85) /, "Q500 128 ");

// プリント位置 [x, y, w, h]（1000x940 の座標系）
const PRINT_AREAS = {
  front: {
    full: { tee: [305, 215, 390, 390], babytee: [372, 215, 256, 256], longsleeve: [320, 220, 360, 360], hoodie: [315, 250, 370, 340], quarterzip: [345, 400, 310, 310], badges: [80, 300, 840, 300] },
    chest: { tee: [575, 225, 105, 105], babytee: [545, 230, 70, 70], longsleeve: [560, 230, 100, 100], hoodie: [560, 260, 100, 100], quarterzip: [560, 240, 110, 80] },
  },
  back: {
    full: { tee: [300, 190, 400, 470], babytee: [385, 210, 230, 260], longsleeve: [310, 190, 380, 440], hoodie: [320, 230, 360, 420], quarterzip: [320, 200, 360, 420] },
  },
};

const LINE = 'fill="none" stroke="#000" stroke-opacity=".22" stroke-width="4"';

function details(type, side) {
  const parts = [];
  if (type !== "badges") parts.push(`<path d="${side === "back" ? "M400 110 Q500 128 600 110" : type === "tee" ? "M395 120 Q500 180 605 120" : type === "babytee" ? "M415 140 Q500 185 585 140" : "M400 110 Q500 175 600 110"}" ${LINE}/>`);
  if (["longsleeve", "hoodie", "quarterzip"].includes(type)) parts.push(`<path d="M286 845 L714 845 M97 678 L165 700 M903 678 L835 700" ${LINE}/>`);
  if (type === "hoodie" && side === "front") {
    parts.push(`<path d="M365 640 L635 640 L670 810 L330 810 Z" ${LINE}/>`);
    parts.push(`<path d="M470 160 L464 262 M530 160 L536 262" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="7" stroke-linecap="round"/>`);
  }
  if (type === "quarterzip") {
    parts.push(`<path d="M410 112 L410 60 Q500 40 590 60 L590 112" fill="currentColor" stroke="#000" stroke-opacity=".22" stroke-width="4"/>`);
    if (side === "front") {
      parts.push(`<path d="M500 58 L500 360" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="6"/>`);
      parts.push(`<rect x="493" y="70" width="14" height="30" rx="4" fill="#c9c9c9"/>`);
    }
  }
  return parts.join("");
}

function hood(type, side) {
  if (type !== "hoodie") return "";
  if (side === "back") return `<path d="M360 150 Q350 0 500 -2 Q650 0 640 150 Q500 200 360 150 Z" fill="currentColor" stroke="#000" stroke-opacity=".22" stroke-width="4"/>`;
  return `<path d="M372 135 Q360 20 500 8 Q640 20 628 135 Q560 95 500 160 Q440 95 372 135 Z" fill="currentColor" stroke="#000" stroke-opacity=".22" stroke-width="4"/>`;
}

export function fillDesign(designSvg, { ink, bg }) {
  return designSvg.replaceAll("{{INK}}", ink).replaceAll("{{BG}}", bg).replace(/<!--[\s\S]*?-->/g, "");
}

export function artworkFragment(designSvg, color, [x, y, w, h], idPrefix, filter = "") {
  const viewBox = designSvg.match(/viewBox="([^"]+)"/)?.[1] || "0 0 1200 1200";
  const inner = fillDesign(designSvg, { ink: color.ink, bg: color.hex })
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/id="([^"]+)"/g, `id="${idPrefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${idPrefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${idPrefix}-$1"`);
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" overflow="visible"${filter}>${inner}</svg>`;
}

// ヴィンテージ加工：プリントのかすれ（クラック）と生地のムラ
function vintageDefs(id) {
  return `<filter id="${id}-crack" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  30 0 0 0 -6.3" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
<filter id="${id}-wash"><feTurbulence type="fractalNoise" baseFrequency=".012 .02" numOctaves="2" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 -.18"/></filter>`;
}

function badgesMockup({ color, designSvg, idPrefix, print }) {
  const area = PRINT_AREAS.front.full.badges;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 940">
<rect x="40" y="200" width="920" height="500" rx="28" fill="${color.hex}"/>
<g opacity=".18" transform="translate(0 14)"><svg x="${area[0]}" y="${area[1]}" width="${area[2]}" height="${area[3]}" viewBox="0 0 1200 420"><circle cx="210" cy="210" r="180"/><circle cx="600" cy="210" r="180"/><circle cx="990" cy="210" r="180"/></svg></g>
${artworkFragment(designSvg, color, area, idPrefix)}
<svg x="${area[0]}" y="${area[1]}" width="${area[2]}" height="${area[3]}" viewBox="0 0 1200 420"><g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="10"><path d="M80 150 A 140 140 0 0 1 200 50"/><path d="M470 150 A 140 140 0 0 1 590 50"/><path d="M860 150 A 140 140 0 0 1 980 50"/></g></svg>
</svg>
`;
}

export function renderMockup({ type, side = "front", color, prints, designs, idPrefix = "a", finish }) {
  const print = prints.find((p) => p.side === side);
  if (type === "badges") return badgesMockup({ color, designSvg: designs[print.design], idPrefix, print });
  const outline = side === "back" ? backOf(OUTLINES[type]) : OUTLINES[type];
  const vintage = finish === "vintage";
  let art = "";
  if (print) {
    const area = PRINT_AREAS[side]?.[print.area]?.[type];
    if (!area) throw new Error(`未対応の組み合わせ: ${type}/${side}/${print.area}`);
    art = artworkFragment(designs[print.design], color, area, `${idPrefix}-${side}`, vintage ? ` filter="url(#${idPrefix}-crack)"` : "");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 940" color="${color.hex}">
<defs><linearGradient id="${idPrefix}-shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>${vintage ? vintageDefs(idPrefix) : ""}<clipPath id="${idPrefix}-clip"><path d="${outline}"/></clipPath></defs>
${hood(type, side)}
<path d="${outline}" fill="currentColor" stroke="#000" stroke-opacity=".22" stroke-width="4" stroke-linejoin="round"/>
${art}
${vintage ? `<rect width="1000" height="940" filter="url(#${idPrefix}-wash)" clip-path="url(#${idPrefix}-clip)" opacity=".22"/>` : ""}
<path d="${outline}" fill="url(#${idPrefix}-shade)"/>
${details(type, side)}
</svg>
`;
}

// 印刷用（デザインのみ）。export-print.mjs が PNG に変換する。
export function renderPrintFile({ designSvg, color }) {
  return fillDesign(designSvg, { ink: color.ink, bg: color.hex });
}
