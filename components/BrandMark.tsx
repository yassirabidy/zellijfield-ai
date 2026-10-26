// Zellijfield AI logo: an eight-pointed zellige star with a star-shaped opening, drawn in black on
// the lime logo tile. The opening is painted in the tile colour.
export default function BrandMark({ size = 20, hole = '#d1fe17' }: { size?: number; hole?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.6" y="3.6" width="16.8" height="16.8" fill="black" />
      <rect x="3.6" y="3.6" width="16.8" height="16.8" fill="black" transform="rotate(45 12 12)" />
      <rect x="8.2" y="8.2" width="7.6" height="7.6" fill={hole} />
      <rect x="8.2" y="8.2" width="7.6" height="7.6" fill={hole} transform="rotate(45 12 12)" />
    </svg>
  );
}
