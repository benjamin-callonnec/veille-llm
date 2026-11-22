import { type Item, readerUrl, safeUrl } from "../lib/catalogue";

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

export function Card({ item }: { item: Item }) {
  const href = safeUrl(item.url);
  const read = item.type === "paper" ? readerUrl(item.id, import.meta.env.VITE_READER_URL) : null;
  return (
    <article className="card">
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
        <span className="tag">{item.type}</span>
        <span>{date(item.published)}</span>
        <span>score {item.score}/10</span>
        {item.upvotes > 0 && <span>{item.upvotes} upvotes</span>}
        {read && <a href={read}>Read</a>}
      </p>
    </article>
  );
}
