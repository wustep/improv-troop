// Shared SVG defs. Render <DoodleDefs /> once per page.
//
//  filter  #dd-wobble   — light line wobble for static drawings (labels, panels)
//  filter  #dd-crayon   — wobble + waxy grain; use on static art only (not per-frame animated groups)
//  filter  #dd-soft     — soft glow used for spotlights
//  pattern #dd-hatch    — diagonal hatch (currentColor), for UI fills
//  pattern #dd-paper    — paper speckle overlay

export function DoodleDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden focusable="false">
      <defs>
        <filter id="dd-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="dd-crayon" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="w" />
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="11" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.45" result="mask" />
          <feComposite in="w" in2="mask" operator="in" />
        </filter>
        <filter id="dd-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <pattern id="dd-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.55" />
        </pattern>
        <pattern id="dd-paper" width="64" height="64" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="9" r="0.6" fill="#b9ab8c" opacity="0.35" />
          <circle cx="41" cy="23" r="0.5" fill="#b9ab8c" opacity="0.3" />
          <circle cx="23" cy="51" r="0.7" fill="#b9ab8c" opacity="0.25" />
          <circle cx="56" cy="44" r="0.4" fill="#b9ab8c" opacity="0.35" />
          <path d="M30 6 l3 1" stroke="#b9ab8c" strokeWidth="0.5" opacity="0.3" />
          <path d="M10 34 l2 -1" stroke="#b9ab8c" strokeWidth="0.5" opacity="0.3" />
        </pattern>
      </defs>
    </svg>
  );
}
