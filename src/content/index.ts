interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

type ContentMessage =
  | { type: "content:get-last-image" }
  | { type: "content:toggle-floating-panel" }
  | { type: "content:open-floating-panel" };

interface FloatingPanelPrefs {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
}

let lastImage: CapturedImage | null = null;
let floatingPanel: FloatingPanelController | null = null;

const FLOATING_PREF_KEY = "floatingPanelPrefs";
const FLOATING_DEFAULT_WIDTH = 420;
const FLOATING_DEFAULT_HEIGHT = 720;
const FLOATING_MIN_WIDTH = 340;
const FLOATING_MIN_HEIGHT = 520;
const FLOATING_VIEWPORT_GAP = 12;
const COLLAPSED_WIDTH = 56;
const COLLAPSED_HEIGHT = 44;

document.addEventListener(
  "contextmenu",
  (event) => {
    const image = findImageFromEvent(event);

    if (image) {
      lastImage = image;
    }
  },
  true
);

document.addEventListener(
  "mouseover",
  (event) => {
    const image = findImageFromEvent(event);

    if (image) {
      lastImage = image;
    }
  },
  true
);

chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender,
    sendResponse: (response: { image?: CapturedImage } | { ok: boolean }) => void
  ) => {
    if (message.type === "content:get-last-image") {
      sendResponse({
        image: lastImage ?? undefined
      });

      return false;
    }

    if (message.type === "content:toggle-floating-panel") {
      void toggleFloatingPanel().then(sendResponse).catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message.type === "content:open-floating-panel") {
      void openFloatingPanel().then(sendResponse).catch(() => sendResponse({ ok: false }));
      return true;
    }

    return false;
  }
);

async function toggleFloatingPanel(): Promise<{ ok: boolean }> {
  const panel = await ensureFloatingPanel();

  panel.toggle();
  return { ok: true };
}

async function openFloatingPanel(): Promise<{ ok: boolean }> {
  const panel = await ensureFloatingPanel();

  panel.open();
  return { ok: true };
}

async function ensureFloatingPanel(): Promise<FloatingPanelController> {
  if (!floatingPanel) {
    floatingPanel = await createFloatingPanelController();
  }

  return floatingPanel;
}

async function createFloatingPanelController(): Promise<FloatingPanelController> {
  const prefs = await loadFloatingPanelPrefs();
  const state = normalizeFloatingPanelState(prefs);
  const host = document.createElement("prompt-reverse-floating-panel");
  const shadow = host.attachShadow({ mode: "open" });
  const frame = document.createElement("div");
  const panel = document.createElement("section");
  const dragBar = document.createElement("div");
  const grabLip = document.createElement("span");
  const actions = document.createElement("div");
  const collapseButton = document.createElement("button");
  const closeButton = document.createElement("button");
  const iframe = document.createElement("iframe");
  const resizeHandle = document.createElement("div");
  const collapsedButton = document.createElement("button");
  const collapsedIcon = document.createElement("img");
  const collapsedDot = document.createElement("span");
  const style = document.createElement("style");

  host.setAttribute("aria-live", "polite");
  frame.className = "floating-frame";
  panel.className = "floating-panel";
  dragBar.className = "floating-dragbar";
  grabLip.className = "floating-grab-lip";
  actions.className = "floating-actions";
  collapseButton.className = "floating-icon-button";
  closeButton.className = "floating-icon-button";
  iframe.className = "floating-iframe";
  resizeHandle.className = "floating-resize-handle";
  collapsedButton.className = "floating-collapsed-button";
  collapsedIcon.className = "floating-collapsed-icon";
  collapsedDot.className = "floating-collapsed-dot";

  collapseButton.type = "button";
  collapseButton.setAttribute("aria-label", "折叠浮窗");
  collapseButton.textContent = "–";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "关闭浮窗");
  closeButton.textContent = "×";
  collapsedButton.type = "button";
  collapsedButton.setAttribute("aria-label", "展开 AI Prompt Reverse Engineer 浮窗");
  collapsedIcon.alt = "";
  collapsedIcon.src = chrome.runtime.getURL("icons/icon-32.png");
  iframe.title = "AI Prompt Reverse Engineer";
  iframe.src = chrome.runtime.getURL("sidepanel.html?surface=floating");

  style.textContent = FLOATING_PANEL_CSS;
  actions.append(collapseButton, closeButton);
  dragBar.append(grabLip, actions);
  panel.append(dragBar, iframe, resizeHandle);
  collapsedButton.append(collapsedIcon, collapsedDot);
  frame.append(panel, collapsedButton);
  shadow.append(style, frame);
  getDocumentMount().appendChild(host);

  const controller = new FloatingPanelController(
    host,
    frame,
    dragBar,
    resizeHandle,
    collapsedButton,
    state
  );

  collapseButton.addEventListener("click", () => controller.collapse());
  closeButton.addEventListener("click", () => controller.hide());
  collapsedButton.addEventListener("click", () => controller.expand());
  frame.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.collapse();
    }
  });
  window.addEventListener("resize", () => controller.clampToViewport());

  controller.open();
  return controller;
}

class FloatingPanelController {
  private hidden = true;
  private state: Required<FloatingPanelPrefs>;

  constructor(
    private readonly host: HTMLElement,
    private readonly frame: HTMLElement,
    private readonly dragBar: HTMLElement,
    private readonly resizeHandle: HTMLElement,
    private readonly collapsedButton: HTMLButtonElement,
    state: Required<FloatingPanelPrefs>
  ) {
    this.state = state;
    this.frame.tabIndex = -1;
    this.dragBar.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.resizeHandle.addEventListener("pointerdown", (event) => this.startResize(event));
    this.render();
  }

  toggle(): void {
    if (this.hidden) {
      this.open();
      return;
    }

    if (this.state.collapsed) {
      this.expand();
      return;
    }

    this.collapse();
  }

  open(): void {
    this.hidden = false;
    this.state.collapsed = false;
    this.render();
    this.frame.focus({ preventScroll: true });
    void saveFloatingPanelPrefs(this.state);
  }

  expand(): void {
    this.hidden = false;
    this.state.collapsed = false;
    this.render();
    this.frame.focus({ preventScroll: true });
    void saveFloatingPanelPrefs(this.state);
  }

  collapse(): void {
    this.hidden = false;
    this.state.collapsed = true;
    this.render();
    this.collapsedButton.focus({ preventScroll: true });
    void saveFloatingPanelPrefs(this.state);
  }

  hide(): void {
    this.hidden = true;
    this.render();
  }

  clampToViewport(): void {
    this.state = clampPanelState(this.state);
    this.render();
    void saveFloatingPanelPrefs(this.state);
  }

  private startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.state.collapsed) {
      return;
    }

    event.preventDefault();
    this.dragBar.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = this.state.left;
    const startTop = this.state.top;

    const move = (moveEvent: PointerEvent) => {
      this.state.left = clamp(
        startLeft + moveEvent.clientX - startX,
        FLOATING_VIEWPORT_GAP,
        Math.max(
          FLOATING_VIEWPORT_GAP,
          window.innerWidth - this.state.width - FLOATING_VIEWPORT_GAP
        )
      );
      this.state.top = clamp(
        startTop + moveEvent.clientY - startY,
        FLOATING_VIEWPORT_GAP,
        Math.max(
          FLOATING_VIEWPORT_GAP,
          window.innerHeight - this.state.height - FLOATING_VIEWPORT_GAP
        )
      );
      this.render();
    };

    const end = () => {
      this.dragBar.removeEventListener("pointermove", move);
      this.dragBar.removeEventListener("pointerup", end);
      this.dragBar.removeEventListener("pointercancel", end);
      void saveFloatingPanelPrefs(this.state);
    };

    this.dragBar.addEventListener("pointermove", move);
    this.dragBar.addEventListener("pointerup", end);
    this.dragBar.addEventListener("pointercancel", end);
  }

  private startResize(event: PointerEvent): void {
    if (event.button !== 0 || this.state.collapsed) {
      return;
    }

    event.preventDefault();
    this.resizeHandle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = this.state.width;
    const startHeight = this.state.height;

    const move = (moveEvent: PointerEvent) => {
      const maxWidth = Math.max(
        getMinimumPanelWidth(),
        window.innerWidth - this.state.left - FLOATING_VIEWPORT_GAP
      );
      const maxHeight = Math.max(
        getMinimumPanelHeight(),
        Math.min(
          getMaximumPanelHeight(),
          window.innerHeight - this.state.top - FLOATING_VIEWPORT_GAP
        )
      );

      this.state.width = clamp(
        startWidth + moveEvent.clientX - startX,
        getMinimumPanelWidth(),
        maxWidth
      );
      this.state.height = clamp(
        startHeight + moveEvent.clientY - startY,
        FLOATING_MIN_HEIGHT,
        maxHeight
      );
      this.render();
    };

    const end = () => {
      this.resizeHandle.removeEventListener("pointermove", move);
      this.resizeHandle.removeEventListener("pointerup", end);
      this.resizeHandle.removeEventListener("pointercancel", end);
      void saveFloatingPanelPrefs(this.state);
    };

    this.resizeHandle.addEventListener("pointermove", move);
    this.resizeHandle.addEventListener("pointerup", end);
    this.resizeHandle.addEventListener("pointercancel", end);
  }

  private render(): void {
    const state = clampPanelState(this.state);
    this.state = state;

    this.host.style.display = this.hidden ? "none" : "block";

    if (this.hidden) {
      return;
    }

    if (state.collapsed) {
      const left = clamp(
        state.left + state.width - COLLAPSED_WIDTH,
        FLOATING_VIEWPORT_GAP,
        Math.max(
          FLOATING_VIEWPORT_GAP,
          window.innerWidth - COLLAPSED_WIDTH - FLOATING_VIEWPORT_GAP
        )
      );

      this.host.style.left = `${left}px`;
      this.host.style.top = `${state.top}px`;
      this.host.style.width = `${COLLAPSED_WIDTH}px`;
      this.host.style.height = `${COLLAPSED_HEIGHT}px`;
      this.frame.dataset.state = "collapsed";
      return;
    }

    this.host.style.left = `${state.left}px`;
    this.host.style.top = `${state.top}px`;
    this.host.style.width = `${state.width}px`;
    this.host.style.height = `${state.height}px`;
    this.frame.dataset.state = "open";
  }
}

function normalizeFloatingPanelState(
  prefs: FloatingPanelPrefs
): Required<FloatingPanelPrefs> {
  const width = clamp(
    Math.round(
      prefs.width ??
        Math.min(FLOATING_DEFAULT_WIDTH, window.innerWidth - FLOATING_VIEWPORT_GAP * 2)
    ),
    getMinimumPanelWidth(),
    getMaximumPanelWidth()
  );
  const height = clamp(
    Math.round(
      prefs.height ??
        Math.min(FLOATING_DEFAULT_HEIGHT, window.innerHeight - FLOATING_VIEWPORT_GAP * 2)
    ),
    getMinimumPanelHeight(),
    getMaximumPanelHeight()
  );
  const defaultLeft = window.innerWidth - width - 18;
  const defaultTop = Math.max(18, Math.round((window.innerHeight - height) * 0.32));

  return clampPanelState({
    left: Math.round(prefs.left ?? defaultLeft),
    top: Math.round(prefs.top ?? defaultTop),
    width,
    height,
    collapsed: Boolean(prefs.collapsed)
  });
}

function clampPanelState(state: Required<FloatingPanelPrefs>): Required<FloatingPanelPrefs> {
  const minWidth = getMinimumPanelWidth();
  const minHeight = getMinimumPanelHeight();
  const maxWidth = getMaximumPanelWidth();
  const maxHeight = getMaximumPanelHeight();
  const width = clamp(
    Math.round(state.width),
    minWidth,
    maxWidth
  );
  const height = clamp(
    Math.round(state.height),
    minHeight,
    maxHeight
  );

  return {
    width,
    height,
    left: clamp(
      Math.round(state.left),
      FLOATING_VIEWPORT_GAP,
      Math.max(FLOATING_VIEWPORT_GAP, window.innerWidth - width - FLOATING_VIEWPORT_GAP)
    ),
    top: clamp(
      Math.round(state.top),
      FLOATING_VIEWPORT_GAP,
      Math.max(FLOATING_VIEWPORT_GAP, window.innerHeight - height - FLOATING_VIEWPORT_GAP)
    ),
    collapsed: state.collapsed
  };
}

function getMinimumPanelWidth(): number {
  return Math.min(FLOATING_MIN_WIDTH, getMaximumPanelWidth());
}

function getMaximumPanelWidth(): number {
  return Math.max(240, window.innerWidth - FLOATING_VIEWPORT_GAP * 2);
}

function getMinimumPanelHeight(): number {
  return Math.min(FLOATING_MIN_HEIGHT, getMaximumPanelHeight());
}

function getMaximumPanelHeight(): number {
  return Math.max(320, window.innerHeight - FLOATING_VIEWPORT_GAP * 2);
}

function getDocumentMount(): HTMLElement {
  return document.body ?? document.documentElement;
}

function loadFloatingPanelPrefs(): Promise<FloatingPanelPrefs> {
  return new Promise((resolve) => {
    chrome.storage.local.get(FLOATING_PREF_KEY, (items) => {
      const prefs = items[FLOATING_PREF_KEY];
      resolve(isFloatingPanelPrefs(prefs) ? prefs : {});
    });
  });
}

function saveFloatingPanelPrefs(prefs: FloatingPanelPrefs): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [FLOATING_PREF_KEY]: prefs
      },
      () => resolve()
    );
  });
}

function isFloatingPanelPrefs(value: unknown): value is FloatingPanelPrefs {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function findImageFromEvent(event: Event): CapturedImage | null {
  const target = event.composedPath()[0];
  const element = target instanceof Element ? target : null;

  if (!element) {
    return null;
  }

  const imageUrl = findImageUrl(element);

  if (!imageUrl) {
    return null;
  }

  return {
    url: absolutizeUrl(imageUrl),
    sourcePageUrl: window.location.href,
    sourceTitle: document.title
  };
}

function findImageUrl(element: Element): string | null {
  const imageElement = element.closest("img");

  if (imageElement instanceof HTMLImageElement) {
    return (
      imageElement.currentSrc ||
      imageElement.src ||
      imageElement.getAttribute("data-src") ||
      imageElement.getAttribute("data-original") ||
      imageElement.getAttribute("data-lazy-src")
    );
  }

  const svgImage = element.closest("image");

  if (svgImage instanceof SVGImageElement) {
    return (
      svgImage.href.baseVal ||
      svgImage.getAttribute("href") ||
      svgImage.getAttribute("xlink:href")
    );
  }

  const backgroundImage = findBackgroundImageUrl(element);

  if (backgroundImage) {
    return backgroundImage;
  }

  return null;
}

function findBackgroundImageUrl(element: Element): string | null {
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const imageUrl = parseCssBackgroundImage(style.backgroundImage);

    if (imageUrl) {
      return imageUrl;
    }

    current = current.parentElement;
  }

  return null;
}

function parseCssBackgroundImage(value: string): string | null {
  if (!value || value === "none") {
    return null;
  }

  const match = /url\((['"]?)(.*?)\1\)/.exec(value);
  return match?.[2] || null;
}

function absolutizeUrl(url: string): string {
  if (url.startsWith("data:image/")) {
    return url;
  }

  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

const FLOATING_PANEL_CSS = `
  :host {
    position: fixed;
    z-index: 2147483647;
    display: none;
    box-sizing: border-box;
    pointer-events: none;
    color-scheme: light;
    font-family:
      "Microsoft YaHei UI", "PingFang SC", "HarmonyOS Sans SC", "Segoe UI",
      ui-sans-serif, sans-serif;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  .floating-frame {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }

  .floating-frame:focus {
    outline: 0;
  }

  .floating-panel {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: 28px minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid rgba(23, 32, 28, 0.13);
    border-radius: 10px;
    background:
      linear-gradient(180deg, rgba(255, 254, 250, 0.96), rgba(246, 245, 238, 0.96)),
      #fffdf8;
    box-shadow:
      0 20px 54px rgba(23, 32, 28, 0.2),
      0 3px 12px rgba(23, 32, 28, 0.08);
    backdrop-filter: blur(16px);
  }

  .floating-dragbar {
    position: relative;
    min-height: 28px;
    border-bottom: 1px solid rgba(23, 32, 28, 0.08);
    background:
      linear-gradient(90deg, rgba(10, 122, 112, 0.08), transparent 52%),
      rgba(255, 253, 248, 0.92);
    cursor: grab;
    user-select: none;
  }

  .floating-dragbar:active {
    cursor: grabbing;
  }

  .floating-grab-lip {
    position: absolute;
    left: 50%;
    top: 11px;
    width: 44px;
    height: 4px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: rgba(23, 32, 28, 0.22);
  }

  .floating-actions {
    position: absolute;
    top: 3px;
    right: 4px;
    display: inline-flex;
    gap: 4px;
  }

  .floating-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid rgba(23, 32, 28, 0.1);
    border-radius: 7px;
    background: rgba(255, 254, 250, 0.78);
    color: #17201c;
    cursor: pointer;
    font: 900 15px/1 "Segoe UI", sans-serif;
  }

  .floating-icon-button:hover,
  .floating-icon-button:focus-visible {
    border-color: rgba(10, 122, 112, 0.36);
    background: #ffffff;
    color: #075e56;
    outline: 0;
  }

  .floating-iframe {
    width: 100%;
    min-width: 0;
    height: 100%;
    border: 0;
    background: #f5f4ef;
  }

  .floating-resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
  }

  .floating-resize-handle::after {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 8px;
    height: 8px;
    border-right: 2px solid rgba(10, 122, 112, 0.42);
    border-bottom: 2px solid rgba(10, 122, 112, 0.42);
    content: "";
  }

  .floating-collapsed-button {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 44px;
    padding: 0;
    border: 1px solid rgba(23, 32, 28, 0.13);
    border-radius: 999px;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.38), transparent 40%),
      linear-gradient(135deg, #17201c, #0a7a70 60%, #c8923a);
    box-shadow: 0 12px 30px rgba(23, 32, 28, 0.22);
    cursor: pointer;
  }

  .floating-collapsed-button:focus-visible {
    outline: 0;
    box-shadow:
      0 12px 30px rgba(23, 32, 28, 0.22),
      0 0 0 3px rgba(10, 122, 112, 0.22);
  }

  .floating-collapsed-icon {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }

  .floating-collapsed-dot {
    position: absolute;
    right: 10px;
    top: 9px;
    width: 8px;
    height: 8px;
    border: 1px solid rgba(255, 255, 255, 0.68);
    border-radius: 999px;
    background: #58d5c8;
  }

  .floating-frame[data-state="collapsed"] .floating-panel {
    display: none;
  }

  .floating-frame[data-state="collapsed"] .floating-collapsed-button {
    display: inline-flex;
  }
`;
