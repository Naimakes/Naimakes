const NMK_PATHS = [
  "M0 0H69L308 247H239L62 64.1V247H0ZM244 0H308V230.5L244 164.3Z",
  "M347 0H411L502 115.6 593 0H657V247H598V78.7L502 196.9 406 78.7V247H347Z",
  "M691 0H751V247H691ZM883 0H962L837.5 115.6 966 247H885L762 116.2Z",
];
export function BrandMark({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className={`brand-logo nmk-brand${onDark ? " nmk-brand-on-dark" : ""}`}>
      <svg viewBox="0 0 966 247" role="img" aria-label="NMK 商标" fill="currentColor">
        {NMK_PATHS.map((d) => <path key={d} d={d} />)}
      </svg>
    </span>
  );
}
