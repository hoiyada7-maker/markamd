import { encode } from "plantuml-encoder";

const PLANTUML_SVG_BASE = "https://www.plantuml.com/plantuml/svg";
const EXPAND_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="M9 21H3v-6"/><path d="m3 21 7-7"/></svg>`;

export type PlantUmlViewerSource = {
  svg: string;
  width: number;
  height: number;
};

export type PlantUmlViewerLabels = {
  open: string;
};

export function plantUmlUrl(source: string): string {
  return `${PLANTUML_SVG_BASE}/${encode(source)}`;
}

export function decoratePlantUmlBlocks(
  root: HTMLElement,
  onOpen?: (viewer: PlantUmlViewerSource) => void,
  labels?: PlantUmlViewerLabels,
): () => void {
  const cleanups: Array<() => void> = [];
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(".mdv-plantuml:not([data-mdv-plantuml-ready])"),
  );

  blocks.forEach((block) => {
    const url = block.dataset.src;
    if (!url) return;
    block.dataset.mdvPlantumlReady = "true";

    const actions = document.createElement("div");
    actions.className = "mdv-plantuml__actions";

    const load = document.createElement("button");
    load.type = "button";
    load.className = "mdv-plantuml__btn";
    load.textContent = "load preview";

    const note = document.createElement("span");
    note.className = "mdv-plantuml__note";
    note.textContent = "uses plantuml.com";

    actions.append(load, note);
    block.prepend(actions);

    const onLoad = () => {
      const existing = block.querySelector<HTMLImageElement>("img");
      if (existing) {
        setupViewerWhenLoaded(block, existing, url, cleanups, onOpen, labels);
        return;
      }
      const img = document.createElement("img");
      img.className = "mdv-plantuml__img";
      img.alt = "PlantUML diagram";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = url;
      block.appendChild(img);
      load.textContent = "reload preview";
      setupViewerWhenLoaded(block, img, url, cleanups, onOpen, labels);
    };

    load.addEventListener("click", onLoad);
    cleanups.push(() => {
      load.removeEventListener("click", onLoad);
      actions.remove();
      delete block.dataset.mdvPlantumlReady;
    });
  });

  return () => cleanups.forEach((fn) => fn());
}

function setupViewerWhenLoaded(
  block: HTMLElement,
  img: HTMLImageElement,
  url: string,
  cleanups: Array<() => void>,
  onOpen?: (viewer: PlantUmlViewerSource) => void,
  labels?: PlantUmlViewerLabels,
): void {
  if (img.complete && img.naturalWidth > 0) {
    setupViewer(block, img, url, cleanups, onOpen, labels);
    return;
  }

  const onImageLoad = () => setupViewer(block, img, url, cleanups, onOpen, labels);
  img.addEventListener("load", onImageLoad, { once: true });
  cleanups.push(() => img.removeEventListener("load", onImageLoad));
}

function setupViewer(
  block: HTMLElement,
  img: HTMLImageElement,
  url: string,
  cleanups: Array<() => void>,
  onOpen?: (viewer: PlantUmlViewerSource) => void,
  labels?: PlantUmlViewerLabels,
): void {
  if (!onOpen || !labels || block.dataset.mdvPlantumlViewer === "true") return;
  block.dataset.mdvPlantumlViewer = "true";
  block.setAttribute("title", labels.open);

  const open = () => {
    const width = img.naturalWidth || Math.max(1, Math.round(img.getBoundingClientRect().width));
    const height = img.naturalHeight || Math.max(1, Math.round(img.getBoundingClientRect().height));
    onOpen({
      svg: `<img class="mdv-diagram-viewer__image" src="${escapeAttr(url)}" alt="PlantUML diagram" />`,
      width,
      height,
    });
  };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mdv-plantuml__open";
  btn.setAttribute("aria-label", labels.open);
  btn.setAttribute("data-tooltip", labels.open);
  btn.innerHTML = EXPAND_ICON_SVG;
  block.appendChild(btn);

  const onButtonClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  };
  const onDoubleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".mdv-plantuml__open")) return;
    e.preventDefault();
    open();
  };

  btn.addEventListener("click", onButtonClick);
  block.addEventListener("dblclick", onDoubleClick);
  cleanups.push(() => {
    btn.removeEventListener("click", onButtonClick);
    block.removeEventListener("dblclick", onDoubleClick);
    btn.remove();
    block.removeAttribute("title");
    delete block.dataset.mdvPlantumlViewer;
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
