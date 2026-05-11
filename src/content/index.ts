interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

interface ContentMessage {
  type: "content:get-last-image";
}

let lastImage: CapturedImage | null = null;

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
    sendResponse: (response: { image?: CapturedImage }) => void
  ) => {
    if (message.type === "content:get-last-image") {
      sendResponse({
        image: lastImage ?? undefined
      });
    }

    return false;
  }
);

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
