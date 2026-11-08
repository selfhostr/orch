/** Wordmark: a hub with three spokes to three nodes, lit centre. */
export function Brand({ large }: { large?: boolean }) {
  return (
    <span className={`brand${large ? ' large' : ''}`}>
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="15" fill="#17181c" />
        <path className="track" d="M32 32V14M32 32 47.6 41M32 32 16.4 41" />
        <circle cx="32" cy="14" r="4.5" fill="#ecedef" />
        <circle cx="47.6" cy="41" r="4.5" fill="#ecedef" />
        <circle cx="16.4" cy="41" r="4.5" fill="#ecedef" />
        <circle className="signal" cx="32" cy="32" r="7" />
      </svg>
      <span className="brand-name">orch</span>
    </span>
  );
}
