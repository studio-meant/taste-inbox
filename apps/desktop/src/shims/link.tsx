import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { forwardRef } from "react";
import { toHref, type UrlObject } from "./href";
import { navigate } from "./navigation";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly href: string | UrlObject;
  readonly replace?: boolean;
  readonly scroll?: boolean;
  readonly prefetch?: boolean | null;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function DesktopLink(
  { href, replace = false, scroll = true, prefetch: _prefetch, target, onClick, ...rest },
  ref,
) {
  const resolved = toHref(href);

  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      target === "_blank" ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      /^(?:[a-z]+:)?\/\//iu.test(resolved)
    ) {
      return;
    }
    event.preventDefault();
    navigate(resolved, { replace });
    if (scroll) window.scrollTo({ top: 0, left: 0 });
  }

  return <a {...rest} ref={ref} href={resolved} target={target} onClick={follow} />;
});

export default Link;
