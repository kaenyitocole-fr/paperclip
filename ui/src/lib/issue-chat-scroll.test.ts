// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  captureComposerViewportSnapshot,
  restoreComposerViewportSnapshot,
} from "./issue-chat-scroll";

function mockTop(element: HTMLElement, top: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 48,
    left: 0,
    right: 0,
    width: 0,
    height: 48,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("issue-chat-scroll", () => {
  it("restores page scroll when the composer shifts in the viewport", () => {
    const composer = document.createElement("div");
    document.body.appendChild(composer);
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    mockTop(composer, 420);
    const snapshot = captureComposerViewportSnapshot(composer);

    mockTop(composer, 560);
    restoreComposerViewportSnapshot(snapshot, composer);

    expect(scrollByMock).toHaveBeenCalledWith({ top: 140, left: 0, behavior: "auto" });

    scrollByMock.mockRestore();
    composer.remove();
  });

  it("restores main-content scroll when the layout uses an internal scroller", () => {
    const mainContent = document.createElement("main");
    mainContent.id = "main-content";
    mainContent.style.overflowY = "auto";
    Object.defineProperty(mainContent, "scrollHeight", {
      configurable: true,
      value: 1800,
    });
    Object.defineProperty(mainContent, "clientHeight", {
      configurable: true,
      value: 900,
    });
    mainContent.scrollTop = 240;
    document.body.appendChild(mainContent);

    const composer = document.createElement("div");
    document.body.appendChild(composer);
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    mockTop(composer, 300);
    const snapshot = captureComposerViewportSnapshot(composer);

    mockTop(composer, 380);
    restoreComposerViewportSnapshot(snapshot, composer);

    expect(mainContent.scrollTop).toBe(320);
    expect(scrollByMock).not.toHaveBeenCalled();

    scrollByMock.mockRestore();
    composer.remove();
    mainContent.remove();
  });
});
