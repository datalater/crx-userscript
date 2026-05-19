// 개발자도구 console 탭에서 실행하세요
// output: chrome extension에서 사용할 icon 이미지 파일 목록
(() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#19848d"/><text x="64" y="64" font-family="system-ui,-apple-system,sans-serif" font-size="90" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central" letter-spacing="-2">U</text></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  img.onload = () => {
    for (const s of [16, 32, 48, 128]) {
      const c = document.createElement("canvas");
      c.width = c.height = s;
      c.getContext("2d").drawImage(img, 0, 0, s, s);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `icon-${s}.png`;
      a.click();
    }
  };
  img.src = url;
})();

const colors = {
  blue: "#2e76da",
  indigo: "#6366f1",
  violet: "#895de2",
  magenta: "#c826d7",
  raspberry: "#da2f84",
  red: "#dc3939",
  copper: "#b86020",
  olive: "#91731a",
  green: "#4f8518",
  teal: "#19848d",
};
