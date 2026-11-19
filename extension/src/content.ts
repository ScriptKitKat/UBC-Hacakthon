import { createFeedController } from "./controller";
import { sendToBackground } from "./messaging";
import { loadDeskUrl } from "./settings";

const controller = createFeedController({
  document,
  send: sendToBackground,
  loadDeskUrl,
  watchVisibility: (onChange) => {
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) onChange(record.target, record.isIntersecting);
      },
      { rootMargin: "200px 0px" },
    );
    return { observe: (element) => { observer.observe(element); }, unobserve: (element) => { observer.unobserve(element); } };
  },
});

controller.start();
