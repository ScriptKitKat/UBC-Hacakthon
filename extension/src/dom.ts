export type Child = Node | string | null;

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly on?: Readonly<Record<string, (event: Event) => void>>;
}

function applyOptions(element: Element, options: ElementOptions, children: readonly Child[]): void {
  if (options.className !== undefined) element.setAttribute("class", options.className);
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) element.setAttribute(name, value);
  for (const [type, listener] of Object.entries(options.on ?? {})) element.addEventListener(type, listener);
  for (const child of children) {
    if (child !== null) element.append(child);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, options: ElementOptions = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  applyOptions(element, options, children);
  return element;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, options: ElementOptions = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  applyOptions(element, options, children);
  return element;
}
