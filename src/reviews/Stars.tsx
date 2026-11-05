/** Read-only star rating. The rating is announced as text ("4 out of 5 stars"); the drawn stars are decoration. */
export function ratingText(rating: number) { return `${rating} out of 5 stars` }

export function Stars({ rating, size = 'md' }: { rating: number; size?: 'md' | 'lg' }) {
  return (
    <span className={`stars ${size}`} role="img" aria-label={ratingText(rating)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 24 24" aria-hidden="true" className={i <= Math.round(rating) ? 'on' : 'off'}>
          <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.600l6.200-.9z" fill="currentColor" stroke="currentColor" strokeWidth="1.500" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  )
}
