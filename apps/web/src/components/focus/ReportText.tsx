import { Fragment } from "react";

/**
 * A research report, verbatim.
 *
 * `aiq-research/SKILL.md`: citations and source URLs are not cut. So the text is not
 * rendered as Markdown, summarised or trimmed — it is shown as it was stored, with line
 * breaks kept, and the only change is that a URL becomes a link to itself. A Markdown
 * renderer would have been nicer to read and would have been one more place the text could
 * be altered (a table that does not parse, a link whose label hides its target).
 */

const URL = /https?:\/\/[^\s<>()[\]"'`]+/g;

/** Trailing punctuation belongs to the sentence, not the address. */
function split(url: string): readonly [string, string] {
  const match = /[.,;:!?]+$/.exec(url);
  return match === null ? [url, ""] : [url.slice(0, match.index), match[0]];
}

export function ReportText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL)) {
    const start = match.index;
    const [href, tail] = split(match[0]);
    parts.push(<Fragment key={`t${String(start)}`}>{text.slice(last, start)}</Fragment>);
    parts.push(
      <a key={`a${String(start)}`} href={href} target="_blank" rel="noreferrer noopener">
        {href}
      </a>,
    );
    if (tail !== "") parts.push(<Fragment key={`p${String(start)}`}>{tail}</Fragment>);
    last = start + match[0].length;
  }
  parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return <div className={className}>{parts}</div>;
}
