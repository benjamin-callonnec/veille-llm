import { hasArxivPdf, type Item, readerUrl, safeUrl, TYPE_LABELS } from "../lib/catalogue";

const MAX_MENTIONS = 3;

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

export function Card({ item }: { item: Item }) {
  const href = safeUrl(item.url);
  const read = hasArxivPdf(item.url) ? readerUrl(item.id, import.meta.env.VITE_READER_URL) : null;
  return (
    <article className={read ? "card card-readable" : "card"}>
      {read && (
        // biome-ignore lint/a11y/useAnchorContent: an invisible overlay link, named by aria-label
        <a
          className="card-open"
          href={read}
          aria-label={`Open "${item.title}" in the reader`}
          title="Read in the reader"
        />
      )}
      <h2>
        {href ? (
          <a href={href} rel="noopener noreferrer" target="_blank">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h2>
      <p className="hook">
        <strong>{item.hook}</strong>
      </p>
      {item.brief && <p className="brief">{item.brief}</p>}
      <p className="meta">
        <span className="tag">{item.category}</span>
        <span className="tag">{TYPE_LABELS[item.type]}</span>
        <span>{date(item.published)}</span>
        <span>score {item.score}/10</span>
        {item.upvotes > 0 && <span>{item.upvotes} upvotes</span>}
        {item.github_stars > 0 && <span>{item.github_stars} GitHub stars</span>}
      </p>
      {item.mentions.length > 0 && (
        <ul className="mentions" aria-label="Discussions">
          {item.mentions.slice(0, MAX_MENTIONS).map((m) => (
            <li key={m.url}>
              <a href={m.url} rel="noopener noreferrer" target="_blank">
                {m.title}
              </a>{" "}
              · {m.points} points on Hacker News
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
