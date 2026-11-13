/** Shared Weibull reliability mark; surrounding branding supplies its accessible name. */
export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <img src={`${import.meta.env.BASE_URL}favicon.svg`} width={size} height={size}
      alt="" aria-hidden="true" className="shrink-0" draggable={false} />
  )
}
